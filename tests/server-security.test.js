const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {hash}=require('../auth');
test('server blocks direct planner/API access, uses real sessions, and persists accounts after restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-auth-test-'));
 const setup=crypto.randomBytes(32).toString('base64url');let child,base;
 async function start(){
   child=spawn(process.execPath,['index.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:'31947',APP_ORIGIN:'http://127.0.0.1:31947',AUTH_DB_PATH:path.join(dir,'accounts.sqlite'),OWNER_SETUP_TOKEN_HASH:hash(setup),TRIMBLE_API_KEY:''},stdio:['ignore','pipe','pipe']});
   await new Promise((resolve,reject)=>{child.stdout.on('data',data=>{if(String(data).includes('listening'))resolve();});child.once('exit',()=>reject(new Error('Server exited during start')));});base='http://127.0.0.1:31947';
 }
 async function stop(){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
 const post=(url,data,cookie='',origin=base)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify(data),redirect:'manual'});
 try{
  await start();
  const page=await fetch(base+'/planner.html',{redirect:'manual'});assert.equal(page.status,302);assert.equal(page.headers.get('location'),'/login.html');
  assert.equal((await post('/api/truck-route',{points:[]})).status,401);
  assert.equal((await fetch(base+'/auth.js')).status,404);
  assert.equal((await fetch(base+'/index.js')).status,404);
  assert.equal((await fetch(base+'/tests/auth.test.js')).status,404);
  const signup=await post('/api/auth/signup',{name:'Integration Tester',email:'integration@example.com',password:'A unique integration password 90247',invite:setup});assert.equal(signup.status,201);
  const cookie=signup.headers.get('set-cookie').split(';')[0];
  const authorized=await fetch(base+'/planner.html',{headers:{Cookie:cookie}});assert.equal(authorized.status,200);assert.match(await authorized.text(),/Dispatcher Trip Planner/);
  assert.match(authorized.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await post('/api/truck-route',{points:[]},cookie,'https://attacker.example')).status,403);
  assert.equal((await post('/api/truck-route',{points:[]},cookie)).status,400);
  await stop();await start();
  assert.equal((await fetch(base+'/api/auth/me',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await post('/api/auth/login',{email:'integration@example.com',password:'A unique integration password 90247'})).status,200);
  assert.equal((await post('/api/auth/logout',{},cookie)).status,200);
  assert.equal((await fetch(base+'/planner.html',{headers:{Cookie:cookie},redirect:'manual'})).status,302);
 }finally{if(child&&child.exitCode===null)await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
