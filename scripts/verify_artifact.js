const fs = require('fs');
const path = require('path');
const { loadManifest, renderArtifact } = require('./release_utils');

const root = path.join(__dirname, '..');
const manifest = loadManifest(root);
const { html: expectedHtml, manifestSha256, templatePath, appSourceFiles } = renderArtifact(root, manifest);
const files = {
  html: fs.readFileSync(path.join(root, 'metabolic_depletion_forecaster.html'), 'utf8'),
  readme: fs.readFileSync(path.join(root, 'README.md'), 'utf8'),
  limitations: fs.readFileSync(path.join(root, 'ACCURACY_AND_LIMITATIONS.md'), 'utf8'),
  model: fs.readFileSync(path.join(root, 'MODEL_SPECIFICATION.md'), 'utf8'),
  validation: fs.readFileSync(path.join(root, 'VALIDATION.md'), 'utf8'),
};

const release = manifest.release;
const checks = [
  [files.html === expectedHtml, `artifact content does not match rendered source template ${path.relative(root, templatePath)}`],
  [!files.html.includes('__ARTIFACT_APP_SCRIPT__'), 'artifact still contains unresolved app-script placeholder'],
  [files.html.includes(`release: ${release}`), 'artifact comment release mismatch'],
  [files.html.includes(`data-release="${release}"`), 'body release mismatch'],
  [files.html.includes(`content="${release}"`), 'meta release mismatch'],
  [files.html.includes(`meta name="artifact-commit" content="${manifest.gitCommit}"`), 'artifact commit metadata mismatch'],
  [files.html.includes(`meta name="artifact-manifest-sha256" content="${manifestSha256}"`), 'artifact manifest hash metadata mismatch'],
  [files.html.includes('Metabolic Depletion Forecaster v18'), 'title release mismatch'],
  [files.html.includes('finitePairConductance'), 'finite-pair half-time helper missing'],
  [files.html.includes('solveLinearExchange'), 'coupled exchange solver missing'],
  [files.html.includes('grouped_transport_limited'), 'grouped transport mode missing'],
  [files.html.includes('shared_mean_field'), 'shared mean-field mode missing'],
  [files.html.includes('measured_effective'), 'measured-effective half-time mode missing'],
  [files.readme.includes(release), 'README release mismatch'],
  [files.limitations.includes(release), 'limitations release mismatch'],
  [files.model.includes(release), 'model specification release mismatch'],
  [files.validation.includes(release), 'validation release mismatch'],
  [!files.html.includes('v17-audit-20260715'), 'stale v17 release string still present in artifact'],
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(message);
}

console.log(`Artifact verification passed for ${release} from ${path.relative(root, templatePath)} + ${appSourceFiles.join(', ')}.`);
