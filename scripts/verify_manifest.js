const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'AUDIT_MANIFEST.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function sha256(relPath) {
  const data = fs.readFileSync(path.join(root, relPath));
  return crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
}

if (!manifest.release) throw new Error('Manifest release missing.');
if (!manifest.gitCommit) throw new Error('Manifest gitCommit missing.');
if (!manifest.files || typeof manifest.files !== 'object') throw new Error('Manifest files map missing.');
if ((manifest.expectedMinimumChecks || 0) < 69) throw new Error('Manifest expectedMinimumChecks is stale.');

const requiredFiles = [
  'metabolic_depletion_forecaster.html',
  'tests/audit_regression.js',
  'tests/browser_release.mjs',
  'README.md',
  'ACCURACY_AND_LIMITATIONS.md',
  'MODEL_SPECIFICATION.md',
  'VALIDATION.md',
  'data/parameter_provenance.json',
  'src/data/cell_lines.json',
  'src/data/cell_line_aliases.json',
  'src/data/cell_line_normalizations.json',
  'src/data/media.json',
  'src/data/oils.json',
  'src/data/refs.json',
  'package.json',
  '.github/workflows/ci.yml',
  'scripts/build.js',
  'scripts/build_parameter_provenance.js',
  'scripts/build_model_data_bundle.js',
  'scripts/check_syntax.js',
  'scripts/parameter_provenance_utils.js',
  'scripts/verify_artifact.js',
  'scripts/verify_model_data_bundle.js',
  'scripts/verify_manifest.js',
  'scripts/verify_parameter_provenance.js',
  'scripts/release_utils.js',
  'scripts/source_data_utils.js',
  'src/model/00_data.generated.js',
  'src/standalone_artifact.template.html',
  'src/model/00_model_and_solver.js',
  'src/ui/10_ui_and_exports.js',
];

for (const relPath of requiredFiles) {
  if (!(relPath in manifest.files)) {
    throw new Error(`Manifest is missing required file entry: ${relPath}`);
  }
}

for (const relPath of Object.keys(manifest.files)) {
  const actual = sha256(relPath);
  const expected = String(manifest.files[relPath] || '');
  if (actual !== expected) {
    throw new Error(`Manifest hash mismatch for ${relPath}: expected ${expected}, got ${actual}`);
  }
}

console.log(`Manifest verification passed for ${manifest.release}.`);
