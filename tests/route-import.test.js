const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../route-import.html'),'utf8');
const code=html.slice(html.indexOf('async function recognizeImage'),html.indexOf('$("scanLoad").onclick='))
 .replace('await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs")','PDFJS');

test('image-only PDF pages are OCRed and combined for load-card import',async()=>{
 let rendered=0,recognized=0;
 const pdf={numPages:2,async getPage(n){return {
  async getTextContent(){return {items:[]}},getViewport(){return {width:400,height:600}},
  render(){rendered++;return {promise:Promise.resolve()}}
 };}};
 const worker={async setParameters(){},async recognize(){return {data:{text:`Page ${++recognized}: dispatch details and pickup address`}}}};
 const context=vm.createContext({
  PDFJS:{GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve(pdf)})},
  Tesseract:{createWorker:async()=>worker},window:{Tesseract:true},
  document:{createElement:()=>({getContext:()=>({})})},
  $:()=>({textContent:''}),console
 });
 vm.runInContext(code,context);
 const text=await context.readSheet({type:'application/pdf',name:'load-card.pdf',arrayBuffer:async()=>new ArrayBuffer(4)},'status');
 assert.match(text,/Page 1: dispatch details/);
 assert.match(text,/Page 2: dispatch details/);
 assert.equal(rendered,2);assert.equal(recognized,2);
});
