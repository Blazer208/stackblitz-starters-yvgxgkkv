const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../index.js'),'utf8');
const handler=source.slice(source.indexOf('async function osmTruckStops'),source.indexOf('async function truckRoute'));

async function request(local,fetch){
 const context=vm.createContext({
  stopDirectory:{search:()=>local,add:()=>0,count:()=>local.length},osmStopCache:new Map(),
  allowedBrand:()=>true,brandOf:()=>null,fetch,AbortSignal,URLSearchParams,console,
  json:(_res,status,body)=>({status,body})
 });
 vm.runInContext(handler,context);
 const req={method:'POST',async *[Symbol.asyncIterator](){yield JSON.stringify({points:[{lat:41,lng:-102},{lat:41,lng:-100}],kind:'break'});}};
 return context.osmTruckStops(req,{});
}
test('public stop timeout retains the usable local stop directory',async()=>{
 const local=[{name:'Pilot Travel Center',brand:'Pilot',address:'100 Truck Rd, NE',lat:41,lng:-101}];
 const result=await request(local,async()=>{throw Error('The operation was aborted due to timeout');});
 assert.equal(result.status,200);
 assert.equal(result.body.stops.length,1);
 assert.equal(result.body.stops[0].address,local[0].address);
 assert.match(result.body.provider,/local directory/);
});
test('public stop failure without local candidates reports unavailable',async()=>{
 const result=await request([],async()=>{throw Error('The operation was aborted due to timeout');});
 assert.equal(result.status,503);
});
