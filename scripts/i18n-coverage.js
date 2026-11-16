'use strict';
const fs=require('node:fs'),path=require('node:path');
const {parseHTML}=require('linkedom');
const {normalize}=require('../i18n');
const brands=new Set(['RS','Route Stride','ROUTE STRIDE','🚛 ROUTE STRIDE','◢ ROUTE STRIDE','DAT','Truckstop','123Loadboard','DISPATCH','PRO','DISPATCH PRO','← Dispatch Pro','Powerball','Mega Millions','Google Maps','Garmin GPX','Apple Maps','Trucker Path','PC*MILER','HOS','ELD','GPX','PDF','QR','Buhl, ID']);
function strings(html){
 const {document}=parseHTML(html),result=new Set();
 const walk=document.createTreeWalker(document,4);let node;
 function add(text){text=normalize(text);if(/[A-Za-z]{2}/.test(text)&&!brands.has(text)&&!/^\d+.*(?:\b[A-Z]{2}\s+\d{5}|\bmi\b)/.test(text))result.add(text);}
 while(node=walk.nextNode()){
  if(node.parentElement?.closest('script,style,textarea,input,pre,code,[translate="no"],[data-no-translate],[data-language-controls],[data-local-date],[data-i18n-block]'))continue;
  add(node.nodeValue);
 }
 for(const block of document.querySelectorAll('[data-i18n-block]'))add(block.getAttribute('data-i18n-block'));
 for(const el of document.querySelectorAll('[placeholder],[aria-label],[title],[alt]')){
  if(el.closest('[translate="no"],[data-no-translate],[data-language-controls],[data-local-date],[data-i18n-block]'))continue;
  for(const attr of ['placeholder','aria-label','title','alt'])if(el.hasAttribute(attr))add(el.getAttribute(attr));
 }
 return [...result];
}
function pages(root=path.join(__dirname,'..')){return Object.fromEntries(fs.readdirSync(root).filter(p=>p.endsWith('.html')).map(p=>[p,strings(fs.readFileSync(path.join(root,p),'utf8'))]));}
if(require.main===module){const catalog=require('../i18n-messages.json');const data=pages();for(const [file,items]of Object.entries(data))console.log(file,JSON.stringify(items.filter(s=>!catalog[s])));}
function uncovered(items){
 const catalog=require('../i18n-messages.json'),{translator}=require('../i18n');
 const mask=translator(Object.fromEntries(Object.keys(catalog).map(k=>[k,Array(5).fill('◇')])),'es');
 const proper=/Route Stride|Dispatch Pro|Pilot|Flying J|Love's|TA|Petro|Google|Apple|Garmin|GPS|QR|GPX|PDF|PC\*MILER|Idaho Falls|Denver|Buhl|Boardman|Jerome|Travel Center|ID|CO|I-\d+|US-\d+/gi;
 return items.map(s=>[s,mask(s).replace(proper,'')]).filter(([s,r])=>/[A-Za-z]{2}/.test(r));
}
module.exports={strings,pages,uncovered};
