const fs = require('fs');
const path = require('path');

function loadJson(root, relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf8'));
}

function sourceDataPaths() {
  return {
    cellLines: 'src/data/cell_lines.json',
    cellLineAliases: 'src/data/cell_line_aliases.json',
    cellLineNormalizations: 'src/data/cell_line_normalizations.json',
    media: 'src/data/media.json',
    oils: 'src/data/oils.json',
    refs: 'src/data/refs.json',
  };
}

function buildRuntimeCellLines(cellLines, aliases, normalizations) {
  const runtime = JSON.parse(JSON.stringify(cellLines));
  for (const [aliasId, targetId] of Object.entries(aliases)) {
    if (runtime[aliasId] && runtime[targetId]) {
      runtime[aliasId] = { ...runtime[aliasId], aliasOf: targetId, hidden: true };
    }
  }
  for (const [id, patch] of Object.entries(normalizations)) {
    if (runtime[id]) {
      runtime[id] = { ...runtime[id], ...patch };
    }
  }
  return runtime;
}

function loadSourceData(root) {
  const paths = sourceDataPaths();
  return {
    DATA: {
      cellLines: buildRuntimeCellLines(
        loadJson(root, paths.cellLines),
        loadJson(root, paths.cellLineAliases),
        loadJson(root, paths.cellLineNormalizations)
      ),
      media: loadJson(root, paths.media),
      oils: loadJson(root, paths.oils),
      refs: loadJson(root, paths.refs),
    },
    sourcePaths: paths,
  };
}

function renderModelDataBundle(root) {
  const { DATA, sourcePaths } = loadSourceData(root);
  const header = [
    "'use strict';",
    '// Generated file. Do not edit manually.',
    `// Sources: ${Object.values(sourcePaths).join(', ')}`,
    `const DATA=${JSON.stringify(DATA)};`,
    '',
  ].join('\n');
  return header;
}

module.exports = {
  loadSourceData,
  renderModelDataBundle,
  sourceDataPaths,
};
