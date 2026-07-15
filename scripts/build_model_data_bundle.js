const fs = require('fs');
const path = require('path');
const { renderModelDataBundle } = require('./source_data_utils');

const root = path.join(__dirname, '..');
const outPath = path.join(root, 'src', 'model', '00_data.generated.js');
fs.writeFileSync(outPath, renderModelDataBundle(root));

console.log(`Model data bundle generated at ${path.relative(root, outPath)}.`);
