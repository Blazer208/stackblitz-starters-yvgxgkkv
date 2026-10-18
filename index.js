const http = require('http');
const fs = require('fs');
const path = require('path');
const {normalizeMatches,brandOf,allowedBrand}=require('./stop-policy');
const stopDirectory=require('./stop-directory');
const automaticStopEngine=require('./automatic-stop-engine');
const {createAuth}=require('./auth');
const auth=createAuth({dbPath:process.env.AUTH_DB_PATH||'/data/accounts.sqlite',origin:process.env.APP_ORIGIN,setupHash:process.env.OWNER_SETUP_TOKEN_HASH,setupExpires:process.env.OWNER_SETUP_EXPIRES?Number(process.env.OWNER_SETUP_EXPIRES):Date.now()+86400000});

const port = process.env.PORT || 3000;
const root = __dirname;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.gpx': 'application/gpx+xml'
};

function json(res, code, body) {
  res.writeHead(code, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}
const routeCache = new Map();
let quotaWindow=Date.now(), quotaCalls=0;
const stopCache=new Map();
async function truckStops(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Use POST'});
  const key=process.env.TRIMBLE_API_KEY;
  if(!key)return json(res,503,{error:'Truck-stop search is not configured'});
  try{
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32768)return json(res,413,{error:'Request too large'});}
    const {points,profile={},kind='break',network='Pilot / Flying J only',minMiles=200,maxMiles=300}=JSON.parse(raw);
    if(!Array.isArray(points)||points.length!==2||points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)||!['break','rest'].includes(kind)||!Number.isFinite(minMiles)||!Number.isFinite(maxMiles)||minMiles<0||maxMiles<=minMiles||maxMiles>450||maxMiles-minMiles>150)return json(res,400,{error:'Invalid truck-stop search window'});
    const h=Number(profile.heightInches??162),w=Number(profile.widthInches??102),g=Number(profile.grossWeight??80000),l=Number(profile.trailerFeet??53),o=Number(profile.overallFeet??75);
    if(!Number.isFinite(h)||h<60||h>180||!Number.isFinite(w)||w<60||w>102||!Number.isFinite(g)||g<1000||g>80000||!Number.isFinite(l)||l<1||l>53||!Number.isFinite(o)||o<=l||o>100)return json(res,400,{error:'Invalid truck profile'});
    const body={PoiRoute:{Stops:points.map(p=>({Coords:{Lat:String(p.lat),Lon:String(p.lng)},Region:4})),Options:{VehicleType:0,RoutingType:0,HighwayOnly:false,DistanceUnits:0,TruckCfg:{Units:0,Height:String(h),Width:String(w),Weight:String(g),Length:String(l*12),MaxStraightLength:String(l*12),BumperToBumperLength:String(o*12)}}},RouteLegIndex:0,SearchType:4,GenericPOICategories:[151],SearchWindowUnits:0,SearchWindowStart:minMiles,SearchWindowEnd:maxMiles,AirDistanceThreshold:2.5};
    const cacheKey=JSON.stringify([body,kind,network]);
    const cached=stopCache.get(cacheKey);if(cached&&Date.now()-cached.at<3600000)return json(res,200,cached.value);
    if(Date.now()-quotaWindow>3600000){quotaWindow=Date.now();quotaCalls=0;}
    if(++quotaCalls>100)return json(res,429,{error:'Truck planning request limit reached; retry later'});
    const response=await fetch('https://pcmiler.alk.com/APIs/REST/v1.0/Service.svc/poi/alongRoute?dataset=Current',{method:'POST',headers:{Authorization:key,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),body:JSON.stringify(body)});
    if(!response.ok){
      const providerText=(await response.text()).slice(0,1200);
      const unavailable=response.status===401||response.status===403||/trial keys|not licensed/i.test(providerText);
      console.error('Truck-stop search upstream status',response.status,unavailable?'License/access unavailable':'Provider error');
      return json(res,unavailable?503:502,{error:unavailable?'Automatic truck-stop search requires a licensed Trimble POIs Along the Route key. The current trial key does not support this feature. Automatic planning for new multi-day trips is unavailable until provider access is upgraded.':'Truck-stop provider request failed',upstreamStatus:response.status});
    }
    const payload=await response.json();
    const value={stops:normalizeMatches(payload,kind,network),provider:'Trimble PC*Miler',window:{minMiles,maxMiles}};
    if(stopCache.size>=100)stopCache.delete(stopCache.keys().next().value);
    stopCache.set(cacheKey,{at:Date.now(),value});return json(res,200,value);
  }catch(e){return json(res,502,{error:'Truck-stop search unavailable; retry or contact dispatcher'});}
}

// Public OpenStreetMap candidate discovery; every selected leg must still pass PC*Miler truck routing.
const osmStopCache=new Map();
async function osmTruckStops(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Use POST'});
 try{
  let raw='';for await(const part of req){raw+=part;if(raw.length>4096)return json(res,413,{error:'Request too large'});}
  const {points,kind='break',network='Pilot / Flying J only'}=JSON.parse(raw);
  if(!Array.isArray(points)||points.length!==2||points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)||!['break','rest'].includes(kind))return json(res,400,{error:'Invalid search'});
  const local=stopDirectory.search(points[0],points[1],brand=>allowedBrand(brand,kind,network));
  if(local.length>=8)return json(res,200,{stops:local,provider:'Route Stride local OpenStreetMap candidate directory — verify truck entrance',directoryCount:stopDirectory.count()});
  const key=JSON.stringify([points,kind,network]);const hit=osmStopCache.get(key);
  if(hit&&Date.now()-hit.at<1800000)return json(res,200,hit.value);
  const [a,b]=points;const distance=Math.hypot((a.lat-b.lat)*69,(a.lng-b.lng)*69*Math.cos(a.lat*Math.PI/180));
  const samples=Math.min(12,Math.max(4,Math.ceil(distance/30)));
  const clauses=[];
  for(let i=0;i<=samples;i++){
   const t=i/samples,lat=a.lat+(b.lat-a.lat)*t,lng=a.lng+(b.lng-a.lng)*t;
   clauses.push('nwr(around:25000,'+lat.toFixed(5)+','+lng.toFixed(5)+')[~"^(name|brand|operator)$"~"(pilot|flying j|love.s|one9|petro|travelcenters of america|little america)",i];');
  }
  const query='[out:json][timeout:24];('+clauses.join('')+');out center tags 150;';
  const upstream=await fetch('https://overpass.kumi.systems/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'RouteStride/1.0 (truck stop discovery)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(28000)});
  if(!upstream.ok){if(local.length)return json(res,200,{stops:local,provider:'Route Stride local directory — live update unavailable'});return json(res,503,{error:'Public truck-stop directory is temporarily unavailable'});}
  const data=await upstream.json();const seen=new Set();
  const stops=(data.elements||[]).map(e=>{
   const tags=e.tags||{},name=tags.name||tags.brand||tags.operator||'';
   const lat=e.lat??e.center?.lat,lng=e.lon??e.center?.lon;
   const street=[tags['addr:housenumber'],tags['addr:street']].filter(Boolean).join(' ');
   const address=[street,tags['addr:city'],tags['addr:state'],tags['addr:postcode']].filter(Boolean).join(', ');
   const brand=brandOf(name);
   return {name,brand,address,lat,lng,street,source:'OpenStreetMap — unverified'};
  }).filter(p=>p.street&&p.address&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&allowedBrand(p.brand,kind,network)&&!seen.has(p.lat+','+p.lng)&&seen.add(p.lat+','+p.lng));
  stopDirectory.add(stops);
  stops.sort((x,y)=>Math.hypot(x.lat-a.lat,x.lng-a.lng)-Math.hypot(y.lat-a.lat,y.lng-a.lng));
  const merged=[...local,...stops].filter((p,i,arr)=>arr.findIndex(x=>x.brand===p.brand&&Math.abs(x.lat-p.lat)<.0001&&Math.abs(x.lng-p.lng)<.0001)===i);
  const value={stops:merged.slice(0,90),provider:'Route Stride local directory + OpenStreetMap — candidate locations, truck route verification required',directoryCount:stopDirectory.count()};
  if(osmStopCache.size>60)osmStopCache.delete(osmStopCache.keys().next().value);
  osmStopCache.set(key,{at:Date.now(),value});return json(res,200,value);
 }catch(e){console.error('Public stop lookup failed',String(e.message).slice(0,120));return json(res,503,{error:'Public truck-stop directory unavailable; use dispatcher-selected stops'});}
}

async function truckRoute(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Use POST'});
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32768)return json(res,413,{error:'Request too large'});}
  const {points,profile={}}=JSON.parse(raw);
  if(!Array.isArray(points)||points.length<2||points.length>25||points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180))return json(res,400,{error:'Supply 2–25 valid coordinate stops'});
  const height=Number(profile.heightInches??162),width=Number(profile.widthInches??102),weight=Number(profile.grossWeight??80000),trailer=Number(profile.trailerFeet??53),overall=Number(profile.overallFeet??75);
  if(height<60||height>180||width<60||width>102||weight<1000||weight>80000||trailer<1||trailer>53||overall<=trailer||overall>100||![height,width,weight,trailer,overall].every(Number.isFinite))return json(res,400,{error:'Invalid truck profile'});
  const coords=points.map(p=>p.lng+','+p.lat).join(';');
  const key=JSON.stringify([coords,height,width,weight,trailer,overall]);if(routeCache.has(key))return json(res,200,routeCache.get(key));
  if(Date.now()-quotaWindow>3600000){quotaWindow=Date.now();quotaCalls=0;}if(++quotaCalls>100)return json(res,429,{error:'Routing request limit reached'});
  // Public OSRM driving network provides planning mileage only; it does NOT apply truck restrictions.
  const upstream=await fetch('https://router.project-osrm.org/route/v1/driving/'+coords+'?overview=false&steps=false',{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'RouteStride/1.0 (trip planning estimates)'}});
  if(!upstream.ok)return json(res,502,{error:'Planning road network temporarily unavailable'});
  const payload=await upstream.json();const route=payload.routes?.[0];
  if(payload.code!=='Ok'||!Number.isFinite(route?.distance)||!Number.isFinite(route?.duration))return json(res,422,{error:'No connected road route found for these stops'});
  const result={distance:route.distance,duration:route.duration,geometry:null,legs:route.legs||[],provider:'OSRM driving-road estimate',truckRestrictionsChecked:false,planningEstimate:true,notice:'Planning mileage only. Road height, weight, width, length and truck restrictions are NOT verified.',profile:{heightInches:height,widthInches:width,grossWeight:weight,trailerFeet:trailer,overallFeet:overall}};
  if(routeCache.size>=100)routeCache.delete(routeCache.keys().next().value);routeCache.set(key,result);return json(res,200,result);
 }catch(e){console.error('Road estimate failed',e.message);return json(res,502,{error:'Planning road network unavailable; try again'});}
}
const publicFiles=new Set(['/index.html','/login.html','/signup.html','/pricing.html','/welcome.html','/auth-ui.js','/stop-policy.js','/historical-awareness.html']);
const protectedFiles=new Set(['/planner.html','/route-import.html','/pilot-flyingj-directory.html','/ta-petro-directory.html','/loves-directory.html','/Route_Stride_Demo.html']);
const securityHeaders={
 'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
 'Strict-Transport-Security':'max-age=31536000',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://api.qrserver.com https://*.tile.openstreetmap.org https://unpkg.com; frame-src https://www.openstreetmap.org; connect-src 'self' https://nominatim.openstreetmap.org; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
};
const server = http.createServer(async (req, res) => {
  for(const [key,value]of Object.entries(securityHeaders))res.setHeader(key,value);
  if(req.url?.startsWith('/api/auth/')||req.url?.startsWith('/login')||req.url?.startsWith('/signup'))res.setHeader('Cache-Control','no-store');
  let urlPath;try{urlPath=decodeURIComponent((req.url||'/').split('?')[0]);}catch(e){return json(res,400,{error:'Invalid URL'});}
  try{if(await auth.handle(req,res,urlPath))return;}catch(e){return json(res,503,{error:'Account service unavailable'});}
  if(urlPath==='/api/truck-route'||urlPath==='/api/truck-stops'||urlPath==='/api/osm-truck-stops'||urlPath==='/api/automatic-stop-candidates'){
    const user=auth.userFor(req);if(!user)return json(res,401,{error:'Sign in required'});
    if(req.method==='POST'&&!auth.sameOrigin(req))return json(res,403,{error:'Invalid request origin'});
    if(!auth.limit('routing:'+user.id,100,3600000))return json(res,429,{error:'Your hourly planning limit has been reached. Try later.'});
    if(!auth.limit('routing-burst:'+user.id,40,60000))return json(res,429,{error:'Too many planning requests. Try shortly.'});
  }
  if(urlPath==='/api/ta-petro-directory'){
    if(req.method!=='GET')return json(res,405,{error:'Use GET'});
    if(!auth.userFor(req))return json(res,401,{error:'Sign in required'});
    const stops=require('./data/ta-petro-seed.json');
    return json(res,200,{count:stops.length,stops,notice:'Source directory; truck entrances not independently verified'});
  }
  if(urlPath==='/api/loves-directory'){
    if(req.method!=='GET')return json(res,405,{error:'Use GET'});
    if(!auth.userFor(req))return json(res,401,{error:'Sign in required'});
    const stops=require('./data/loves-addresses.json');
    return json(res,200,{count:stops.length,stops,notice:'Source-listed addresses; not nationwide, truck entrances and coordinates unverified'});
  }
  if (urlPath === '/api/pilot-flyingj-directory') {
    if(req.method!=='GET')return json(res,405,{error:'Use GET'});
    if(!auth.userFor(req))return json(res,401,{error:'Sign in required'});
    const entries=require('./data/pilot-flyingj-addresses.json')
      .filter(x=>Array.isArray(x)&&x.length===3&&x[0]!=='State'&&x.every(v=>typeof v==='string'&&v.length>0))
      .map(([state,city,address])=>({name:'Pilot / Flying J - '+city,brand:'Pilot / Flying J',state,city,address,source:'User-supplied StoresHours.com listings',coordinatesPending:true,verifiedEntrance:false}));
    return json(res,200,{count:entries.length,states:new Set(entries.map(x=>x.state)).size,stops:entries,notice:'Address-only listings; coordinates and brand subtype not verified for automatic routing'});
  }
  if(urlPath==='/api/automatic-stop-candidates'){
    if(req.method!=='POST')return json(res,405,{error:'Use POST'});
    try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32768)return json(res,413,{error:'Request too large'});}
      return json(res,200,automaticStopEngine.candidates(JSON.parse(raw)));
    }catch(e){return json(res,400,{error:String(e.message).slice(0,160)});}
  }
  if (urlPath === '/api/truck-route') return truckRoute(req,res);
  if (urlPath === '/api/truck-stops') return truckStops(req,res);
  if (urlPath === '/api/osm-truck-stops') return osmTruckStops(req,res);
  if (urlPath.startsWith('/api/')) return json(res,404,{error:'Unknown API endpoint'});
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  if(requested==='/login.html'||requested==='/signup.html')res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  if(requested==='/route-import.html')res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://tessdata.projectnaptha.com; worker-src 'self' blob: https://cdnjs.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
  if(!publicFiles.has(requested)&&!protectedFiles.has(requested))return json(res,404,{error:'Not found'});
  if(protectedFiles.has(requested)&&!auth.userFor(req)){res.writeHead(302,{'Location':'/login.html','Cache-Control':'no-store'});return res.end();}
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Use GET'});
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root + path.sep) || !Object.keys(mime).includes(path.extname(filePath).toLowerCase())) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (urlPath !== '/') {
        return fs.readFile(path.join(root, 'index.html'), (fallbackErr, fallback) => {
          if (fallbackErr) {
            res.writeHead(404);
            return res.end('Not found');
          }
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store',
            'X-Route-Stride-Version': '0.6.3'
          });
          res.end(fallback);
        });
      }
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      'X-Route-Stride-Version': '0.6.3'
    };
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Route Stride listening on port ${port}`);
});

