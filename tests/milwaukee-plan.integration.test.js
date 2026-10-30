const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {STOP_POLICY,stopWindow,brandOf,allowedBrand}=require('../stop-policy');
const html=fs.readFileSync(require('node:path').join(__dirname,'../planner.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const pickup={lat:43.090625,lng:-87.907631};
const delivery={lat:40.173970,lng:-111.613001};
test('Milwaukee-to-Springville saved trip builds its stops, navigation, GPX and print with a local road simulation', async()=>{
 const fields={trip:'127532',driver:'Integration Test',truck:'237',trailer:'5206',
  yard:'4041 N Richards St, Milwaukee, WI 53212',
  pickup:'4041 N Richards St, Milwaukee, WI 53212',
  delivery:'2224 W 500 N, Springville, UT 84663',
  network:'Pilot / Flying J only',notes:'I-94 → US-151 → I-80 → I-15',
  departureTime:'2026-10-09T13:30',deliveryTime:'2026-10-12T08:00',
  overallFeet:'75',widthInches:'102',heightInches:'162',grossWeight:'80000',trailerFeet:'53'};
 const nodes={};const getElementById=id=>nodes[id]??(nodes[id]={
  value:fields[id]||'',innerHTML:'',textContent:'',disabled:false,checked:false,
  classList:{add(){},remove(){}},prepend(){},scrollIntoView(){}
 });
 const document={getElementById,querySelector:()=>null,querySelectorAll:()=>[
  {textContent:'1,500 mi'},{textContent:'29 hr'},{textContent:'4 days'}
 ]};
 const context=vm.createContext({STOP_POLICY,stopWindow,brandOf,allowedBrand,document,
  window:{},sessionStorage:{getItem:()=>null},console,AbortSignal,setTimeout,Blob});
 vm.runInContext(script,context);
 context.geocode=async address=>/Springville/i.test(address)?delivery:pickup;
 // Keep this integration test local: estimate road mileage from the stored
 // stops without sending a driver's trip coordinates to a public router.
 context.routeThrough=async points=>{
  const radians=Math.PI/180;
  const segmentMiles=(a,b)=>{
   const lat1=a.lat*radians,lat2=b.lat*radians,dLat=(b.lat-a.lat)*radians,dLng=(b.lng-a.lng)*radians;
   const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
   return 3958.8*2*Math.asin(Math.sqrt(h))*1.15;
  };
  let miles=0;for(let i=1;i<points.length;i++)miles+=segmentMiles(points[i-1],points[i]);
  return {distance:miles*1609.344,duration:miles/55*3600,geometry:null,provider:'Synthetic local road estimate'};
 };
 await context.loadSavedMilwaukeeTrip();
 const stops=Array.from(vm.runInContext('lastPlanStops',context));
 assert.equal(stops.length,9,'Yard, pickup, 6 planned stops, delivery');
 assert.deepEqual(stops.slice(1).map(s=>s.kind),['pickup','break','rest','break','rest','break','rest','delivery']);
 // Customer labels are not city names: PHOENIX is the Milwaukee pickup,
 // and CANDYCO is the Springville delivery. Verify addresses separately.
 assert.equal(stops[1].name,'PHOENIX');
 assert.equal(stops[1].address,fields.pickup);
 assert.equal(stops.at(-1).name,'CANDYCO');
 assert.equal(stops.at(-1).address,fields.delivery);
 assert.match(stops[1].address,/Milwaukee, WI 53212$/);
 assert.match(stops.at(-1).address,/Springville, UT 84663$/);
 assert.equal(stops.at(-2).kind,'rest');
 assert.match(stops.at(-2).address,/Springville, UT 84663$/);
 assert.match(getElementById('status').innerHTML,/TRIP 127532 LOADED/);
 const plan=getElementById('generated').innerHTML;
 for(const name of ['Cedar Rapids','Altoona','North Platte','Sidney','Rock Springs','Springville'])
  assert.ok(plan.includes(name),'Missing '+name);
 const nav=getElementById('verifiedNavigation').innerHTML;
 for(const name of ['Open Whole Trip in Google Maps','Open Delivery in Apple Maps','Open in Trucker Path','Open Hammer — Leg 1','Open Hammer — Leg 2','Download Whole-Trip Garmin GPX','Google QR','Apple Delivery QR','Trucker Path QR','Hammer Leg 1 QR','Hammer Leg 2 QR'])
  assert.ok(nav.includes(name),'Missing export '+name);
 vm.runInContext('save=(text,name,type)=>{globalThis.testGPX={text,name,type}};downloadRouteGPX()',context);
 assert.equal((context.testGPX.text.match(/<rtept /g)||[]).length,9);
 assert.match(context.testGPX.text,/Springville/);
 getElementById('generated').textContent='Professional Driver Trip Plan';
 getElementById('plan').textContent='Professional Driver Trip Plan';
 vm.runInContext('renderTripMapPins=()=>{};printProfessionalPlan()',context);
 const print=getElementById('printReport').innerHTML;
 for(const name of ['PROFESSIONAL DRIVER TRIP PLAN','Google Maps','Apple Delivery','Trucker Path','Hammer Leg 1','Hammer Leg 2','Download Garmin GPX'])
  assert.ok(print.includes(name),'Missing PDF export '+name);
 console.log('LOCAL FULL TRIP PASS:',JSON.stringify({stops:stops.map(s=>s.name),distanceMiles:Math.round(vm.runInContext('lastRoute.distance',context)/1609.344),exports:['Google','Apple','Trucker Path','Hammer','Garmin GPX','PDF','QR']}))
});
