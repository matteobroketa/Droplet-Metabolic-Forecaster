const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const artifact = path.join(root, 'metabolic_depletion_forecaster.html');

if (!fs.existsSync(artifact)) {
  throw new Error('Standalone artifact missing: metabolic_depletion_forecaster.html');
}

const html = fs.readFileSync(artifact, 'utf8');
if (!html.includes('artifact-release')) {
  throw new Error('Artifact release metadata missing.');
}

console.log('Build check passed: standalone artifact is present and versioned.');
