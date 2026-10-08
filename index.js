const http = require('http');
const fs = require('fs');
const path = require('path');

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
    if(++quotaCalls>20)return json(res,429,{error:'Trial routing request limit reached; retry later'});
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
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/api/truck-route') return truckRoute(req,res);
  if (urlPath.startsWith('/api/')) return json(res,404,{error:'Unknown API endpoint'});
  if (['/index.js','/package.json','/package-lock.json'].includes(urlPath)) return json(res,403,{error:'Forbidden'});
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
            'X-Route-Stride-Version': '0.5.3'
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
      'X-Route-Stride-Version': '0.5.3'
    };
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Route Stride listening on port ${port}`);
});
