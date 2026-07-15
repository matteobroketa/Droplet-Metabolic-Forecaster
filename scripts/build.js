const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const artifact = path.join(root, 'metabolic_depletion_forecaster.html');
const manifestPath = path.join(root, 'AUDIT_MANIFEST.json');

function stableArtifactManifestHash(manifest) {
  const clone = JSON.parse(JSON.stringify(manifest));
  if (clone.files && typeof clone.files === 'object') {
    delete clone.files['metabolic_depletion_forecaster.html'];
  }
  return crypto.createHash('sha256').update(JSON.stringify(clone, null, 2)).digest('hex').toUpperCase();
}

if (!fs.existsSync(artifact)) {
  throw new Error('Standalone artifact missing: metabolic_depletion_forecaster.html');
}
if (!fs.existsSync(manifestPath)) {
  throw new Error('Audit manifest missing: AUDIT_MANIFEST.json');
}

const manifestText = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);
const manifestSha256 = stableArtifactManifestHash(manifest);
let html = fs.readFileSync(artifact, 'utf8');
if (!html.includes('artifact-release')) {
  throw new Error('Artifact release metadata missing.');
}
html = html
  .replace(/<meta name="artifact-release" content="[^"]*" \/>/, `<meta name="artifact-release" content="${manifest.release}" />`)
  .replace(/<meta name="artifact-commit" content="[^"]*" \/>/, `<meta name="artifact-commit" content="${manifest.gitCommit}" />`)
  .replace(/<meta name="artifact-manifest-sha256" content="[^"]*" \/>/, `<meta name="artifact-manifest-sha256" content="${manifestSha256}" />`);
fs.writeFileSync(artifact, html);

console.log(`Build check passed: standalone artifact is present and metadata-stamped for ${manifest.release}.`);
