const fs = require('fs');
const path = require('path');
const { buildParameterProvenance } = require('./parameter_provenance_utils');

const root = path.join(__dirname, '..');
const provenancePath = path.join(root, 'data', 'parameter_provenance.json');

if (!fs.existsSync(provenancePath)) {
  throw new Error('Missing data/parameter_provenance.json');
}

const expected = JSON.stringify(buildParameterProvenance(root), null, 2) + '\n';
const actual = fs.readFileSync(provenancePath, 'utf8');

if (actual !== expected) {
  throw new Error('Parameter provenance file is stale. Run node scripts/build_parameter_provenance.js');
}

console.log('Parameter provenance verification passed.');
