const fs = require('fs');
const path = require('path');
const { buildParameterProvenance } = require('./parameter_provenance_utils');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'data');
const outPath = path.join(outDir, 'parameter_provenance.json');

fs.mkdirSync(outDir, { recursive: true });
const payload = buildParameterProvenance(root);
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

console.log(`Parameter provenance generated at ${path.relative(root, outPath)}.`);
