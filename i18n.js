'use strict';
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root?.document)api.start(root);
})(typeof window==='object'?window:null,function(){
 const languages=[{code:'en',name:'English'},{code:'es',name:'Español'},{code:'ur',name:'اردو'},{code:'ar',name:'العربية'},{code:'ru',name:'Русский'},{code:'uk',name:'Українська'}];
 const supported=code=>languages.some(l=>l.code===code);
 const normalize=text=>String(text).replace(/\s+/g,' ').trim();
 function translator(messages,language){
  const index=languages.findIndex(l=>l.code===language)-1;
  const dictionary=new Map(Object.entries(messages).map(([key,value])=>[normalize(key),value[index]]));
  const folded=new Map([...dictionary].map(([key,value])=>[key.toLowerCase(),value]));
  const phrases=[...dictionary].filter(([key,value])=>value&&key.length>=2).sort((a,b)=>b[0].length-a[0].length);
  return function translate(source){
   if(index<0)return source;
   const key=normalize(source),exact=dictionary.get(key)||folded.get(key.toLowerCase());
   if(exact)return source.replace(/^(\s*)[\s\S]*?(\s*)$/,(_,a,b)=>a+exact+b);
   // Longer UI phrases are replaced first. Placeholders protect translations
   // from being translated again. Names, addresses and form values are excluded
   // by the DOM walker below, rather than sent to a translation service.
   let result=source;const values=[];
   for(const [english,translated]of phrases){
    if(!result.toLowerCase().includes(english.toLowerCase()))continue;
    const safe=english.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const pattern=new RegExp('(?<![A-Za-z])'+safe+'(?![A-Za-z])','gi');
    result=result.replace(pattern,()=>{values.push(translated);return '\uE000'+(values.length-1)+'\uE001';});
   }
   return result.replace(/\uE000(\d+)\uE001/g,(_,n)=>values[Number(n)]);
  };
 }
 function start(win){
  const doc=win.document,storageKey='dispatchProLanguage';let language='en',messages={},translate=s=>s;
  try{const saved=win.localStorage.getItem(storageKey);if(supported(saved))language=saved;}catch(e){}
  const originalText=new WeakMap(),originalAttributes=new WeakMap(),originalBlocks=new WeakMap();let bar,observer;
  const excluded=node=>node.parentElement?.closest('script,style,textarea,input,pre,code,[contenteditable], [translate="no"],[data-no-translate],[data-language-controls],#accountName,#newRecoveryCode,#inviteUrl,.addr');
  function textNode(node){
   if(node.parentElement?.closest('[data-i18n-block],[data-local-date]'))return;
   if(!node.parentElement||excluded(node))return;
   let saved=originalText.get(node);
   if(!saved||node.nodeValue!==saved.rendered){saved={source:node.nodeValue,rendered:node.nodeValue};originalText.set(node,saved);}
   const value=translate(saved.source);
   if(value!==node.nodeValue){saved.rendered=value;node.nodeValue=value;}
  }
  function attributes(element){
   if(element.closest('[data-language-controls],[translate="no"],[data-no-translate]'))return;
   if(element.tagName==='OPTION'&&!element.hasAttribute('value'))element.setAttribute('value',element.value);
   if(element.matches('input,textarea'))element.setAttribute('dir',element.type==='password'||element.type==='email'||element.type==='number'?'ltr':'auto');
   let saved=originalAttributes.get(element);if(!saved){saved={};originalAttributes.set(element,saved);}
   for(const name of ['placeholder','aria-label','title','alt']){
    const current=element.getAttribute(name);if(current==null)continue;
    if(!saved[name]||current!==saved[name].rendered)saved[name]={source:current,rendered:current};
    const value=translate(saved[name].source);if(current!==value){saved[name].rendered=value;element.setAttribute(name,value);}
   }
  }
  function apply(node=doc.body){
   if(!node)return;if(node.nodeType===3){textNode(node);return;}
   if(node.nodeType!==1)return;
   attributes(node);
   if(node.hasAttribute('data-local-date')){
    const date=new Date(node.getAttribute('datetime'));if(Number.isFinite(date.getTime())){const value=new Intl.DateTimeFormat(api.locale(),JSON.parse(node.getAttribute('data-local-date'))).format(date);if(node.textContent!==value)node.textContent=value;}return;
   }
   if(node.hasAttribute('data-i18n-block')){
    if(!originalBlocks.has(node))originalBlocks.set(node,node.innerHTML);
    const key=node.getAttribute('data-i18n-block');
    if(language==='en'){const html=originalBlocks.get(node);if(node.innerHTML!==html)node.innerHTML=html;}
    else{const value=translate(key);if(node.textContent!==value)node.textContent=value;}
    return;
   }
   for(const child of node.childNodes)if(child.nodeType===3)textNode(child);else if(child.nodeType===1&&!['SCRIPT','STYLE','TEXTAREA','INPUT','PRE','CODE'].includes(child.tagName))apply(child);
  }
  function sourceText(node){if(!node)return '';if(node.nodeType===1&&node.hasAttribute('data-i18n-block'))return node.getAttribute('data-i18n-block');if(node.nodeType===3)return originalText.get(node)?.source??node.nodeValue;return Array.from(node.childNodes||[],sourceText).join('');}
  function updateBar(){
   if(!bar)return;
   bar.querySelector('[data-language-label]').textContent=translate('Language');
   for(const button of bar.querySelectorAll('button')){const active=button.dataset.language===language;button.setAttribute('aria-pressed',String(active));button.classList.toggle('selected',active);}
   bar.setAttribute('aria-label',translate('Choose your language'));
  }
  function setLanguage(code,persist=true){
   if(!supported(code))return false;language=code;translate=translator(messages,code);
   doc.documentElement.lang=code;doc.documentElement.dir=['ur','ar'].includes(code)?'rtl':'ltr';
   if(persist)try{win.localStorage.setItem(storageKey,code);}catch(e){}
   updateBar();apply();if(doc.querySelector('title'))apply(doc.querySelector('title'));
   win.dispatchEvent(new win.CustomEvent('dispatch-language-change',{detail:{language:code}}));return true;
  }
  function controls(){
   bar=doc.createElement('nav');bar.className='language-controls';bar.dataset.languageControls='';bar.dir='ltr';
   const label=doc.createElement('span');label.dataset.languageLabel='';bar.append(label);
   for(const item of languages){const button=doc.createElement('button');button.type='button';button.lang=item.code;button.dir='auto';button.textContent=item.name;button.dataset.language=item.code;button.addEventListener('click',()=>setLanguage(item.code));bar.append(button);}
   doc.body.prepend(bar);updateBar();
   const art=doc.querySelector('.art img');const localized=doc.querySelector('[data-localized-home-art]');
   if(art&&localized)localized.style.backgroundImage='url("'+art.getAttribute('src')+'")';
  }
  const api={languages,get language(){return language;},locale:()=>({en:'en-US',es:'es-US',ur:'ur-PK-u-nu-latn',ar:'ar-u-nu-latn',ru:'ru',uk:'uk'}[language]),text:source=>translate(String(source)),sourceText,apply,setLanguage};
  win.DispatchI18n=api;if(typeof win.prompt==='function'){const prompt=win.prompt.bind(win);win.prompt=(message,value)=>prompt(translate(String(message)),value);}
  if(typeof win.alert==='function'){const showAlert=win.alert.bind(win);win.alert=message=>showAlert(translate(String(message)));}controls();setLanguage(language,false);
  observer=new win.MutationObserver(records=>{for(const record of records){if(record.type==='characterData')textNode(record.target);else if(record.type==='attributes')attributes(record.target);else for(const node of record.addedNodes)apply(node);}});
  observer.observe(doc.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['placeholder','title','aria-label','alt']});
  win.addEventListener('beforeprint',()=>apply());
  win.addEventListener('storage',event=>{if(event.key===storageKey&&supported(event.newValue))setLanguage(event.newValue,false);});
  api.ready=win.fetch('/i18n-messages.json',{credentials:'omit'}).then(r=>{if(!r.ok)throw Error('Language resources unavailable');return r.json();}).then(data=>{messages=data;setLanguage(language,false);}).catch(()=>{if(language!=='en'){const note=doc.createElement('span');note.dataset.noTranslate='';note.textContent='Translations unavailable. Please try again.';bar.append(note);}setLanguage('en',false);});
  return api;
 }
 return {languages,supported,normalize,translator,start};
});
