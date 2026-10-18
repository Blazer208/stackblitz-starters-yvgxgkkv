'use strict';
// Route Stride stop directory: verified-source candidates, not verified entrances.
// Stored on the configured persistent Railway volume when available.
const fs=require('fs'),path=require('path');
const file=process.env.STOP_DIRECTORY_PATH||'/data/truck-stops.json';
let records=[];
try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(data))records=data.filter(valid).slice(0,25000);}catch(e){if(e.code!=='ENOENT')console.warn('Stop directory unavailable:',e.message);}
function valid(p){return p&&typeof p.name==='string'&&typeof p.address==='string'&&p.address.length>5&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180&&['Pilot','Flying J','Love\'s','One9','TA','Petro','Little America'].includes(p.brand);}
// Bundled TA/Petro directory seed: loaded at startup even without a Railway volume.
try{
 const seeded=require('./data/ta-petro-seed.json');
 const seen=new Set(records.map(p=>p.brand+':'+p.lat.toFixed(5)+':'+p.lng.toFixed(5)));
 for(const p of seeded){if(!valid(p))continue;const k=p.brand+':'+p.lat.toFixed(5)+':'+p.lng.toFixed(5);if(!seen.has(k)){records.push(p);seen.add(k);}}
}catch(e){console.warn('Bundled TA/Petro directory unavailable:',e.message);}
// User-supplied TruckerPro listing and map screenshot; GPS point is on the property.
const starterStops=[{name:'Pilot Travel Center #602',brand:'Pilot',storeNumber:'602',address:'224 Daniel Payne Dr, Birmingham, AL 35207',phone:'205-323-2177',lat:33.5621,lng:-86.8307,source:'User-supplied TruckerPro listing and map screenshot',verifiedEntrance:false,preliminary:true}];
// Coordinates from the driver's previously saved Milwaukee-to-Springville trip.
// These are planning candidates, not verified truck entrances.
starterStops.push(
 {name:'Pilot Travel Center #1092',brand:'Pilot',address:'8950 Earhart Ln SW, Cedar Rapids, IA 52404',lat:41.891411,lng:-91.667110,source:'Driver saved trip 127532',verifiedEntrance:false},
 {name:'Flying J Travel Center #913',brand:'Flying J',address:'3231 Adventureland Dr, Altoona, IA 50009',lat:41.6595404,lng:-93.4993059,source:'Driver saved trip 127532',verifiedEntrance:false},
 {name:'Flying J Travel Center #687',brand:'Flying J',address:'3400 S Newberry Rd, North Platte, NE 69101',lat:41.1014250,lng:-100.7269794,source:'Driver saved trip 127532',verifiedEntrance:false},
 {name:"Love's Travel Stop #625",brand:"Love's",address:'645 Chase Blvd, Sidney, NE 69162',lat:41.1093776,lng:-102.9526677,source:'Driver saved trip 127532',verifiedEntrance:false},
 {name:'Flying J Travel Center #764',brand:'Flying J',address:'650 Stagecoach Blvd, Rock Springs, WY 82901',lat:41.6090307,lng:-109.2305669,source:'Driver saved trip 127532',verifiedEntrance:false},
 {name:'Pilot Travel Center #747',brand:'Pilot',address:'1460 N 1750 W, Springville, UT 84663',lat:40.1875538,lng:-111.6415642,source:'Driver saved trip 127532',verifiedEntrance:false}
);
for(const p of starterStops){if(!records.some(r=>r.brand===p.brand&&((p.storeNumber&&r.storeNumber===p.storeNumber)||(Math.abs(r.lat-p.lat)<0.0001&&Math.abs(r.lng-p.lng)<0.0001))))records.push(p);}
function miles(a,b){const rad=Math.PI/180,dy=(a.lat-b.lat)*69,dx=(a.lng-b.lng)*69*Math.cos((a.lat+b.lat)*rad/2);return Math.hypot(dx,dy);}
function nearSegment(p,a,b){const dy=(b.lat-a.lat)*69,dx=(b.lng-a.lng)*69*Math.cos((a.lat+b.lat)*Math.PI/360);const py=(p.lat-a.lat)*69,px=(p.lng-a.lng)*69*Math.cos((a.lat+b.lat)*Math.PI/360);const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy||1)));return Math.hypot(px-t*dx,py-t*dy);}
function search(a,b,allowed,maxCorridorMiles=110){return records.filter(p=>allowed(p.brand)&&nearSegment(p,a,b)<=maxCorridorMiles).sort((x,y)=>miles(x,a)-miles(y,a)).slice(0,250);}
function add(stops){let count=0;const keys=new Set(records.map(p=>p.brand+':'+p.lat.toFixed(4)+':'+p.lng.toFixed(4)));for(const s of stops){if(!valid(s))continue;const k=s.brand+':'+s.lat.toFixed(4)+':'+s.lng.toFixed(4);if(keys.has(k))continue;records.push({...s,source:'OpenStreetMap contributors (ODbL)',collectedAt:new Date().toISOString(),verifiedEntrance:false});keys.add(k);count++;}if(count){records=records.slice(-25000);try{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(records));fs.renameSync(tmp,file);}catch(e){console.warn('Stop directory persistence unavailable:',e.message);}}return count;}
module.exports={search,add,count:()=>records.length};
