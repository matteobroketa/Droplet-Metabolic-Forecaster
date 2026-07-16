const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function walk(dir, matcher, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, matcher, results);
    } else if (matcher(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function rel(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

function checkNodeSyntax(filePath) {
  execFileSync(process.execPath, ['--check', filePath], {
    cwd: root,
    stdio: 'pipe',
  });
}

function checkArtifactInlineScript(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const match = html.match(/<script>\r?\n([\s\S]*?)\r?\n<\/script>/);
  if (!match) {
    throw new Error(`Could not locate inline artifact script in ${rel(filePath)}.`);
  }
  new vm.Script(match[1], { filename: rel(filePath) });
}

const nodeFiles = [
  ...walk(path.join(root, 'scripts'), (filePath) => filePath.endsWith('.js')),
  ...walk(path.join(root, 'tests'), (filePath) => filePath.endsWith('.js') || filePath.endsWith('.mjs')),
];

const checked = [];
for (const filePath of nodeFiles) {
  checkNodeSyntax(filePath);
  checked.push(rel(filePath));
}

checkArtifactInlineScript(path.join(root, 'metabolic_depletion_forecaster.html'));
checked.push('metabolic_depletion_forecaster.html<script>');

console.log(`Syntax verification passed for ${checked.length} target(s).`);
