'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const {start,languages,translator}=require('../i18n');
const messages=require('../i18n-messages.json');
const root=path.join(__dirname,'..');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function page(html,storage=new Map()){
 const {window}=parseHTML(html);const requests=[];
 window.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 window.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>messages};};
 window.alert=()=>{};
 const api=start(window);
 return {window,document:window.document,api,storage,requests};
}
test('all six languages switch repeatedly, restore English and preserve entered data, options and URLs',async()=>{
 const html='<html><head><title>Dispatch Pro — Sign In</title></head><body><h1>Build Trip</h1><p id="status">Generate Trip Plan</p><input id="driver" value="Day Pickup Load"><textarea>I-80 → US-287</textarea><select><option>Pilot / Flying J only</option></select><div class="addr">10 Delivery Lane, May, ID 83401</div><span id="accountName">Day Driver</span><code>SECRET-Trip-Day</code><a href="https://maps.apple.com/?daddr=10%20Delivery%20Lane">Open Delivery in Apple Maps</a><div data-i18n-block="Professional OTR trip planning made simple.">Professional <strong>OTR trip planning</strong> made simple.</div></body></html>';
 const p=page(html);await p.api.ready;const original=()=>[p.document.querySelector('input').value,p.document.querySelector('textarea').value,p.document.querySelector('option').getAttribute('value'),p.document.querySelector('.addr').textContent,p.document.querySelector('#accountName').textContent,p.document.querySelector('code').textContent,p.document.querySelector('a').getAttribute('href')];
 const before=original();
 for(let round=0;round<2;round++)for(const {code}of languages){
  p.api.setLanguage(code);await settle();
  assert.equal(p.document.documentElement.lang,code);assert.equal(p.document.documentElement.dir,['ur','ar'].includes(code)?'rtl':'ltr');
  assert.equal(p.document.querySelector('h1').textContent,translator(messages,code)('Build Trip'));
  assert.equal(p.api.sourceText(p.document.querySelector('h1')),'Build Trip');
  assert.deepEqual(original(),before);assert.equal(p.document.querySelectorAll('button[aria-pressed="true"]').length,1);
  assert.equal(p.document.querySelector('[data-i18n-block]').textContent,translator(messages,code)('Professional OTR trip planning made simple.'));
 }
 p.api.setLanguage('en');assert.equal(p.document.querySelector('[data-i18n-block]').innerHTML,'Professional <strong>OTR trip planning</strong> made simple.');
 assert.deepEqual(p.requests,['/i18n-messages.json']);
 p.api.setLanguage('uk');const next=page('<html><head></head><body><h1>Sign In</h1></body></html>',p.storage);await next.api.ready;
 assert.equal(next.api.language,'uk');assert.equal(next.document.querySelector('h1').textContent,messages['Sign In'][4]);
});
test('dynamically added report text and changing status translate from source without an observer loop',async()=>{
 const p=page('<html><head></head><body><div id="report"></div></body></html>');await p.api.ready;p.api.setLanguage('ar');
 const report=p.document.querySelector('#report');report.innerHTML='<h2>Professional Driver Trip Plan</h2><p>PRELIMINARY PLAN ONLY</p><span translate="no">Driver Delivery</span>';
 await settle();assert.equal(report.querySelector('h2').textContent,messages['Professional Driver Trip Plan'][2]);
 assert.match(p.api.sourceText(report),/PRELIMINARY PLAN ONLY/);
 report.querySelector('p').textContent='Trip plan could not finish';await settle();assert.equal(report.querySelector('p').textContent,messages['Trip plan could not finish'][2]);
 p.api.setLanguage('ru');await settle();assert.equal(report.querySelector('p').textContent,messages['Trip plan could not finish'][3]);
 p.api.setLanguage('en');assert.equal(report.querySelector('p').textContent,'Trip plan could not finish');assert.equal(report.querySelector('span').textContent,'Driver Delivery');
});
test('every shipped HTML page integrates same-origin language assets and native direction controls',async()=>{
 for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.html'))){
  const html=fs.readFileSync(path.join(root,file),'utf8');assert.match(html,/href="\/i18n.css"/);assert.match(html,/src="\/i18n.js" defer/);
  const p=page(html);await p.api.ready;
  const inputs=Array.from(p.document.querySelectorAll('input,textarea,select'),el=>el.value);
  const urls=Array.from(p.document.querySelectorAll('[href],[src]'),el=>el.getAttribute('href')||el.getAttribute('src'));
  for(const {code}of languages){p.api.setLanguage(code);await settle();assert.deepEqual(Array.from(p.document.querySelectorAll('input,textarea,select'),el=>el.value),inputs,file+' '+code);assert.deepEqual(Array.from(p.document.querySelectorAll('[href],[src]'),el=>el.getAttribute('href')||el.getAttribute('src')),urls,file+' URLs '+code);}
 }
});
test('lottery rerenders localized dates immediately without fetching again or losing expanded history',async()=>{
 const p=page('<html><head></head><body><div data-lottery-ticker></div></body></html>');await p.api.ready;
 const draw={date:'2026-11-14',numbers:[1,12,23,34,45],specialBall:6,powerPlay:2};
 const records=['powerball','mega-millions'].map(id=>({id,status:'fresh',estimatedJackpot:200000000,cashValue:100000000,nextDrawDate:'2026-11-17',latest:draw,recent:[draw],checkedAt:'2026-11-16T14:00:00Z'}));
 let requests=0;
 const ctx=vm.createContext({window:p.window,document:p.document,fetch:async()=>{requests++;return {ok:true,json:async()=>({games:records})};},Intl,AbortSignal,setInterval:()=>{},console});
 vm.runInContext(fs.readFileSync(path.join(root,'lottery-ticker.js'),'utf8'),ctx);await settle();
 const details=p.document.querySelector('details');details.open=true;details.setAttribute('open','');
 const urls=Array.from(p.document.querySelectorAll('a'),a=>a.href);const numbers=Array.from(p.document.querySelectorAll('.lottery-ball'),b=>b.textContent);
 for(const {code}of languages){p.api.setLanguage(code);await settle();assert.equal(requests,1);assert.equal(p.document.querySelector('details').open,true);assert.deepEqual(Array.from(p.document.querySelectorAll('.lottery-ball'),b=>b.textContent),numbers);assert.deepEqual(Array.from(p.document.querySelectorAll('a'),a=>a.href),urls);const expected=new Intl.DateTimeFormat(p.api.locale(),{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date('2026-11-14T12:00:00Z'));assert.equal(p.document.querySelector('.lottery-draw-date').textContent,expected);}
});
test('full saved-trip navigation, print and GPX survive all six language switches with real page DOM',async()=>{
 const html=fs.readFileSync(path.join(root,'planner.html'),'utf8');const p=page(html);await p.api.ready;
 for(const el of p.document.querySelectorAll('*'))el.scrollIntoView=()=>{};
 p.document.querySelector('#driver').value='Day Driver Pickup';p.document.querySelector('#yard').value='10 Delivery Lane, May, ID 83401';p.document.querySelector('#notes').value='I-80 → US-287; Day Truck Load';
 const policy=require('../stop-policy');
 const ctx=vm.createContext({...policy,window:p.window,document:p.document,sessionStorage:{getItem:()=>null},console,AbortSignal,setTimeout,Blob});
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],ctx);
 ctx.geocode=async address=>({lat:43.09,lng:-87.9,address});ctx.routeThrough=async()=>({distance:1500*1609.344,duration:29*3600,geometry:null});
 await ctx.loadSavedMilwaukeeTrip();await settle();
 vm.runInContext('save=(text,name,type)=>{globalThis.testGPX={text,name,type}};renderTripMapPins=()=>{};downloadRouteGPX()',ctx);
 const originalGPX=ctx.testGPX.text,model=JSON.stringify(vm.runInContext('lastPlanStops',ctx));
 const navUrls=()=>Array.from(p.document.querySelectorAll('#verifiedNavigation a'),a=>a.getAttribute('href'));
 const urls=navUrls();assert.ok(urls.length>10);
 for(const {code}of languages){
  p.api.setLanguage(code);await settle();ctx.printProfessionalPlan();await settle();
  assert.equal(p.document.querySelector('#printReport .prSub').textContent,translator(messages,code)('PROFESSIONAL DRIVER TRIP PLAN'));
  assert.equal(p.document.querySelector('#driver').value,'Day Driver Pickup');
  assert.ok(p.document.querySelector('#printReport').textContent.includes('Day Driver Pickup'));
  assert.ok(p.document.querySelector('#printReport').textContent.includes('10 Delivery Lane, May, ID 83401'));
  assert.ok(p.document.querySelector('#printReport').textContent.includes('I-80 → US-287; Day Truck Load'));
  assert.deepEqual(navUrls(),urls);assert.equal(JSON.stringify(vm.runInContext('lastPlanStops',ctx)),model);
  ctx.downloadRouteGPX();assert.equal(ctx.testGPX.text,originalGPX);
  for(const time of p.document.querySelectorAll('time[data-local-date]'))assert.equal(time.textContent,new Intl.DateTimeFormat(p.api.locale(),JSON.parse(time.getAttribute('data-local-date'))).format(new Date(time.getAttribute('datetime'))));
 }
 p.api.setLanguage('en');await settle();assert.match(p.document.querySelector('#generated').textContent,/Professional Driver Trip Plan/);

});

test('all published page copy has catalog coverage in all five translated languages',()=>{
 const {pages,uncovered}=require('../scripts/i18n-coverage');
 for(const [file,strings]of Object.entries(pages()))assert.deepEqual(uncovered(strings),[],file);
});
