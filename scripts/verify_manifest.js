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
if ((manifest.expectedMinimumChecks || 0) < 58) throw new Error('Manifest expectedMinimumChecks is stale.');

for (const relPath of Object.keys(manifest.files)) {
  const actual = sha256(relPath);
  const expected = String(manifest.files[relPath] || '');
  if (actual !== expected) {
    throw new Error(`Manifest hash mismatch for ${relPath}: expected ${expected}, got ${actual}`);
  }
}

console.log(`Manifest verification passed for ${manifest.release}.`);
