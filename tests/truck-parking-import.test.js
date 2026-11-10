'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('truck parking importer stages deduplicated, unverified point records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-parking-'));
  try {
    const input = path.join(dir,'in.geojson');
    const output = path.join(dir,'out.ndjson');
    const feature = (id, properties, coordinates=[-112.04,43.49], type='Point') =>
      ({type:'Feature',id,properties,geometry:{type,coordinates}});
    fs.writeFileSync(input,JSON.stringify({type:'FeatureCollection',features:[
      feature('node/1',{amenity:'fuel',name:'Example Diesel',hgv:'yes',diesel:'yes'}),
      feature('node/1',{amenity:'fuel',name:'Example Diesel',hgv:'yes',diesel:'yes'}),
      feature('node/2',{amenity:'parking',name:'Unverified Lot'}),
      feature('node/3',{amenity:'fuel'},[-112.04,43.49],'Polygon'),
      feature('node/4',{amenity:'fuel'},[0,0]),
      feature('node/5',{amenity:'restaurant'})
    ]}));
    const run = spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/import-truck-parking-geojson.js'),input,output],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const rows=fs.readFileSync(output,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length,2);
    assert.equal(rows[0].source_license,'ODbL-1.0');
    assert.equal(rows[0].verification_status,'unverified');
    assert.equal(rows[0].eligible_for_automatic_overnight,false);
    assert.equal(rows[0].truck_entrance_verified,false);
    assert.equal(rows[1].overnight_permission,'unknown');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
