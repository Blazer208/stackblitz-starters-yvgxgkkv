'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const scrypt=promisify(crypto.scrypt);
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const token=()=>crypto.randomBytes(32).toString('base64url');
const passwordOptions={N:131072,r:8,p:1,maxmem:256*1024*1024};
async function derive(password,salt){return (await scrypt(password,salt,64,passwordOptions)).toString('hex');}
function createAuth({dbPath,origin,secure=true,setupHash,setupExpires=Date.now()+86400000}){
 if(!origin)throw new Error('APP_ORIGIN must be configured');
 if(dbPath!==':memory:')fs.mkdirSync(path.dirname(dbPath),{recursive:true,mode:0o700});
 const db=new DatabaseSync(dbPath);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,recovery_hash TEXT NOT NULL,role TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS invites(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,used_at INTEGER,role TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,starts INTEGER NOT NULL,count INTEGER NOT NULL);`);
 if(dbPath!==':memory:')fs.chmodSync(dbPath,0o600);
 if(setupHash&&/^[a-f0-9]{64}$/.test(setupHash)&&!db.prepare('SELECT id FROM users WHERE role=?').get('owner')){
   db.prepare('INSERT OR IGNORE INTO invites VALUES(?,?,NULL,?)').run(setupHash,Number(setupExpires),'owner');
 }
 let hashing=0,lastCleanup=0;
 function limit(key,max,windowMs){
   const now=Date.now();
   if(now-lastCleanup>3600000){db.prepare('DELETE FROM limits WHERE starts<?').run(now-86400000);db.prepare('DELETE FROM invites WHERE expires_at<?').run(now-86400000);lastCleanup=now;}
   const row=db.prepare('SELECT starts,count FROM limits WHERE key=?').get(key);
   if(!row||now-row.starts>=windowMs){db.prepare('INSERT OR REPLACE INTO limits VALUES(?,?,1)').run(key,now);return true;}
   if(row.count>=max)return false;
   db.prepare('UPDATE limits SET count=count+1 WHERE key=?').run(key);return true;
 }
 function respond(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
 function sameOrigin(req){return req.headers.origin===origin;}
 function userFor(req){
   const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('dispatch_session='));
   const value=cookie?.slice('dispatch_session='.length);if(!value||!/^[A-Za-z0-9_-]{43}$/.test(value))return null;
   const now=Date.now();
   const row=db.prepare('SELECT u.id,u.email,u.name,u.role,s.expires_at,s.last_seen FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?').get(hash(value));
   if(!row||row.expires_at<=now||now-row.last_seen>3600000){if(row)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(value));return null;}
   db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(now,hash(value));
   return {id:row.id,email:row.email,name:row.name,role:row.role};
 }
 function session(res,userId){
   const value=token(),now=Date.now();
   db.prepare('DELETE FROM sessions WHERE expires_at<? OR last_seen<?').run(now,now-3600000);
   db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(value),userId,now+12*3600000,now);
   res.setHeader('Set-Cookie','dispatch_session='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200'+(secure?'; Secure':''));
 }
 function clearSession(req,res){
   const value=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('dispatch_session='))?.slice(17);
   if(value)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(value));
   res.setHeader('Set-Cookie','dispatch_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'+(secure?'; Secure':''));
 }
 async function read(req){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)throw new Error('Request too large');}return JSON.parse(raw);}
 async function handle(req,res,urlPath){
   if(urlPath==='/api/auth/me'){
     if(req.method!=='GET'){respond(res,405,{error:'Use GET'});return true;}
     const user=userFor(req);respond(res,user?200:401,user?{user}:{error:'Sign in required'});return true;
   }
   if(!urlPath.startsWith('/api/auth/'))return false;
   if(req.method!=='POST'){respond(res,405,{error:'Use POST'});return true;}
   if(!sameOrigin(req)){respond(res,403,{error:'Invalid request origin'});return true;}
   if(!String(req.headers['content-type']||'').startsWith('application/json')){respond(res,415,{error:'Use application/json'});return true;}
   if(urlPath==='/api/auth/logout'){clearSession(req,res);respond(res,200,{ok:true});return true;}
   if(urlPath==='/api/auth/invite'){
     const user=userFor(req);if(user?.role!=='owner'){respond(res,403,{error:'Owner access required'});return true;}
     if(!limit('invite:'+user.id,10,3600000)){respond(res,429,{error:'Invitation limit reached'});return true;}
     const value=token();db.prepare('INSERT INTO invites VALUES(?,?,NULL,?)').run(hash(value),Date.now()+86400000,'dispatcher');
     respond(res,200,{url:origin+'/signup.html#invite='+value,expiresInHours:24});return true;
   }
   if(!['/api/auth/login','/api/auth/signup','/api/auth/recover'].includes(urlPath)){respond(res,404,{error:'Unknown authentication endpoint'});return true;}
   const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',').at(-1).trim();
   if(!limit('auth-ip:'+hash(ip),20,900000)||!limit('auth-global',60,60000)){respond(res,429,{error:'Too many attempts. Try again later.'});return true;}
   try{
     const data=await read(req),email=String(data.email||'').trim().toLowerCase(),password=String(data.password||'');
     if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||password.length<15||password.length>128){respond(res,400,{error:'Use a valid email and a password of 15–128 characters.'});return true;}
     if(!limit('auth-email:'+hash(email),10,900000)){respond(res,429,{error:'Too many attempts. Try again later.'});return true;}
     if(hashing>=2){respond(res,429,{error:'Sign-in is busy. Try again shortly.'});return true;}
     if(urlPath==='/api/auth/signup'){
       const inviteHash=hash(data.invite||''),invite=db.prepare('SELECT * FROM invites WHERE token_hash=?').get(inviteHash);
       const name=String(data.name||'').trim();
       if(!invite||invite.used_at||invite.expires_at<=Date.now()){respond(res,403,{error:'A valid unused invitation is required.'});return true;}
       if(!name||name.length>100){respond(res,400,{error:'Enter your name (up to 100 characters).'});return true;}
       hashing++;let passwordHash,salt=token();try{passwordHash=await derive(password,salt);}finally{hashing--;}
       const id=crypto.randomUUID(),recovery=token();
       db.exec('BEGIN IMMEDIATE');
       try{
         const changed=db.prepare('UPDATE invites SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').run(Date.now(),inviteHash,Date.now());
         if(changed.changes!==1)throw new Error('Invitation already used');
         db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(id,email,name,salt,passwordHash,hash(recovery),invite.role,Date.now());
         db.exec('COMMIT');
       }catch(e){db.exec('ROLLBACK');respond(res,400,{error:'Unable to create account. Check the invitation and account details.'});return true;}
       session(res,id);respond(res,201,{ok:true,recoveryCode:recovery});return true;
     }
     const account=db.prepare('SELECT * FROM users WHERE email=?').get(email);
     if(urlPath==='/api/auth/recover'){
       const supplied=Buffer.from(hash(data.recoveryCode||''),'hex'),expected=Buffer.from(account?.recovery_hash||hash('unknown'),'hex');
       if(!account||!crypto.timingSafeEqual(supplied,expected)){respond(res,401,{error:'Invalid account or recovery code'});return true;}
       hashing++;let passwordHash,salt=token();try{passwordHash=await derive(password,salt);}finally{hashing--;}
       const recovery=token();db.exec('BEGIN IMMEDIATE');
       try{const changed=db.prepare('UPDATE users SET salt=?,password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=?').run(salt,passwordHash,hash(recovery),account.id,account.recovery_hash);if(changed.changes!==1)throw new Error('Recovery code already used');db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
       session(res,account.id);respond(res,200,{ok:true,recoveryCode:recovery});return true;
     }
     hashing++;let candidate;try{candidate=await derive(password,account?.salt||'unknown-account-salt');}finally{hashing--;}
     if(!account||!crypto.timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(account.password_hash,'hex'))){respond(res,401,{error:'Email or password is incorrect'});return true;}
     session(res,account.id);respond(res,200,{ok:true});return true;
   }catch(e){respond(res,400,{error:'Unable to process authentication request'});return true;}
 }
 return {handle,userFor,sameOrigin,limit,db,close:()=>db.close()};
}
module.exports={createAuth,hash};
