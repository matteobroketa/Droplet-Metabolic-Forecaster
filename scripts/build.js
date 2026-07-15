const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadManifest, renderArtifact } = require('./release_utils');

const root = path.join(__dirname, '..');
const artifact = path.join(root, 'metabolic_depletion_forecaster.html');

if (!fs.existsSync(artifact)) {
  throw new Error('Standalone artifact missing: metabolic_depletion_forecaster.html');
}
execFileSync(process.execPath, [path.join(__dirname, 'build_model_data_bundle.js')], {
  cwd: root,
  stdio: 'inherit',
});
const manifest = loadManifest(root);
const { html, appSourceFiles } = renderArtifact(root, manifest);
fs.writeFileSync(artifact, html);

console.log(`Build passed: regenerated standalone artifact from src/standalone_artifact.template.html and ${appSourceFiles.length} ordered source module(s) for ${manifest.release}.`);
