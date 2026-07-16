const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { canonicalFileSha256, stableArtifactManifestHash } = require('./release_utils');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'AUDIT_MANIFEST.json');
const artifactPath = path.join(root, 'metabolic_depletion_forecaster.html');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.manifestVersion !== 2) throw new Error('Manifest version must be 2.');
if (!manifest.release) throw new Error('Manifest release missing.');
if (!/^[0-9a-f]{40}$/i.test(manifest.sourceCommit || '')) throw new Error('Manifest sourceCommit must identify commit A.');
if (manifest.releaseCommit !== 'represented-by-containing-git-commit') throw new Error('Manifest releaseCommit must be represented externally by the containing commit B.');
if (!/^[0-9A-F]{64}$/.test(manifest.artifactSha256 || '')) throw new Error('Manifest artifactSha256 missing or malformed.');
if (!manifest.files || typeof manifest.files !== 'object') throw new Error('Manifest files map missing.');
if ((manifest.expectedMinimumChecks || 0) < 76) throw new Error('Manifest expectedMinimumChecks is stale.');

const requiredFiles = [
  'AGENTS.md',
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
  'package-lock.json',
  '.github/workflows/ci.yml',
  'scripts/build.js',
  'scripts/build_parameter_provenance.js',
  'scripts/check_syntax.js',
  'scripts/extract_canonical.js',
  'scripts/parameter_provenance_utils.js',
  'scripts/verify_artifact.js',
  'scripts/verify_html_is_canonical.js',
  'scripts/verify_model_data_bundle.js',
  'scripts/verify_manifest.js',
  'scripts/verify_parameter_provenance.js',
  'scripts/release_utils.js',
  'scripts/source_data_utils.js',
];

for (const relPath of requiredFiles) if (!(relPath in manifest.files)) throw new Error(`Manifest is missing required file entry: ${relPath}`);
for (const relPath of Object.keys(manifest.files)) {
  const filePath = path.join(root, relPath);
  if (!fs.existsSync(filePath)) throw new Error(`Manifest file missing from worktree: ${relPath}`);
  const actual = canonicalFileSha256(filePath);
  const expected = String(manifest.files[relPath] || '');
  if (actual !== expected) throw new Error(`Manifest hash mismatch for ${relPath}: expected ${expected}, got ${actual}`);
}

const artifactHash = canonicalFileSha256(artifactPath);
if (manifest.artifactSha256 !== artifactHash || manifest.files['metabolic_depletion_forecaster.html'] !== artifactHash) throw new Error('Manifest artifact SHA-256 does not match canonical HTML.');
const html = fs.readFileSync(artifactPath, 'utf8');
const stableManifestHash = stableArtifactManifestHash(manifest);
const metadataChecks = [
  html.includes(`meta name="artifact-source-commit" content="${manifest.sourceCommit}"`),
  html.includes(`meta name="artifact-commit" content="${manifest.sourceCommit}"`),
  html.includes(`meta name="artifact-release-commit" content="${manifest.releaseCommit}"`),
  html.includes('meta name="artifact-sha256" content="recorded-in-AUDIT_MANIFEST.json"'),
  html.includes('meta name="artifact-manifest-version" content="2"'),
  html.includes(`meta name="artifact-manifest-sha256" content="${stableManifestHash}"`),
];
if (metadataChecks.some((ok) => !ok)) throw new Error('Canonical HTML release metadata does not match the manifest.');

const headParent = execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: root, encoding: 'utf8' }).trim();
if (headParent !== manifest.sourceCommit) throw new Error(`Commit B parent ${headParent} does not match sourceCommit ${manifest.sourceCommit}.`);

console.log(`Manifest verification passed for ${manifest.release}; commit A ${manifest.sourceCommit}, release commit represented by current containing commit.`);
