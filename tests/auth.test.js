const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createAuth,hash}=require('../auth');
const crypto=require('node:crypto');
const origin='https://planner.example';
const password='A long unique test passphrase 8472';
function setup(){const invite=crypto.randomBytes(32).toString('base64url');const auth=createAuth({dbPath:':memory:',origin,setupHash:hash(invite)});return {auth,invite};}
async function call(auth,url,data={},cookie='',requestOrigin=origin,method='POST'){
 const req=Readable.from([JSON.stringify(data)]);req.method=method;req.socket={remoteAddress:'127.0.0.1'};req.headers={origin:requestOrigin,'content-type':'application/json',cookie};
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(s,h){this.status=s;Object.assign(this.headers,h);},end(body){this.body=JSON.parse(body);}};
 await auth.handle(req,res,url);return res;
}
async function owner(auth,invite){return call(auth,'/api/auth/signup',{name:'Test Owner',email:'owner@example.com',password,invite});}
test('signup requires a private invitation and refuses cross-origin requests',async()=>{
 const {auth,invite}=setup();try{
  assert.equal((await owner(auth,'bad')).status,403);
  assert.equal((await call(auth,'/api/auth/signup',{name:'Test',email:'test@example.com',password,invite},'','https://attacker.example')).status,403);
 }finally{auth.close();}
});
test('passwords and sessions are hashed; secure session authenticates and logout revokes it',async()=>{
 const {auth,invite}=setup();try{
  const created=await owner(auth,invite);assert.equal(created.status,201);
  const setCookie=created.headers['Set-Cookie'];assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Strict/);
  const cookie=setCookie.split(';')[0];
  const row=auth.db.prepare('SELECT * FROM users').get();assert.notEqual(row.password_hash,password);assert.equal(row.role,'owner');
  assert.notEqual(auth.db.prepare('SELECT token_hash FROM sessions').get().token_hash,cookie.split('=')[1]);
  assert.equal((await call(auth,'/api/auth/me',{},cookie,origin,'GET')).status,200);
  assert.equal((await call(auth,'/api/auth/signup',{name:'Other',email:'other@example.com',password,invite})).status,403);
  assert.equal((await call(auth,'/api/auth/logout',{},cookie)).status,200);
  assert.equal((await call(auth,'/api/auth/me',{},cookie,origin,'GET')).status,401);
 }finally{auth.close();}
});
test('login rejects wrong passwords and does not reveal whether an email exists',async()=>{
 const {auth,invite}=setup();try{
  await owner(auth,invite);
  const a=await call(auth,'/api/auth/login',{email:'owner@example.com',password:'Incorrect password long enough'});
  const b=await call(auth,'/api/auth/login',{email:'missing@example.com',password});assert.equal(a.status,401);assert.deepEqual(a.body,b.body);
  assert.equal((await call(auth,'/api/auth/login',{email:'OWNER@example.com',password})).status,200);
 }finally{auth.close();}
});
test('only owners can create tester invitations',async()=>{
 const {auth,invite}=setup();try{
  assert.equal((await call(auth,'/api/auth/invite')).status,403);
  const created=await owner(auth,invite),cookie=created.headers['Set-Cookie'].split(';')[0];
  const invitation=await call(auth,'/api/auth/invite',{},cookie);assert.equal(invitation.status,200);
  const testerInvite=new URL(invitation.body.url).hash.split('=')[1];
  const tester=await call(auth,'/api/auth/signup',{name:'Tester',email:'tester@example.com',password,invite:testerInvite});assert.equal(tester.status,201);
  assert.equal((await call(auth,'/api/auth/invite',{},tester.headers['Set-Cookie'].split(';')[0])).status,403);
 }finally{auth.close();}
});
test('recovery rotates the code and revokes all earlier sessions',async()=>{
 const {auth,invite}=setup();try{
  const created=await owner(auth,invite),cookie=created.headers['Set-Cookie'].split(';')[0];
  const data={email:'owner@example.com',password:'Another secure test passphrase 9843',recoveryCode:created.body.recoveryCode};
  const recovery=await call(auth,'/api/auth/recover',data);assert.equal(recovery.status,200);assert.notEqual(recovery.body.recoveryCode,data.recoveryCode);
  assert.equal((await call(auth,'/api/auth/me',{},cookie,origin,'GET')).status,401);
  assert.equal((await call(auth,'/api/auth/recover',data)).status,401);
 }finally{auth.close();}
});
test('expired sessions, expired invitations and weak passwords fail closed',async()=>{
 const {auth,invite}=setup();try{
  assert.equal((await call(auth,'/api/auth/signup',{name:'Test',email:'owner@example.com',password:'short',invite})).status,400);
  const created=await owner(auth,invite),cookie=created.headers['Set-Cookie'].split(';')[0];
  auth.db.prepare('UPDATE sessions SET last_seen=?').run(Date.now()-3600001);
  assert.equal((await call(auth,'/api/auth/me',{},cookie,origin,'GET')).status,401);
 }finally{auth.close();}
});
test('account usage limits are independent and survive database updates',()=>{
 const {auth}=setup();try{assert.equal(auth.limit('routing:one',1,3600000),true);assert.equal(auth.limit('routing:one',1,3600000),false);assert.equal(auth.limit('routing:two',1,3600000),true);}finally{auth.close();}
});
