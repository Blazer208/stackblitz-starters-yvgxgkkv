'use strict';
// Server-only adapter. Do not serve this file or expose it without account access control.
const ENDPOINT = 'https://pcmiler.alk.com/apis/rest/v1.0/Service.svc/route/routeReports?dataVersion=Current';
function makeRequest(stops, profileName) {
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > 50) throw new Error('Supply 2–50 ordered stops.');
  if (typeof profileName !== 'string' || !profileName.trim() || profileName.length > 120) throw new Error('A verified Trimble truck profile is required.');
  const Stops = stops.map((p, i) => {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) throw new Error('Every stop needs valid coordinates.');
    return {Coords: {Lat: String(p.lat), Lon: String(p.lng)}, Region: 4, Label: String(p.name || `Stop ${i + 1}`).slice(0, 200), IsViaPoint: false};
  });
  return {ReportRoutes: [{Stops, Options: {profileName: profileName.trim(), OverrideRestrict: false}, ReportTypes: [{__type: 'MileageReportType:http://pcmiler.alk.com/APIs/v1.0', TimeInSeconds: true}]}]};
}
async function routeReports(stops, {apiKey = process.env.TRIMBLE_API_KEY, profileName = process.env.TRIMBLE_TRUCK_PROFILE, fetchImpl = fetch} = {}) {
  if (!apiKey) { const e = new Error('Truck routing is not configured.'); e.code = 'NOT_CONFIGURED'; throw e; }
  const body = makeRequest(stops, profileName);
  let response;
  try { response = await fetchImpl(ENDPOINT, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: apiKey}, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)}); }
  catch { throw new Error('Truck routing service is unavailable. No fallback route was generated.'); }
  if (!response.ok) throw new Error(`Truck routing provider rejected the request (HTTP ${response.status}).`);
  let reports;
  try { reports = await response.json(); } catch { throw new Error('Truck routing provider returned an invalid response.'); }
  if (!Array.isArray(reports) || !reports.length || reports.some(r => !r || r.Errors?.length)) throw new Error('Truck routing provider returned no usable reports.');
  // Reports must be validated and normalized before being presented as a complete trip plan.
  return {provider: 'Trimble PC*Miler', reports, stopPlanningComplete: false};
}
module.exports = {makeRequest, routeReports};
