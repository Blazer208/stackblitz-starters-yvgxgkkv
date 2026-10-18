// Shared truck-stop policy; distances are truck-route miles, never air miles.
const STOP_POLICY = Object.freeze({minMiles:250,targetMiles:300,maxMiles:350});
function stopWindow(kind,hoursLeft,speed,require300=false){
 if(!['break','rest'].includes(kind)||!Number.isFinite(hoursLeft)||hoursLeft<=0||!Number.isFinite(speed)||speed<10||speed>75)throw new Error('Invalid stop-planning hours or speed.');
 const clockMiles=Math.floor(Math.min(hoursLeft,7.75)*speed);
 const maxMiles=Math.min(kind==='break'?350:450,clockMiles);
 if(require300&&maxMiles<300)throw new Error('The first-stop 300-mile minimum cannot fit the available driving hours. Review the load requirement with dispatch.');
 if(maxMiles<1)throw new Error('No driving time remains for another leg.');
 // Preferred break mileage is a target; overnights may be closer when the remaining clock is short.
 const minMiles=require300?300:0; // 300-mile preference is a target, not a mandatory minimum unless dispatch explicitly requires it.
 if(maxMiles<minMiles||maxMiles===0)throw new Error('No search window remains for a suitable stop within the available hours.');
 return {minMiles,maxMiles,targetMiles:kind==='break'?Math.min(300,maxMiles):Math.max(0,maxMiles-25)};
}
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
  if (!['break','rest'].includes(kind)) return false;
  if (['Pilot','Flying J'].includes(brand)) return true;
  if (network==="Pilot / Flying J + Love's") return brand==="Love's";
  if (network==='Pilot / Flying J + TA / Petro') return ['TA','Petro'].includes(brand);
  if (network==="Pilot / Flying J + Love's + TA / Petro") return ["Love's",'TA','Petro'].includes(brand);
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
if(typeof module!=='undefined')module.exports={STOP_POLICY,stopWindow,brandOf,allowedBrand,normalizeMatches};
