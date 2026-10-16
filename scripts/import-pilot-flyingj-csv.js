#!/usr/bin/env node
// Route Stride Pilot / Flying J location import (editable preliminary candidates).
// CSV: brand,storeNumber,name,address,city,state,zip,latitude,longitude,source
// Entries lacking GPS are staged separately until geocoded; no invented coordinates.
'use strict';
const fs=require('fs'),path=require('path');
const input=process.argv[2];if(!input){console.error('Usage: node scripts/import-pilot-flyingj-csv.js locations.csv');process.exit(2);}
function parse(text){let rows=[],row=[],v='',q=false;for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){if(q&&text[i+1]==='"'){v+='"';i++;}else q=!q;}else if(c===','&&!q){row.push(v);v='';}else if((c==='\r'||c==='\n')&&!q){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);if(row.some(Boolean))rows.push(row);row=[];v='';}else v+=c;}row.push(v);if(row.some(Boolean))rows.push(row);return rows;}
const rows=parse(fs.readFileSync(input,'utf8')),headers=rows.shift().map(x=>x.trim().toLowerCase().replace(/[^a-z0-9]/g,''));const get=(r,k)=>r[headers.indexOf(k)]?.trim()||'';
const file=process.env.STOP_DIRECTORY_PATH||'/data/truck-stops.json',staged=file.replace(/\.json$/,'-pending.json');
let entries=[];try{entries=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(entries))entries=[];}catch(e){if(e.code!=='ENOENT')throw e;}
let pending=[];try{pending=JSON.parse(fs.readFileSync(staged,'utf8'));if(!Array.isArray(pending))pending=[];}catch(e){if(e.code!=='ENOENT')throw e;}
let loaded=0,queued=0,skipped=0;
for(const r of rows){const b=get(r,'brand').toLowerCase().replace(/[^a-z]/g,''),brand=b==='pilot'?'Pilot':b==='flyingj'?'Flying J':null,number=get(r,'storenumber'),address=[get(r,'address'),get(r,'city'),get(r,'state'),get(r,'zip')].filter(Boolean).join(', '),lat=Number(get(r,'latitude')),lng=Number(get(r,'longitude'));if(!brand||!number||!get(r,'city')||!get(r,'state')){skipped++;continue;}
const item={brand,storeNumber:number,name:get(r,'name')||brand+' #'+number,address,source:get(r,'source')||'User supplied location list',verifiedEntrance:false,preliminary:true};const key=p=>p.brand+':'+p.storeNumber;
if(get(r,'latitude')&&get(r,'longitude')&&Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=18&&lat<=72&&lng>=-170&&lng<=-60&&get(r,'address')){item.lat=lat;item.lng=lng;entries=entries.filter(p=>key(p)!==key(item));entries.push(item);loaded++;}else{pending=pending.filter(p=>key(p)!==key(item));pending.push(item);queued++;}}
fs.mkdirSync(path.dirname(file),{recursive:true});for(const [dest,data] of [[file,entries],[staged,pending]]){const tmp=dest+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2));fs.renameSync(tmp,dest);}
console.log(JSON.stringify({loaded,queued,skipped,total:entries.length,pending:pending.length,note:'Only geocoded entries are eligible for route selection; all imported locations remain editable preliminary candidates.'}));
