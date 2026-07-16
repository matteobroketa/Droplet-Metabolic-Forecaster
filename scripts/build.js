const path = require('path');
const { execFileSync } = require('child_process');
const { canonicalFileSha256 } = require('./release_utils');

const root = path.join(__dirname, '..');
const artifactPath = path.join(root, 'metabolic_depletion_forecaster.html');
const before = canonicalFileSha256(artifactPath);

for (const script of ['extract_canonical.js', 'check_syntax.js', 'verify_artifact.js']) {
  execFileSync(process.execPath, [path.join(__dirname, script)], { cwd: root, stdio: 'inherit' });
}

const after = canonicalFileSha256(artifactPath);
if (after !== before) throw new Error(`Canonical HTML changed during build: before ${before}, after ${after}`);

console.log(`Build validation passed without writing canonical HTML: ${after}.`);
