const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function normalizeTextForReleaseHash(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function canonicalTextSha256(text) {
  return crypto.createHash('sha256').update(normalizeTextForReleaseHash(text), 'utf8').digest('hex').toUpperCase();
}

function canonicalFileSha256(filePath) {
  return canonicalTextSha256(fs.readFileSync(filePath, 'utf8'));
}

function stableArtifactManifestHash(manifest) {
  const clone = JSON.parse(JSON.stringify(manifest));
  delete clone.artifactSha256;
  if (clone.files && typeof clone.files === 'object') {
    delete clone.files['metabolic_depletion_forecaster.html'];
  }
  return crypto.createHash('sha256').update(JSON.stringify(clone, null, 2)).digest('hex').toUpperCase();
}

function loadManifest(root) {
  const manifestPath = path.join(root, 'AUDIT_MANIFEST.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

module.exports = {
  loadManifest,
  normalizeTextForReleaseHash,
  canonicalTextSha256,
  canonicalFileSha256,
  stableArtifactManifestHash,
};
