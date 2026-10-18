const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {STOP_POLICY,stopWindow,brandOf,allowedBrand}=require('../stop-policy');
const html=fs.readFileSync(path.join(__dirname,'../planner.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const stops=[
 {name:'Milwaukee Pickup',address:'4041 N Richards St, Milwaukee, WI',lat:43.09,lng:-87.90,kind:'pickup'},
 {name:'Pilot Cedar Rapids',address:'8950 Earhart Ln SW, Cedar Rapids, IA',lat:41.89,lng:-91.66,kind:'break'},
 {name:'Flying J Altoona',address:'3231 Adventureland Dr, Altoona, IA',lat:41.65,lng:-93.49,kind:'rest'},
 {name:'Flying J North Platte',address:'3400 Newberry Rd, North Platte, NE',lat:41.10,lng:-100.72,kind:'break'},
 {name:'Flying J Laramie',address:'1564 N McCue St, Laramie, WY',lat:41.32,lng:-105.61,kind:'rest'},
 {name:'Springville Delivery',address:'2224 W 500 N, Springville, UT',lat:40.17,lng:-111.61,kind:'delivery'}
];
function fixture(){
 const fields={trip:'127532',driver:'Test Driver',truck:'237',trailer:'5206',network:'Pilot / Flying J only',notes:'I-94 I-80 I-15',strategy:'Two stops per day',departureTime:'2026-10-18T08:00',deliveryTime:'2026-10-21T08:00'};
 const nodes={};
 const getElementById=id=>nodes[id]??(nodes[id]={value:fields[id]||'',innerHTML:'',textContent:'',scrollIntoView(){},classList:{add(){},remove(){}},disabled:false});
 const document={getElementById,querySelector:()=>null,querySelectorAll:()=>[{textContent:'1515 mi'},{textContent:'29.2 hr'},{textContent:'4 days'}]};
 const context=vm.createContext({STOP_POLICY,stopWindow,brandOf,allowedBrand,document,window:{},sessionStorage:{getItem:()=>null},console,AbortSignal,setTimeout,Blob});
 vm.runInContext(script,context);
 context.testStops=stops;
 vm.runInContext('lastPlanStops=testStops;lastRoute={distance:1515*1609.344,duration:29.2*3600,geometry:null};',context);
 return {context,nodes,getElementById};
}
test('navigation links and all QR codes appear without manual confirmation',()=>{
 const {context,getElementById}=fixture();
 vm.runInContext('refreshStopVerification()',context);
 const nav=getElementById('verifiedNavigation').innerHTML;
 for(const label of ['WHOLE-TRIP NAVIGATION','Open Whole Trip in Google Maps','Open Delivery in Apple Maps','Apple Maps — Stop','Open in Trucker Path','Open Hammer — Leg 1','Open Hammer — Leg 2','Download Whole-Trip Garmin GPX','Whole Trip — Google QR','Apple Delivery QR','Trucker Path QR','Hammer Leg 1 QR','Hammer Leg 2 QR'])assert.ok(nav.includes(label),'Missing '+label);
 assert.equal((nav.match(/<img /g)||[]).length,5);
 assert.equal(vm.runInContext('navIsVerified()',context),true);
});
test('all stops remain in Google and Trucker Path routes; Hammer splits at five stops',()=>{
 const {context}=fixture();
 const google=vm.runInContext('googleWholeTripUrl(lastPlanStops)',context);
 const trucker=vm.runInContext('truckerPathUrl(lastPlanStops)',context);
 const hammer=vm.runInContext('hammerRouteSegments(lastPlanStops)',context);
 assert.match(decodeURIComponent(google),/41.32,-105.61/);
 assert.match(decodeURIComponent(trucker),/41.32,-105.61/);
 assert.equal(hammer.length,2);
 assert.equal(hammer[0].count,5);
 assert.equal(hammer[1].count,2);
 assert.match(decodeURIComponent(hammer[1].url),/41.32,-105.61/);
});
test('Garmin GPX exports all stops in correct order',()=>{
 const {context}=fixture();
 vm.runInContext('save=(text,name,type)=>{globalThis.testExport={text,name,type}};downloadRouteGPX();',context);
 const data=context.testExport;
 assert.match(data.name,/127532.*\.gpx$/);
 assert.equal((data.text.match(/<rtept /g)||[]).length,stops.length);
 assert.equal((data.text.match(/<wpt /g)||[]).length,stops.length);
 assert.ok(data.text.indexOf('Milwaukee Pickup')<data.text.indexOf('Springville Delivery'));
});
test('print preview contains Google, Apple, Trucker Path and Hammer QR plus Garmin download',()=>{
 const {context,getElementById}=fixture();
 getElementById('generated').textContent='Professional Driver Trip Plan';
 getElementById('plan').textContent='Professional Driver Trip Plan';
 vm.runInContext('renderTripMapPins=()=>{};printProfessionalPlan();',context);
 const html=getElementById('printReport').innerHTML;
 for(const label of ['PROFESSIONAL DRIVER TRIP PLAN','Google Maps','Apple Delivery','Trucker Path','Hammer Leg 1','Hammer Leg 2','Download Garmin GPX'])assert.ok(html.includes(label),'Missing '+label);
});
test('Pilot-only fuel and approved overnight parking networks are distinct',()=>{
 assert.equal(allowedBrand("Love's",'break','Pilot / Flying J only'),false);
 assert.equal(allowedBrand("Love's",'rest','Pilot / Flying J only'),true);
 assert.equal(allowedBrand('TA','rest','Pilot / Flying J only'),true);
 assert.equal(allowedBrand('Flying J','break','Pilot / Flying J only'),true);
});

test('overnight stop selection never repeats the current stop at zero miles',async()=>{
 const {context}=fixture();
 context.routeStrideAddressCandidates=async()=>[];
 context.fetchTimed=async url=>({
   ok:true,
   async json(){return {stops:url.includes('automatic-stop-candidates')?[
     {name:'Pilot at origin',address:'Origin address',lat:41,lng:0},
     {name:'Flying J ahead',address:'Rest address',lat:41,lng:5}
   ]:[]};}
 });
 context.routeThrough=async points=>{
   const distance=Math.abs(points[1].lng-points[0].lng)*50*1609.344;
   return {distance,duration:distance/1609.344/55*3600};
 };
 const selected=await context.selectTruckStop({lat:41,lng:0},{lat:41,lng:20},'rest','Pilot / Flying J only',6,55);
 assert.equal(selected.name,'Flying J ahead');
 assert.ok(selected.miles>=15);
});

test('Trucker Path mobile deep link carries every one of nine Milwaukee trip coordinates in order',()=>{
 const {context}=fixture();
 const full=[...stops.slice(0,1),...stops,...stops.slice(-2)];
 context.full=full;
 const url=vm.runInContext('truckerPathUrl(full)',context);
 assert.ok(url.startsWith('truckerpath://cal_route?'));
 const q=new URL(url).searchParams;
 assert.equal(q.get('saddr'),full[0].lat+','+full[0].lng);
 assert.equal(q.get('daddr'),full.at(-1).lat+','+full.at(-1).lng);
 assert.deepEqual(q.get('paddr').split('|'),full.slice(1,-1).map(p=>p.lat+','+p.lng));
});
test('Hammer mobile handoff retains all nine trip stops across numbered overlapping legs',()=>{
 const {context}=fixture();
 const full=[...stops,...stops.slice(0,3)];
 context.full=full;
 const legs=Array.from(vm.runInContext('hammerRouteSegments(full)',context));
 assert.equal(legs.length,2);
 assert.ok(legs.every(l=>l.url.startsWith('https://hammerapp.com/app/route/')));
 assert.equal(legs[0].count,5);
 assert.equal(legs[1].count,5);
 const coords=legs.flatMap((l,i)=>l.url.split('/route/')[1].split('/').map(decodeURIComponent).slice(i?1:0));
 assert.deepEqual(coords,full.map(p=>p.lat+','+p.lng));
});
