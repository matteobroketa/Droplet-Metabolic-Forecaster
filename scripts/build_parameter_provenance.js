const fs = require('fs');
const path = require('path');
const { buildParameterProvenance } = require('./parameter_provenance_utils');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'data');
const outPath = path.join(outDir, 'parameter_provenance.json');

fs.mkdirSync(outDir, { recursive: true });
const payload = buildParameterProvenance(root);
const serialized = JSON.stringify(payload, null, 2) + '\n';
const normalizeNewlines = (text) => String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
if (!fs.existsSync(outPath) || normalizeNewlines(fs.readFileSync(outPath, 'utf8')) !== serialized) {
  fs.writeFileSync(outPath, serialized);
}

console.log(`Parameter provenance is current at ${path.relative(root, outPath)}.`);
