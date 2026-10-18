const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {STOP_POLICY,stopWindow,brandOf,allowedBrand}=require('../stop-policy');
const html=fs.readFileSync(path.join(__dirname,'../planner.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const code=scripts.find(m=>m[1].includes('async function geocodeOne'))[1];
function run(hit){
 const ctx=vm.createContext({STOP_POLICY,stopWindow,brandOf,allowedBrand,document:{getElementById:()=>({value:''}),querySelector:()=>null},window:{},sessionStorage:{getItem:()=>null},console,AbortSignal,setTimeout,Blob});
 vm.runInContext(code,ctx);
 ctx.fetchTimed=async()=>({ok:true,json:async()=>[hit]});
 return ctx;
}
const correct={lat:'41.891',lon:'-91.667',display_name:'Pilot, Cedar Rapids, Iowa',address:{'ISO3166-2-lvl4':'US-IA',postcode:'52404'}};
test('geocoding rejects a first result in a different state',async()=>{
 const ctx=run({...correct,address:{'ISO3166-2-lvl4':'US-WI',postcode:'52404'}});
 assert.equal(await ctx.geocodeOne('8950 Earhart Ln SW, Cedar Rapids, IA 52404'),null);
});
test('geocoding rejects a first result with a different ZIP code',async()=>{
 const ctx=run({...correct,address:{'ISO3166-2-lvl4':'US-IA',postcode:'50009'}});
 assert.equal(await ctx.geocodeOne('8950 Earhart Ln SW, Cedar Rapids, IA 52404'),null);
});
test('geocoding accepts matching state and ZIP and rejects invalid coordinates',async()=>{
 const ctx=run(correct);
 const found=await ctx.geocodeOne('8950 Earhart Ln SW, Cedar Rapids, IA 52404');
 assert.equal(found.lat,41.891);assert.equal(found.lng,-91.667);
 const bad=run({...correct,lat:'NaN'});
 assert.equal(await bad.geocodeOne('8950 Earhart Ln SW, Cedar Rapids, IA 52404'),null);
});
test('print report prominently warns when road network has not checked truck restrictions',()=>{
 assert.match(code,/PLANNING ESTIMATE — NOT A VERIFIED TRUCK-SAFE ROUTE/);
 assert.match(code,/bridge height, axle\/weight limits/);
});
