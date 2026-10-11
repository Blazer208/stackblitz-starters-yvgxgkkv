// Shared truck-stop policy; distances are truck-route miles, never air miles.
const STOP_POLICY = Object.freeze({minMiles:200,targetMiles:250,maxMiles:300});
function brandOf(name) {
  if (/\bflying\s*j\b/i.test(name)) return 'Flying J';
  if (/\bpilot\b/i.test(name)) return 'Pilot';
  if (/\blove[’']?s\b/i.test(name)) return "Love's";
  if (/\bone\s?9\b/i.test(name)) return 'One9';
  if (/\bpetro\b/i.test(name)) return 'Petro';
  if (/\bTA\b|travelcenters? of america/i.test(name)) return 'TA';
  if (/little america/i.test(name)) return 'Little America';
  return null;
}
function allowedBrand(brand,kind,network) {
  if (kind==='rest') return ['Pilot','Flying J',"Love's",'One9','TA','Petro','Little America'].includes(brand);
  if (['Pilot','Flying J'].includes(brand)) return true;
  if (network==='Pilot / Flying J + Love\'s') return brand==="Love's";
  return network==='All approved networks' && ['One9',"Love's",'TA','Petro','Little America'].includes(brand);
}
function normalizeMatches(payload,kind,network) {
  if (!Array.isArray(payload.POISearchMatches)) throw new Error('Invalid truck-stop provider response');
  const seen=new Set();
  return payload.POISearchMatches.map(m=>{
    const p=m.POILocation||{},a=p.Address||{};
    const name=String(p.PlaceName||p.Label||'').replace(/^@/,'');
    const lat=Number(p.Coords?.Lat),lng=Number(p.Coords?.Lon);
    const miles=m.DistanceFromOrigin?.DistanceUnits===0?Number(m.DistanceFromOrigin.Value):NaN;
    return {name,brand:brandOf(name),address:[a.StreetAddress,a.City,a.State||a.StateAbbreviation,a.Zip].filter(Boolean).join(', '),lat,lng,miles,street:a.StreetAddress};
  }).filter(p=>{
    const key=p.lat+','+p.lng;
    if(!p.street||!p.address||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180||!Number.isFinite(p.miles)||!allowedBrand(p.brand,kind,network)||seen.has(key))return false;
    seen.add(key);return true;
  }).sort((a,b)=>Math.abs(a.miles-STOP_POLICY.targetMiles)-Math.abs(b.miles-STOP_POLICY.targetMiles));
}
if(typeof module!=='undefined')module.exports={STOP_POLICY,brandOf,allowedBrand,normalizeMatches};
