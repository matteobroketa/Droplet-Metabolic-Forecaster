const fs = require('fs');
const path = require('path');

function loadSourceData(root) {
  const sourcePath = path.join(root, 'src', 'app', '00_model_and_solver.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('const DATA=');
  const end = source.indexOf('const STATE_KEY=');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not isolate source DATA section from src/app/00_model_and_solver.js');
  }
  const loader = new Function(
    `${source.slice(start, end)}\nreturn { DATA, CELL_DATABASE_ISSUES };`
  );
  return loader();
}

module.exports = {
  loadSourceData,
};
