'use strict';
(async function(){
 const status=document.getElementById('authStatus');
 const form=document.getElementById('authForm');
 let mode=document.body.dataset.authMode;
 let invitation=new URLSearchParams(location.hash.slice(1)).get('invite')||'';
 if(invitation)history.replaceState(null,'',location.pathname);
 async function post(url,data){
   const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',signal:AbortSignal.timeout(15000),body:JSON.stringify(data)});
   const j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');return j;
 }
 document.getElementById('recoverToggle')?.addEventListener('click',()=>{
   mode=mode==='recover'?'login':'recover';
   document.getElementById('recoveryField').hidden=mode!=='recover';
   document.getElementById('password').autocomplete=mode==='recover'?'new-password':'current-password';
   document.getElementById('submitAuth').textContent=mode==='recover'?'Reset Password':'Sign In';
   status.textContent=mode==='recover'?'Use the recovery code you saved when creating your account. Enter your new password.':'';
 });
 if(form){
   if(mode==='signup'&&!invitation){status.textContent='Account creation is invitation-only. Ask the app owner for an invitation link.';document.getElementById('submitAuth').disabled=true;}
   form.addEventListener('submit',async event=>{
     event.preventDefault();const button=document.getElementById('submitAuth');button.disabled=true;status.textContent='Working…';
     try{
       const data={email:document.getElementById('email').value,password:document.getElementById('password').value};
       if(mode==='signup'){data.name=document.getElementById('name').value;data.invite=invitation;}
       if(mode==='recover')data.recoveryCode=document.getElementById('recoveryCode').value.trim();
       const result=await post('/api/auth/'+mode,data);
       document.getElementById('password').value='';
       if(result.recoveryCode){
         form.hidden=true;document.getElementById('savedRecovery').hidden=false;
         document.getElementById('newRecoveryCode').textContent=result.recoveryCode;
         status.textContent='Account access is ready. Save your recovery code before continuing.';
       }else location.assign('/planner.html');
     }catch(e){status.textContent=e.name==='TimeoutError'?'Request timed out. Try again.':e.message;}
     finally{button.disabled=false;}
   });
 }
 if(document.getElementById('accountBar')){
   try{
     const r=await fetch('/api/auth/me',{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
     if(r.status===401){location.assign('/login.html');return;}
     const {user}=await r.json();document.getElementById('accountName').textContent=user.name;
     if(user.role==='owner')document.getElementById('inviteButton').hidden=false;
   }catch(e){document.getElementById('accountName').textContent='Account status unavailable';}
   document.getElementById('logoutButton').addEventListener('click',async()=>{
     try{await post('/api/auth/logout',{});sessionStorage.clear();location.assign('/login.html');}catch(e){alert(e.message);}
   });
   document.getElementById('inviteButton').addEventListener('click',async()=>{
     try{const data=await post('/api/auth/invite',{});document.getElementById('inviteUrl').value=data.url;document.getElementById('invitationPanel').hidden=false;}catch(e){alert(e.message);}
   });
 }
})();
