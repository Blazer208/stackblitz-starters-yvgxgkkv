#!/usr/bin/env node
// Route Stride parking data staging importer.
// Usage: node scripts/import-truck-parking-geojson.js input.geojson output.ndjson
// Input: legally obtained OSM-derived GeoJSON features (e.g. locally filtered Geofabrik extract).
// Output is STAGING ONLY: no parking location is certified safe or permitted.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/import-truck-parking-geojson.js input.geojson output.ndjson');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) throw Error('Expected GeoJSON FeatureCollection');
const records = new Map();
const str = x => x == null ? null : String(x).trim() || null;
function coords(f) {
  const g = f.geometry;
  if (!g) return null;
  if (g.type === 'Point') return g.coordinates;
  // Polygon/line center is NOT a truck entrance. Accept only explicit point geometry.
  return null;
}
function category(t) {
  if (t.highway === 'rest_area') return 'rest_area';
  if (t.highway === 'services') return 'highway_services';
  if (t.amenity === 'fuel') return 'fuel';
  if (t.amenity === 'parking') return 'parking';
  return null;
}
for (const f of raw.features) {
  const t = f.properties || {};
  const c = coords(f);
  const type = category(t);
  if (!type || !c || c.length < 2) continue;
  const [lon, lat] = c.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 18 || lat > 72 || lon < -180 || lon > -65) continue;
  const sourceId = str(t['@id'] || t.osm_id || f.id);
  if (!sourceId) continue;
  const id = 'osm:' + sourceId;
  const hgv = str(t.hgv || t['parking:hgv'] || t['hgv:parking']);
  const overnight = str(t['overnight_parking'] || t['parking:overnight']);
  const yes = v => ['yes','designated','official'].includes((v || '').toLowerCase());
  const no = v => ['no','private'].includes((v || '').toLowerCase());
  const tri = v => yes(v) ? 'yes' : no(v) ? 'no' : 'unknown';
  const name = str(t.name || t.brand || t.operator);
  const addr = [t['addr:housenumber'],t['addr:street'],t['addr:city'],t['addr:state'],t['addr:postcode']].filter(Boolean).join(', ') || null;
  const rec = {
    id, name, operator: str(t.operator), brand: str(t.brand),
    category: type, latitude: lat, longitude: lon,
    address: addr, city: str(t['addr:city']), state: str(t['addr:state']), postal_code: str(t['addr:postcode']),
    hgv_parking: tri(hgv), overnight_permission: tri(overnight),
    diesel: tri(str(t.diesel)), capacity: Number.isFinite(Number(t.capacity)) ? Number(t.capacity) : null,
    source: 'openstreetmap', source_id: sourceId, source_license: 'ODbL-1.0',
    source_url: 'https://www.openstreetmap.org/' + sourceId,
    verification_status: 'unverified', verified_at: null,
    truck_entrance_verified: false, commercial_truck_route_verified: false,
    eligible_for_automatic_overnight: false,
    raw_tags: t
  };
  // Prevent unknown or stale locations from being treated as automatically safe.
  records.set(id, rec);
}
fs.mkdirSync(path.dirname(output), {recursive:true});
const sorted = [...records.values()].sort((a,b) => a.id.localeCompare(b.id));
fs.writeFileSync(output, sorted.map(r => JSON.stringify(r)).join('\n') + (sorted.length ? '\n' : ''));
console.log(JSON.stringify({input,output,records:sorted.length,sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')}));
