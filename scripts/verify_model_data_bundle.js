const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadSourceData } = require('./source_data_utils');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'metabolic_depletion_forecaster.html'), 'utf8');
const start = html.indexOf('const DATA=');
const end = html.indexOf('const PHYS=');
if (start < 0 || end <= start) throw new Error('Could not locate canonical embedded runtime data.');

const runtimeData = new Function('document', `${html.slice(start, end)}\nreturn DATA;`)({ currentScript: null });
const { DATA: catalogs } = loadSourceData(root);

for (const key of ['cellLines', 'media', 'oils', 'refs']) {
  assert.deepStrictEqual(runtimeData[key], catalogs[key], `Canonical embedded ${key} differs from supporting catalog.`);
}

console.log('Canonical embedded data verification passed against supporting catalogs.');
