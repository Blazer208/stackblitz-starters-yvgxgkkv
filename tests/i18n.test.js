const test=require('node:test');
const assert=require('node:assert/strict');
const messages=require('../i18n-messages.json');
const {languages,supported,translator}=require('../i18n');

test('language choices include Russian and Ukrainian separately',()=>{
 assert.deepEqual(languages.map(x=>x.code),['en','es','ur','ar','ru','uk']);
 assert.equal(languages.find(x=>x.code==='ru').name,'Русский');
 assert.equal(languages.find(x=>x.code==='uk').name,'Українська');
 assert.equal(supported('fr'),false);
});
test('initial translation entries have a nonempty value for every requested language',()=>{
 for(const [key,value]of Object.entries(messages)){
  assert.equal(value.length,5,key);assert.ok(value.every(v=>typeof v==='string'&&v.trim()),key);
 }
});
test('the English choice returns original text and spacing exactly',()=>{
 const t=translator(messages,'en');const source='  Pickup address: 4041 N Richards St, Milwaukee, WI 53212  ';
 assert.equal(t(source),source);
});
test('translated interface phrases retain trip numbers and highway identifiers',()=>{
 for(const code of ['es','ur','ar','ru','uk']){
  const t=translator(messages,code),result=t('Trip number: 127532 / I-80');
  assert.notEqual(result,'Trip number: 127532 / I-80');assert.match(result,/127532 \/ I-80$/);
  assert.equal(t('Drivera Logistics, 123 Main St'),'Drivera Logistics, 123 Main St');
 }
});
test('language changes start from source English rather than translating another translation',()=>{
 const source='Pickup address';
 for(const code of ['es','ur','ar','ru','uk'])assert.equal(translator(messages,code)(source),messages[source][languages.findIndex(l=>l.code===code)-1]);
});
