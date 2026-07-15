const fs = require('fs');
const path = require('path');
const { renderModelDataBundle } = require('./source_data_utils');

const root = path.join(__dirname, '..');
const bundlePath = path.join(root, 'src', 'model', '00_data.generated.js');

if (!fs.existsSync(bundlePath)) {
  throw new Error('Missing src/model/00_data.generated.js');
}

const expected = renderModelDataBundle(root);
const actual = fs.readFileSync(bundlePath, 'utf8');
if (actual !== expected) {
  throw new Error('Model data bundle is stale. Run node scripts/build_model_data_bundle.js');
}

console.log('Model data bundle verification passed.');
