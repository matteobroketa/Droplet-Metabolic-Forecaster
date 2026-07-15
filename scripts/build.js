const fs = require('fs');
const path = require('path');
const { loadManifest, renderArtifact } = require('./release_utils');

const root = path.join(__dirname, '..');
const artifact = path.join(root, 'metabolic_depletion_forecaster.html');

if (!fs.existsSync(artifact)) {
  throw new Error('Standalone artifact missing: metabolic_depletion_forecaster.html');
}
const manifest = loadManifest(root);
const { html, appSourceFiles } = renderArtifact(root, manifest);
fs.writeFileSync(artifact, html);

console.log(`Build passed: regenerated standalone artifact from src/standalone_artifact.template.html and ${appSourceFiles.length} src/app module(s) for ${manifest.release}.`);
