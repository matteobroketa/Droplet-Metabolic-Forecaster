const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function stableArtifactManifestHash(manifest) {
  const clone = JSON.parse(JSON.stringify(manifest));
  if (clone.files && typeof clone.files === 'object') {
    delete clone.files['metabolic_depletion_forecaster.html'];
  }
  return crypto.createHash('sha256').update(JSON.stringify(clone, null, 2)).digest('hex').toUpperCase();
}

function loadManifest(root) {
  const manifestPath = path.join(root, 'AUDIT_MANIFEST.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function renderArtifact(root, manifest = loadManifest(root)) {
  const templatePath = path.join(root, 'src', 'standalone_artifact.template.html');
  if (!fs.existsSync(templatePath)) {
    throw new Error('Artifact source template missing: src/standalone_artifact.template.html');
  }
  const manifestSha256 = stableArtifactManifestHash(manifest);
  const template = fs.readFileSync(templatePath, 'utf8');
  const html = template
    .replaceAll('__ARTIFACT_RELEASE__', manifest.release)
    .replaceAll('__ARTIFACT_COMMIT__', manifest.gitCommit)
    .replaceAll('__ARTIFACT_MANIFEST_SHA256__', manifestSha256);
  return { html, manifestSha256, templatePath };
}

module.exports = {
  loadManifest,
  renderArtifact,
  stableArtifactManifestHash,
};
