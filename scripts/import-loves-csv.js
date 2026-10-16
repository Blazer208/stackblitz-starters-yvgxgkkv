#!/usr/bin/env node
// Import a licensed/open-data Love's location CSV into Route Stride's stop directory.
// Usage: node scripts/import-loves-csv.js /path/to/loves.csv
// Expected columns: storeNumber,name,address,city,state,zip,latitude,longitude,type,source
// Source must permit local reuse. No scraping or API credential bypass.
'use strict';
const fs=require('fs'),path=require('path');
const input=process.argv[2];if(!input){console.error('Usage: node scripts/import-loves-csv.js file.csv');process.exit(2);}
function parseCSV(text){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}else field+=c;}row.push(field);if(row.some(x=>x.trim()))rows.push(row);return rows;}
const rows=parseCSV(fs.readFileSync(input,'utf8'));const headers=rows.shift().map(s=>s.trim().toLowerCase().replace(/[^a-z0-9]/g,''));const required=['storenumber','address','city','state','latitude','longitude'];for(const col of required)if(!headers.includes(col))throw Error('Missing required column '+col);
const get=(r,k)=>r[headers.indexOf(k)]?.trim()||'';
const output=process.env.STOP_DIRECTORY_PATH||'/data/truck-stops.json';
let existing=[];try{existing=JSON.parse(fs.readFileSync(output,'utf8'));if(!Array.isArray(existing))existing=[];}catch(e){if(e.code!=='ENOENT')throw e;}
let imported=0,skipped=0;const byKey=new Map(existing.map(p=>[p.brand+':'+(p.storeNumber||p.lat+':'+p.lng),p]));
for(const row of rows){const lat=Number(get(row,'latitude')),lng=Number(get(row,'longitude')),number=get(row,'storenumber'),type=get(row,'type').toLowerCase(),address=get(row,'address'),city=get(row,'city'),state=get(row,'state');
if(!number||!address||!city||!/^[A-Z]{2}$/.test(state.toUpperCase())||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<18||lat>72||lng< -170||lng> -60||type.includes('speedco')||type.includes('country store')){skipped++;continue;}
const p={name:get(row,'name')||"Love's Travel Stop #"+number,brand:"Love's",storeNumber:number,address:[address,city,state.toUpperCase(),get(row,'zip')].filter(Boolean).join(', '),lat,lng,source:get(row,'source')||'Licensed/imported location data',collectedAt:new Date().toISOString(),verifiedEntrance:false};
byKey.set("Love's:"+number,p);imported++;}
const result=[...byKey.values()];fs.mkdirSync(path.dirname(output),{recursive:true});const tmp=output+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(result,null,2));fs.renameSync(tmp,output);console.log(JSON.stringify({imported,skipped,total:result.length,path:output,warning:'GPS points and truck entrances require separate verification'}));
