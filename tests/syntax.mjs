import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('metabolic_depletion_forecaster.html', 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/i)?.[1];

assert.ok(script, 'The standalone HTML must contain an inline application script.');
new vm.Script(script, { filename: 'metabolic_depletion_forecaster.html' });
assert.ok(!html.includes('AUDIT_MANIFEST'), 'The standalone tool must not depend on an audit manifest.');
assert.ok(!html.includes('artifact-manifest'), 'The standalone tool must not include manifest metadata.');

console.log('Inline application script parses and has no manifest dependency.');
