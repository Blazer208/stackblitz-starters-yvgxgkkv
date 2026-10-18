const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {STOP_POLICY,stopWindow,brandOf,allowedBrand,normalizeMatches}=require('../stop-policy');
const script=fs.readFileSync(require('node:path').join(__dirname,'../planner.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture(distance=1100){
 const values={manualStops:'',yard:'Start',pickup:'Start',delivery:'End',trip:'127532',driver:'Test',truck:'1',trailer:'1',maxHours:'10',avgSpeed:'55',cycle:'60',network:'Pilot / Flying J only',notes:'I-80',departureTime:'2026-10-13T06:00',deliveryTime:'2026-10-20T08:00',overallFeet:'75',widthInches:'102',heightInches:'162',grossWeight:'80000',trailerFeet:'53'};
 const elements={};for(const [id,value]of Object.entries(values))elements[id]={value};
 for(const id of ['status','generated','plan','verificationHost','verifiedNavigation','generateBtn'])elements[id]={innerHTML:'',textContent:'',disabled:false,prepend(){},scrollIntoView(){}};
 elements.require300={checked:false};
 const context=vm.createContext({STOP_POLICY,stopWindow,brandOf,allowedBrand,document:{getElementById:id=>elements[id],createElement:()=>({}),querySelector:()=>({before(){}})},sessionStorage:{getItem:()=>null},window:{},console,AbortSignal,setTimeout,Blob});
 vm.runInContext(script,context);
 const actualSelect=context.selectTruckStop;
 context.geocode=async address=>({lat:40,lng:address==='End'?distance:0});
 context.routeThrough=async points=>({distance:Math.abs(points[1].lng-points[0].lng)*1609.344,duration:Math.abs(points[1].lng-points[0].lng)/55*3600});
 context.selectTruckStop=async(origin,dest,kind,network,hoursLeft)=>{
   const miles=Math.min(250,Math.floor(hoursLeft*55));
   if(miles<=0)throw new Error('No hours');
   return {lat:40,lng:origin.lng+miles,name:kind==='break'?'Pilot':'Love\'s',address:'100 Truck Rd',kind,miles,driveHours:miles/55};
 };
 return {context,elements,actualSelect};
}
test('default stop spacing and approved fuel networks',()=>{
 assert.deepEqual(STOP_POLICY,{minMiles:250,targetMiles:300,maxMiles:350});
 assert.equal(brandOf('Flying J Travel Center #123'),'Flying J');
 assert.equal(allowedBrand("Love's",'break','Pilot / Flying J only'),false);
 assert.equal(allowedBrand("Love's",'rest','Pilot / Flying J only'),true);
});
test('provider matches require actual street addresses and coordinate/mileage data',()=>{
 const item={POILocation:{PlaceName:'@Pilot Travel Center',Address:{StreetAddress:'100 Main St',City:'Test',State:'WY',Zip:'82001'},Coords:{Lat:'41',Lon:'-105'}},DistanceFromOrigin:{Value:251,DistanceUnits:0}};
 const result=normalizeMatches({POISearchMatches:[item,item,{...item,POILocation:{...item.POILocation,Address:{City:'Test'}}}]},'break','Pilot / Flying J only');
 assert.equal(result.length,1);assert.equal(result[0].miles,251);
 assert.throws(()=>normalizeMatches({},'break','Pilot / Flying J only'));
});
test('multi-day trip uses two stops and keeps every leg within 300 miles',async()=>{
 const {context,elements}=fixture();await context.buildGenericPlan();
 const stops=vm.runInContext('lastPlanStops',context);
 assert.deepEqual(Array.from(stops,s=>s.kind||'pickup'),['pickup','break','rest','break','rest','delivery']);
 assert.ok(stops.slice(1).every(s=>s.miles<=300));
 assert.match(elements.generated.innerHTML,/DAY 3/);assert.match(elements.generated.innerHTML,/1100.0 mi/);
 assert.doesNotMatch(elements.generated.innerHTML,/Cedar Rapids|North Platte/);
});
test('short delivery has no invented break or overnight',async()=>{
 const {context,elements}=fixture(150);await context.buildGenericPlan();
 assert.equal(vm.runInContext('lastPlanStops.length',context),2);
 assert.match(elements.generated.innerHTML,/Short leg/);assert.doesNotMatch(elements.generated.innerHTML,/DAY 2/);
});
test('cycle shortage blocks the completed plan',async()=>{
 const {context,elements}=fixture();elements.cycle.value='3';
 await assert.rejects(context.buildGenericPlan(),/cycle hours/);
 assert.equal(vm.runInContext('lastPlanStops.length',context),0);
});
test('provider failure clears stale exports and always releases the generate button',async()=>{
 const {context,elements}=fixture();context.selectTruckStop=async()=>{throw new Error('Truck-stop license unavailable');};
 vm.runInContext('lastPlanStops=[{name:"Old stop"}];',context);elements.generated.innerHTML='Old trip';
 await context.buildPlan();assert.equal(vm.runInContext('lastPlanStops.length',context),0);
 assert.equal(elements.generateBtn.disabled,false);assert.equal(elements.generated.innerHTML,'');
 assert.match(elements.status.innerHTML,/Truck-stop license unavailable/);
});
test('invalid driving inputs fail instead of being silently coerced',async()=>{
 const {context,elements}=fixture();elements.maxHours.value='12';
 await assert.rejects(context.buildGenericPlan(),/1–11/);
});
test('dispatcher-selected stop is checked with actual truck-route miles',async()=>{
 const {context,actualSelect}=fixture();context.geocode=async()=>({lat:40,lng:250});
 vm.runInContext('manualStopMode=true;manualStopQueue=[{name:"Pilot Travel Center",address:"100 Truck Rd"}];',context);
 const stop=await actualSelect({lat:40,lng:0},{lat:40,lng:1100},'break','Pilot / Flying J only',9,55);
 assert.equal(stop.miles,250);assert.equal(stop.kind,'break');
});
test('manual fuel stops outside company network or range are rejected',async()=>{
 const {context,actualSelect}=fixture();context.geocode=async()=>({lat:40,lng:400});
 vm.runInContext('manualStopMode=true;manualStopQueue=[{name:"Love\'s Travel Stop",address:"100 Truck Rd"}];',context);
 await assert.rejects(actualSelect({lat:40,lng:0},{lat:40,lng:1100},'break','Pilot / Flying J only',9,55),/approved/);
 vm.runInContext('manualStopQueue=[{name:"Pilot Travel Center",address:"100 Truck Rd"}];',context);
 await assert.rejects(actualSelect({lat:40,lng:0},{lat:40,lng:1100},'break','Pilot / Flying J only',9,55),/400.0/);
});

test('Milwaukee Springville planner stages in Utah before next-morning delivery instead of 205-mile final leg',async()=>{
 const {context,elements}=fixture(1455);
 elements.delivery.value='2224 W 500 N, Springville, UT 84663';
 context.geocode=async address=>({lat:40,lng:/Springville/.test(address)?1455:0});
 context.routeThrough=async points=>{
   const mile=p=>p.name?.includes('Springville staging')?1445:p.lng;
   let distance=0;for(let i=1;i<points.length;i++)distance+=Math.abs(mile(points[i])-mile(points[i-1]));
   return {distance:distance*1609.344,duration:distance/55*3600};
 };
 await context.buildGenericPlan();
 const stops=Array.from(vm.runInContext('lastPlanStops',context));
 console.log('SPRINGVILLE STAGING DEBUG',stops.map(p=>({kind:p.kind,address:p.address,miles:p.miles,driveHours:p.driveHours})));
 const stage=stops.at(-2),delivery=stops.at(-1);
 assert.equal(stage.kind,'rest');
 assert.match(stage.address,/Springville, UT/);
 assert.equal(delivery.kind,'delivery');
 assert.ok(delivery.miles<30);
 assert.ok(stage.driveHours<8);
 assert.match(elements.generated.innerHTML,/DAY 4/);
});
