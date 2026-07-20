const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'metabolic_depletion_forecaster.html'), 'utf8');
const script = html.match(/<script>\r?\n([\s\S]*?)\r?\n<\/script>/)?.[1];
if (!script) throw new Error('Could not locate canonical inline script.');
const counts = new Map();
for (const match of script.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([name, count]) => `${name} (${count})`);
if (duplicates.length) throw new Error(`Duplicate function declarations in canonical artifact: ${duplicates.join(', ')}`);
console.log('Duplicate function declaration check passed.');
