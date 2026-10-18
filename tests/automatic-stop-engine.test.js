const test=require('node:test');
const assert=require('node:assert/strict');
const directory=require('../stop-directory');
const {candidates}=require('../automatic-stop-engine');
const points=[{lat:40,lng:-105},{lat:40,lng:-99}];
function withDirectory(stops,fn){
 const original=directory.search;
 directory.search=()=>stops;
 try{return fn();}finally{directory.search=original;}
}
const stop=(name,brand,address,lat,lng)=>({name,brand,address,lat,lng,verifiedEntrance:false});
test('automatic stop engine ranks nearby approved Pilot stops toward mileage target',()=>{
 const list=[
 stop('Pilot early','Pilot','1 Road, Colorado',40,-104),
 stop('Pilot target','Pilot','2 Road, Colorado',40,-101),
 stop("Love's fuel","Love's",'3 Road, Colorado',40,-101.1),
 stop('Pilot off corridor','Pilot','4 Road, Colorado',42,-101),
 ];
 const result=withDirectory(list,()=>candidates({points,kind:'break',targetMiles:200}));
 assert.equal(result.stops[0].name,'Pilot target');
 assert.ok(result.stops.every(s=>s.brand==='Pilot'));
 assert.equal(result.routeVerified,false);
 assert.ok(result.stops.every(s=>s.routeVerified===false));
});
test('overnight candidates permit Love’s, but fuel-only policy does not',()=>{
 const list=[stop("Love's Overnight","Love's",'1 Overnight Lane, Colorado',40,-102)];
 const fuel=withDirectory(list,()=>candidates({points,kind:'break'}));
 const overnight=withDirectory(list,()=>candidates({points,kind:'rest'}));
 assert.equal(fuel.stops.length,0);
 assert.equal(overnight.stops.length,1);
});
test('automatic candidate search deduplicates addresses and rejects invalid coordinates',()=>{
 const list=[stop('Pilot One','Pilot','2 Road, Colorado',40,-102),stop('Pilot Duplicate','Pilot','2 road, colorado',40,-102.001)];
 const result=withDirectory(list,()=>candidates({points}));
 assert.equal(result.stops.length,1);
 assert.throws(()=>candidates({points:[{lat:Infinity,lng:0},{lat:0,lng:0}]}),/Invalid route coordinates/);
 assert.throws(()=>candidates({points,kind:'fuel'}),/Invalid search options/);
});
