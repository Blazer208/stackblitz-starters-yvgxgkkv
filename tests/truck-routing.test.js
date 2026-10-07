const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeRequest,routeReports}=require('../truck-routing');
const stops=[{lat:43.49,lng:-112.04,name:'Origin'},{lat:42.88,lng:-87.94,name:'Destination'}];
test('requires key and verified truck profile',async()=>{
 await assert.rejects(routeReports(stops,{apiKey:''}),{code:'NOT_CONFIGURED'});
 assert.throws(()=>makeRequest(stops,''),/profile/);
});
test('rejects unresolved stops rather than silently dropping them',()=>assert.throws(()=>makeRequest([...stops,{lat:null,lng:null}],'Verified profile'),/coordinates/));
test('sends ordered stops and key only to the fixed provider endpoint',async()=>{
 const result=await routeReports(stops,{apiKey:'TEST_KEY',profileName:'Verified profile',fetchImpl:async(url,req)=>{
 assert.equal(new URL(url).hostname,'pcmiler.alk.com');assert.equal(req.headers.Authorization,'TEST_KEY');
 const data=JSON.parse(req.body);assert.equal(data.ReportRoutes[0].Stops.length,2);assert.equal(data.ReportRoutes[0].Options.OverrideRestrict,false);
 return {ok:true,json:async()=>[{RouteId:'test'}]};}});
 assert.equal(result.stopPlanningComplete,false);assert(!JSON.stringify(result).includes('TEST_KEY'));
});
test('provider failures never fall back to car routing',async()=>{
 await assert.rejects(routeReports(stops,{apiKey:'test',profileName:'Verified profile',fetchImpl:async()=>({ok:false,status:403})}),/HTTP 403/);
 await assert.rejects(routeReports(stops,{apiKey:'test',profileName:'Verified profile',fetchImpl:async()=>{throw new Error('secret');}}),/No fallback/);
 await assert.rejects(routeReports(stops,{apiKey:'test',profileName:'Verified profile',fetchImpl:async()=>({ok:true,json:async()=>[]})}),/no usable/);
});
