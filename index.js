const http = require('http');
const fs = require('fs');
const path = require('path');
const {normalizeMatches}=require('./stop-policy');

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
    if(!Array.isArray(points)||points.length!==2||points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)||!['break','rest'].includes(kind)||!Number.isFinite(minMiles)||!Number.isFinite(maxMiles)||minMiles<0||maxMiles<=minMiles||maxMiles>300||maxMiles-minMiles>100)return json(res,400,{error:'Invalid truck-stop search window'});
    const h=Number(profile.heightInches??162),w=Number(profile.widthInches??102),g=Number(profile.grossWeight??80000),l=Number(profile.trailerFeet??53),o=Number(profile.overallFeet??75);
    if(!Number.isFinite(h)||h<60||h>180||!Number.isFinite(w)||w<60||w>102||!Number.isFinite(g)||g<1000||g>80000||!Number.isFinite(l)||l<1||l>53||!Number.isFinite(o)||o<=l||o>100)return json(res,400,{error:'Invalid truck profile'});
    const body={PoiRoute:{Stops:points.map(p=>({Coords:{Lat:String(p.lat),Lon:String(p.lng)},Region:4})),Options:{VehicleType:0,RoutingType:0,HighwayOnly:false,DistanceUnits:0,TruckCfg:{Units:0,Height:String(h),Width:String(w),Weight:String(g),Length:String(l*12),MaxStraightLength:String(l*12),BumperToBumperLength:String(o*12)}}},RouteLegIndex:0,SearchType:4,GenericPOICategories:[151],SearchWindowUnits:0,SearchWindowStart:minMiles,SearchWindowEnd:maxMiles,AirDistanceThreshold:2.5};
    const cacheKey=JSON.stringify([body,kind,network]);
    const cached=stopCache.get(cacheKey);if(cached&&Date.now()-cached.at<3600000)return json(res,200,cached.value);
    if(Date.now()-quotaWindow>3600000){quotaWindow=Date.now();quotaCalls=0;}
    if(++quotaCalls>100)return json(res,429,{error:'Truck planning request limit reached; retry later'});
    const response=await fetch('https://pcmiler.alk.com/apis/rest/v1.0/service.svc/poi/alongRoute',{method:'POST',headers:{Authorization:key,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),body:JSON.stringify(body)});
    if(!response.ok)return json(res,response.status===401||response.status===403?503:502,{error:response.status===401||response.status===403?'Trimble truck-stop search access is unavailable. Enable the POIs Along the Route license for this API key.':'Truck-stop provider request failed',upstreamStatus:response.status});
    const payload=await response.json();
    const value={stops:normalizeMatches(payload,kind,network),provider:'Trimble PC*Miler',window:{minMiles,maxMiles}};
    if(stopCache.size>=100)stopCache.delete(stopCache.keys().next().value);
    stopCache.set(cacheKey,{at:Date.now(),value});return json(res,200,value);
  }catch(e){return json(res,502,{error:'Truck-stop search unavailable; retry or contact dispatcher'});}
}
async function truckRoute(req, res) {
  if (req.method !== 'POST') return json(res,405,{error:'Use POST'});
  const key = process.env.TRIMBLE_API_KEY;
  if (!key) return json(res,503,{error:'Truck routing is not configured'});
  try {
    let data='';
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 32768) return json(res,413,{error:'Request too large'});
    }
    const {points,profile={}}=JSON.parse(data);
    const height=Number(profile.heightInches??162), weight=Number(profile.grossWeight??80000), length=Number(profile.trailerFeet??53), width=Number(profile.widthInches??102), overall=Number(profile.overallFeet??75);
    if(!Number.isFinite(overall)||overall<=length||overall>100||!Number.isFinite(width)||width<60||width>102||!Number.isFinite(height)||height<60||height>180||!Number.isFinite(weight)||weight<1000||weight>80000||!Number.isFinite(length)||length<1||length>53)return json(res,400,{error:'Invalid standard truck dimensions or gross weight'});
    if (!Array.isArray(points) || points.length<2 || points.length>25 || points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180))
      return json(res,400,{error:'Supply 2–25 valid coordinate stops'});
    const cacheKey=JSON.stringify([points.map(p=>[p.lat,p.lng]),height,weight,length,width,overall]);
    if(routeCache.has(cacheKey))return json(res,200,routeCache.get(cacheKey));
    if(Date.now()-quotaWindow>3600000){quotaWindow=Date.now();quotaCalls=0;}
    if(++quotaCalls>100)return json(res,429,{error:'Truck planning request limit reached; retry later'});
    const response=await fetch('https://pcmiler.alk.com/apis/rest/v1.0/Service.svc/route/routeReports', {
      method:'POST', headers:{Authorization:key,'Content-Type':'application/json'},
      signal:AbortSignal.timeout(25000),
      body:JSON.stringify({ReportRoutes:[{Stops:points.map(p=>({Coords:{Lat:String(p.lat),Lon:String(p.lng)},Region:4})),
        Options:{VehicleType:0,RoutingType:0,HighwayOnly:false,DistanceUnits:0,TruckCfg:{Units:0,Height:String(height),Weight:String(weight),Length:String(length*12),Width:String(width),MaxStraightLength:String(length*12),BumperToBumperLength:String(overall*12)}},
        ReportTypes:[{__type:'MileageReportType:http://pcmiler.alk.com/APIs/v1.0',TimeInSeconds:true}]}]})
    });
    if(!response.ok) return json(res,502,{error:'Trimble routing request failed',upstreamStatus:response.status});
    const reports=await response.json();
    const lines=reports.find(r=>Array.isArray(r.ReportLines))?.ReportLines;
    if(!lines?.length || lines.some(l=>l.Stop?.Errors?.length)) return json(res,502,{error:'Trimble could not resolve all route stops'});
    const end=lines[lines.length-1];
    const hours=String(end.THours).split(':').map(Number);
    const duration=hours.length===3 ? hours[0]*3600+hours[1]*60+hours[2] : Number(end.THours);
    const distance=Number(end.TMiles)*1609.344;
    if(!Number.isFinite(distance)||!Number.isFinite(duration)) return json(res,502,{error:'Invalid Trimble route totals'});
    const result={distance,duration,provider:'Trimble PC*Miler',geometry:null,
      profile:{heightInches:height,grossWeight:weight,trailerFeet:length,widthInches:width,overallFeet:overall},legs:lines};
    if(routeCache.size>=100)routeCache.delete(routeCache.keys().next().value);
    routeCache.set(cacheKey,result);
    return json(res,200,result);
  } catch(e) { return json(res,502,{error:'Truck routing unavailable; retry or contact dispatcher'}); }
}
const server = http.createServer((req, res) => {
  let urlPath;try{urlPath=decodeURIComponent((req.url||'/').split('?')[0]);}catch(e){return json(res,400,{error:'Invalid URL'});}
  if (urlPath === '/api/truck-route') return truckRoute(req,res);
  if (urlPath === '/api/truck-stops') return truckStops(req,res);
  if (urlPath.startsWith('/api/')) return json(res,404,{error:'Unknown API endpoint'});
  if (['/index.js','/stop-policy.js','/package.json','/package-lock.json'].includes(urlPath)) return json(res,403,{error:'Forbidden'});
  const requested = urlPath === '/' ? '/index.html' : urlPath;
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
            'X-Route-Stride-Version': '0.6.2'
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
      'X-Route-Stride-Version': '0.6.2'
    };
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Route Stride listening on port ${port}`);
});

