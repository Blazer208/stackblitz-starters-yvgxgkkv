'use strict';
// Automatic Route Stride stop candidate engine. A candidate is NOT a truck-legal route.
const directory=require('./stop-directory');
const {allowedBrand}=require('./stop-policy');
function point(p){return p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;}
function distance(a,b){const dy=(b.lat-a.lat)*69,dx=(b.lng-a.lng)*69*Math.cos((a.lat+b.lat)*Math.PI/360);return Math.hypot(dx,dy);}
function project(p,a,b){const scale=Math.cos((a.lat+b.lat)*Math.PI/360),dx=(b.lng-a.lng)*69*scale,dy=(b.lat-a.lat)*69,px=(p.lng-a.lng)*69*scale,py=(p.lat-a.lat)*69;const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy||1)));return {progress:t,corridorMiles:Math.hypot(px-t*dx,py-t*dy)};}
function candidates({points,kind='break',network='Pilot / Flying J only',targetMiles=250,maxCorridorMiles=110}){
 if(!Array.isArray(points)||points.length<2||points.length>25||!points.every(point))throw Error('Invalid route coordinates');
 if(!['break','rest'].includes(kind)||!Number.isFinite(targetMiles)||targetMiles<0||!Number.isFinite(maxCorridorMiles)||maxCorridorMiles<1||maxCorridorMiles>150)throw Error('Invalid search options');
 const legs=points.slice(1).map((p,i)=>({a:points[i],b:p,length:distance(points[i],p)}));const total=legs.reduce((s,l)=>s+l.length,0);
 let offset=0;const ranked=new Map();
 for(const leg of legs){
  for(const stop of directory.search(leg.a,leg.b,brand=>allowedBrand(brand,kind,network),maxCorridorMiles)){
   if(!point(stop)||!stop.address||!allowedBrand(stop.brand,kind,network))continue;
   const pos=project(stop,leg.a,leg.b);if(pos.corridorMiles>maxCorridorMiles)continue;
   const estimatedProgressMiles=offset+leg.length*pos.progress;
   const key=stop.brand+':'+stop.address.toLowerCase().replace(/\s+/g,' ').trim();
   const entry={...stop,estimatedProgressMiles,corridorMiles:pos.corridorMiles,verifiedEntrance:stop.verifiedEntrance===true,routeVerified:false,score:Math.abs(estimatedProgressMiles-targetMiles)+pos.corridorMiles*3};
   if(!ranked.has(key)||entry.score<ranked.get(key).score)ranked.set(key,entry);
  }offset+=leg.length;
 }
 return {stops:[...ranked.values()].sort((a,b)=>a.score-b.score).slice(0,50),estimatedStraightLineMiles:total,routeVerified:false,notice:'Automatically ranked directory candidates. Requires commercial truck road-network routing before navigation or HOS mileage is approved.'};
}
module.exports={candidates};
