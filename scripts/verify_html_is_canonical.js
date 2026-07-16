const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { canonicalFileSha256 } = require('./release_utils');

const root = path.join(__dirname, '..');
const artifactPath = path.join(root, 'metabolic_depletion_forecaster.html');
const before = canonicalFileSha256(artifactPath);

const supportCommands = [
  ['scripts/extract_canonical.js'],
  ['scripts/build_parameter_provenance.js'],
  ['scripts/check_syntax.js'],
  ['scripts/verify_model_data_bundle.js'],
  ['scripts/verify_parameter_provenance.js'],
  ['scripts/verify_artifact.js'],
  ['scripts/verify_manifest.js'],
];

for (const args of supportCommands) {
  execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
}

const writerNames = '(?:writeFileSync|writeFile|appendFileSync|appendFile|copyFileSync|copyFile|renameSync|rename|createWriteStream)';
const scriptFiles = fs.readdirSync(path.join(root, 'scripts')).filter((name) => /\.(?:js|mjs)$/.test(name));
const unsafe = [];
for (const name of scriptFiles) {
  const text = fs.readFileSync(path.join(root, 'scripts', name), 'utf8');
  const canonicalIds = new Set();
  for (const match of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*metabolic_depletion_forecaster\.html[^;\n]*/g)) canonicalIds.add(match[1]);
  const callPattern = new RegExp(`${writerNames}\\s*\\(\\s*([^,\\n]+)`, 'g');
  for (const match of text.matchAll(callPattern)) {
    const target = match[1];
    if (target.includes('metabolic_depletion_forecaster.html') || [...canonicalIds].some((id) => new RegExp(`\\b${id}\\b`).test(target))) {
      unsafe.push(`${name}: ${match[0]}`);
    }
  }
}
if (unsafe.length) throw new Error(`Support script can write canonical HTML:\n${unsafe.join('\n')}`);

const after = canonicalFileSha256(artifactPath);
if (after !== before) throw new Error(`Canonical HTML hash changed during support commands: before ${before}, after ${after}`);

console.log(`HTML-authority verification passed. Before = after = ${after}.`);
