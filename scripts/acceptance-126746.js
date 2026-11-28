'use strict';
// Runs the real app planner and authenticated API against an isolated local
// account database and the configured public geocoder/road-estimate provider.
// Does not create accounts or modify data in production.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {hash}=require('../auth');
const policy=require('../stop-policy');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'route-stride-acceptance-'));
const base='http://127.0.0.1:31949',setup=crypto.randomBytes(32).toString('base64url');
const fields={trip:'126746',driver:'Acceptance tester',truck:'237',trailer:'5203',yard:'3916 W 65th S, Idaho Falls, ID 83402',pickup:'3916 W 65th S, Idaho Falls, ID 83402',delivery:'9950 S Reinhart Dr, Oak Creek, WI 53154',maxHours:'9',avgSpeed:'55',cycle:'52.5',network:'Pilot / Flying J only',notes:'US-20 / ID-87 / MT-87 / US-287 / MT-84 / US-191 / I-90 / I-94 / I-694 / I-94 / I-41 / WI-100',departureTime:'2026-08-16T06:00',deliveryTime:'2026-08-20T09:00',overallFeet:'75',widthInches:'102',heightInches:'162',grossWeight:'80000',trailerFeet:'53',commodity:'Potatoes',weight:'42,000 lb'};
const child=spawn(process.execPath,['index.js'],{cwd:root,env:{...process.env,PORT:'31949',APP_ORIGIN:base,AUTH_DB_PATH:path.join(temp,'accounts.sqlite'),STOP_DIRECTORY_PATH:path.join(temp,'stops.json'),OWNER_SETUP_TOKEN_HASH:hash(setup),TRIMBLE_API_KEY:''},stdio:['ignore','pipe','pipe']});
child.stderr.on('data',d=>process.stderr.write(d));
async function main(){
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Isolated server startup timeout')),15000);child.stdout.on('data',d=>{if(String(d).includes('listening')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Server exited'));});});
 const signup=await fetch(base+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({name:'Acceptance tester',email:'acceptance@example.com',password:'Isolated acceptance '+crypto.randomBytes(16).toString('hex'),invite:setup})});
 assert.equal(signup.status,201,'isolated account creation');
 const cookie=signup.headers.get('set-cookie').split(';')[0];
 const page=await fetch(base+'/planner.html',{headers:{Cookie:cookie}});assert.equal(page.status,200);
 const html=await page.text(),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const nodes={};const getElementById=id=>nodes[id]??(nodes[id]={value:fields[id]||'',innerHTML:'',textContent:'',disabled:false,checked:false,style:{},classList:{add(){},remove(){}},setAttribute(k,v){this[k]=v},prepend(){},scrollIntoView(){}});
 const doc={getElementById,createElement:()=>({}),querySelector:()=>null,querySelectorAll:()=>[]};
 let lastGeo=0;
 const geocache=new Map();
 const browserFetch=async(url,options={})=>{
  if(url.startsWith('/'))return fetch(base+url,{...options,headers:{...options.headers,Origin:base,Cookie:cookie}});
  if(!url.startsWith('https://nominatim.openstreetmap.org/'))throw Error('Unexpected external provider');
  if(geocache.has(url))return geocache.get(url).clone();
  await new Promise(r=>setTimeout(r,Math.max(0,1100-(Date.now()-lastGeo))));
  lastGeo=Date.now();
  const response=await fetch(url,{...options,headers:{...options.headers,'User-Agent':'RouteStride acceptance test (one isolated route; https://route-stride-live-production-b6a0.up.railway.app/)'}});
  if(response.ok)geocache.set(url,response.clone());
  else console.warn('Geocoder HTTP',response.status);
  return response;
 };
 const context=vm.createContext({...policy,document:doc,window:{},sessionStorage:{getItem:()=>null},console,AbortSignal,setTimeout,Blob,fetch:browserFetch,alert:message=>{throw Error(String(message));}});
 vm.runInContext(script,context);
 await context.buildPlan();
 const stops=Array.from(vm.runInContext('lastPlanStops',context));
 if(!stops.length)throw Error('Trip generation failed: '+getElementById('status').innerHTML);
 assert.equal(stops[0].address,fields.pickup);assert.equal(stops.at(-1).address,fields.delivery);
 assert.ok(stops.some(s=>s.kind==='break'),'at least one fuel/break');assert.ok(stops.some(s=>s.kind==='rest'),'at least one overnight');
 let daily=0,cycle=0;
 for(const s of stops.slice(1)){assert.ok(s.address&&Number.isFinite(s.lat)&&Number.isFinite(s.lng));assert.ok(Number.isFinite(s.driveHours)&&s.driveHours>=0);daily+=s.driveHours;cycle+=s.driveHours;assert.ok(daily<=9.0001,'daily drive limit');if(s.kind==='rest')daily=0;}
 assert.ok(cycle<=52.5,'cycle drive limit');
 const nav=getElementById('verifiedNavigation').innerHTML;
 for(const term of ['Open Whole Trip in Google Maps','Open Delivery in Apple Maps','Apple Delivery QR','Google QR','Download Whole-Trip Garmin GPX'])assert.ok(nav.includes(term),'missing '+term);
 vm.runInContext('save=(text,name,type)=>{globalThis.acceptanceGPX={text,name,type}};downloadRouteGPX()',context);
 assert.equal((context.acceptanceGPX.text.match(/<rtept /g)||[]).length,stops.length);
 getElementById('generated').textContent='Professional Driver Trip Plan';getElementById('plan').textContent='Professional Driver Trip Plan';
 vm.runInContext('renderTripMapPins=()=>{};printProfessionalPlan()',context);
 const print=getElementById('printReport').innerHTML;
 for(const stop of stops)assert.ok(print.includes(context.esc(stop.address)),'print missing stop address');
 assert.ok(print.includes('Directions QR'),'print QR');
 console.log('ISOLATED LIVE-PROVIDER ACCEPTANCE PASS',JSON.stringify({trip:fields.trip,stops:stops.map(s=>({kind:s.kind||'pickup',name:s.name,miles:s.miles,hours:s.driveHours})),cycle,checks:['authenticated planner','route generation','daily and cycle driving estimates','navigation HTML','GPX serialization','print HTML']}));
 console.log('Not a production browser test: mobile navigation, physical truck restrictions, parking availability, PDF file save and stop replacement require separate verification.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(child.exitCode===null){await new Promise(r=>{child.once('exit',r);child.kill();});}fs.rmSync(temp,{recursive:true,force:true});});
