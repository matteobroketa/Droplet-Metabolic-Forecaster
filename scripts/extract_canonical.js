const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const artifactPath = path.join(root, 'metabolic_depletion_forecaster.html');
const outputDir = path.join(root, '.tmp', 'canonical-extract');

const html = fs.readFileSync(artifactPath, 'utf8');
const scriptMatch = html.match(/<script>\r?\n([\s\S]*?)\r?\n<\/script>/);
if (!scriptMatch) throw new Error('Canonical HTML inline application script not found.');

const dataStart = scriptMatch[1].indexOf('/* BEGIN EMBEDDED DATA */');
const dataEnd = scriptMatch[1].indexOf('/* END EMBEDDED DATA */');
if (dataStart < 0 || dataEnd <= dataStart) throw new Error('Canonical embedded-data markers are missing or out of order.');

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'application.js'), scriptMatch[1]);
fs.writeFileSync(path.join(outputDir, 'embedded-data.js'), scriptMatch[1].slice(dataStart, dataEnd + '/* END EMBEDDED DATA */'.length));

console.log(`Extracted canonical HTML sections to ${path.relative(root, outputDir)} (temporary, ignored).`);
