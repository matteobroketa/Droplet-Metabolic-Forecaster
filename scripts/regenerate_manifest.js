const fs = require('fs');
const path = require('path');
const { canonicalFileSha256, stableArtifactManifestHash } = require('./release_utils');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'AUDIT_MANIFEST.json');
const artifactPath = path.join(root, 'metabolic_depletion_forecaster.html');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

for (const relativePath of Object.keys(manifest.files || {})) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error(`Manifest file is missing: ${relativePath}`);
  manifest.files[relativePath] = canonicalFileSha256(fullPath);
}

manifest.artifactSha256 = canonicalFileSha256(artifactPath);
manifest.files['metabolic_depletion_forecaster.html'] = manifest.artifactSha256;
const manifestHash = stableArtifactManifestHash(manifest);
const artifact = fs.readFileSync(artifactPath, 'utf8');
const requiredMetadata = [
  `meta name="artifact-commit" content="${manifest.sourceCommit}"`,
  `meta name="artifact-source-commit" content="${manifest.sourceCommit}"`,
  `meta name="artifact-manifest-sha256" content="${manifestHash}"`,
];
if (requiredMetadata.some((value) => !artifact.includes(value))) {
  throw new Error('Canonical HTML release metadata is stale. Update metabolic_depletion_forecaster.html directly, then regenerate the manifest.');
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Regenerated manifest with canonical-LF artifact hash ${manifest.artifactSha256}.`);
