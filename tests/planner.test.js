const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {STOP_POLICY,stopWindow,brandOf,allowedBrand,normalizeMatches}=require('../stop-policy');
const script=fs.readFileSync(require('node:path').join(__dirname,'../planner.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture(distance=1100){
 const values={manualStops:'',yard:'Start',pickup:'Start',delivery:'End',trip:'127532',driver:'Test',truck:'1',trailer:'1',commodity:'General freight',maxHours:'10',avgSpeed:'55',cycle:'60',network:'Pilot / Flying J only',notes:'I-80',departureTime:'2026-10-13T06:00',deliveryTime:'2026-10-20T08:00',overallFeet:'75',widthInches:'102',heightInches:'162',grossWeight:'80000',trailerFeet:'53'};
 const elements={};for(const [id,value]of Object.entries(values))elements[id]={value,handlers:{},dataset:{},addEventListener(type,fn){this.handlers[type]=fn;}};
 for(const id of ['status','generated','plan','verificationHost','verifiedNavigation','generateBtn'])elements[id]={innerHTML:'',textContent:'',disabled:false,prepend(){},scrollIntoView(){}};
 elements.require300={checked:false,value:'',handlers:{},dataset:{},addEventListener(type,fn){this.handlers[type]=fn;}};
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
function attachSyntheticAutoRouting(context,distanceMiles=1100){
 context.geocode=async address=>({lat:40,lng:address==='End'?distanceMiles/50:0,address});
 context.routeThrough=async points=>{
  let miles=0;for(let i=1;i<points.length;i++)miles+=Math.abs(points[i].lng-points[i-1].lng)*50;
  return {distance:miles*1609.344,duration:miles/55*3600,geometry:null,truckRestrictionsChecked:false};
 };
 context.fetchTimed=async(url,options={})=>{
  if(url.includes('/api/automatic-stop-candidates')){
   const {points,kind,targetMiles}=JSON.parse(options.body),[origin,destination]=points;
   const remaining=Math.abs(destination.lng-origin.lng)*50,miles=Math.min(targetMiles,Math.max(0,remaining-30));
   const brand=kind==='break'?'Pilot':'Flying J';
   return {ok:true,json:async()=>({stops:[{name:brand+' Synthetic Stop',brand,address:Math.round(miles)+' Synthetic Mile Rd',lat:origin.lat,lng:origin.lng+miles/50}]})};
  }
  if(url.endsWith('-directory'))return {ok:true,json:async()=>({stops:[]})};
  throw new Error('Unexpected synthetic test request: '+url);
 };
}
test('default stop spacing and approved fuel networks',()=>{
 assert.deepEqual(STOP_POLICY,{minMiles:200,targetMiles:250,maxMiles:300});
 assert.deepEqual(stopWindow('break',9,55),{minMiles:200,maxMiles:300,targetMiles:250});
 assert.deepEqual(stopWindow('rest',9,55),{minMiles:200,maxMiles:300,targetMiles:250});
 assert.deepEqual(stopWindow('break',9,60,true),{minMiles:300,maxMiles:350,targetMiles:300});
 assert.throws(()=>stopWindow('break',5,55,true),/300-mile minimum cannot fit/);
 assert.equal(brandOf('Flying J Travel Center #123'),'Flying J');
 assert.equal(allowedBrand("Love's",'break','Pilot / Flying J only'),false);
 assert.equal(allowedBrand("Love's",'rest','Pilot / Flying J only'),true);
});
test('alcohol commodity enables the 300-mile first-break rule and manual override persists',()=>{
 const {context,elements}=fixture();
 assert.equal(elements.require300.checked,false);
 elements.commodity.value='Jack Daniels Tennessee Whiskey';elements.commodity.handlers.input();
 assert.equal(elements.require300.checked,true);
 elements.require300.checked=false;elements.require300.handlers.change();
 elements.commodity.value='General freight';elements.commodity.handlers.input();
 assert.equal(elements.require300.checked,false);
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
test('automatic planner selects stops within the 200–300 mile target window',async()=>{
 const {context,elements,actualSelect}=fixture(1100);context.selectTruckStop=actualSelect;attachSyntheticAutoRouting(context,1100);
 await context.buildGenericPlan();
 const stops=Array.from(vm.runInContext('lastPlanStops',context));
 const planned=stops.filter(s=>s.kind==='break'||s.kind==='rest');
 assert.equal(planned.length,4);
 assert.ok(planned.every(s=>s.miles>=200&&s.miles<=300),JSON.stringify(planned.map(s=>s.miles)));
 assert.match(elements.generated.innerHTML,/200–300 estimated road miles/);
 assert.match(elements.generated.innerHTML,/DAY 3/);
});
test('alcohol first break is at least 300 miles and later stops remain clock-limited',async()=>{
 const {context,elements,actualSelect}=fixture(1100);context.selectTruckStop=actualSelect;attachSyntheticAutoRouting(context,1100);
 elements.commodity.value='Jack Daniel’s Tennessee Whiskey';elements.commodity.handlers.input();
 assert.equal(elements.require300.checked,true);
 await context.buildGenericPlan();
 const stops=Array.from(vm.runInContext('lastPlanStops',context));
 const firstBreak=stops.find(s=>s.kind==='break');
 assert.ok(firstBreak.miles>=300&&firstBreak.miles<=350);
 assert.match(elements.generated.innerHTML,/Alcohol-load rule: the first break\/fuel stop after pickup must be at least 300/);
});
test('trips under 650 miles schedule one break/fuel stop when the route fits one driving day',async()=>{
 const {context,elements,actualSelect}=fixture(550);context.selectTruckStop=actualSelect;attachSyntheticAutoRouting(context,550);
 await context.buildGenericPlan();
 const stops=Array.from(vm.runInContext('lastPlanStops',context));
 assert.deepEqual(stops.map(s=>s.kind||'pickup'),['pickup','break','delivery']);
 assert.ok(stops[1].miles>=200&&stops[1].miles<=300);
 assert.match(elements.generated.innerHTML,/under 650 estimated road miles include one scheduled 30-minute break\/fuel stop/);
});
test('a clock-limited trip under 650 miles keeps one break/fuel stop plus a required overnight',async()=>{
 const {context,actualSelect}=fixture(620);context.selectTruckStop=actualSelect;attachSyntheticAutoRouting(context,620);
 await context.buildGenericPlan();
 const stops=Array.from(vm.runInContext('lastPlanStops',context));
 assert.equal(stops.filter(s=>s.kind==='break').length,1);
 assert.equal(stops.filter(s=>s.kind==='rest').length,1);
 assert.equal(stops.at(-1).kind,'delivery');
});
test('a trip under 650 miles stops for review if the available clock needs a second break/fuel stop',async()=>{
 const {context,elements,actualSelect}=fixture(649);context.selectTruckStop=actualSelect;attachSyntheticAutoRouting(context,649);
 elements.maxHours.value='5.5';
 await assert.rejects(context.buildGenericPlan(),/Trips under 650 estimated road miles are limited to one 30-minute break\/fuel stop/);
 assert.equal(elements.generated.innerHTML,'');
});
test('short delivery under 650 miles gets one in-route break/fuel stop without an overnight',async()=>{
 const {context,elements,actualSelect}=fixture(150);context.selectTruckStop=actualSelect;attachSyntheticAutoRouting(context,150);
 await context.buildGenericPlan();
 const stops=Array.from(vm.runInContext('lastPlanStops',context));
 assert.deepEqual(stops.map(s=>s.kind||'pickup'),['pickup','break','delivery']);
 assert.ok(stops[1].miles<150);
 assert.match(elements.generated.innerHTML,/under 650 estimated road miles include one scheduled 30-minute break\/fuel stop/);
 assert.doesNotMatch(elements.generated.innerHTML,/DAY 2/);
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
 const stage=stops.at(-2),delivery=stops.at(-1);
 assert.equal(stage.kind,'rest');
 assert.match(stage.address,/Springville, UT/);
 assert.equal(delivery.kind,'delivery');
 assert.ok(delivery.miles<30);
 assert.ok(stage.driveHours<8);
 assert.match(elements.generated.innerHTML,/DAY 4/);
});
