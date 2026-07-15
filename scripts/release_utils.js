const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const APP_SCRIPT_PLACEHOLDER = '__ARTIFACT_APP_SCRIPT__';
const SOURCE_SCRIPT_ROOTS = [
  path.join('src', 'model'),
  path.join('src', 'ui'),
];

function stableArtifactManifestHash(manifest) {
  const clone = JSON.parse(JSON.stringify(manifest));
  if (clone.files && typeof clone.files === 'object') {
    delete clone.files['metabolic_depletion_forecaster.html'];
  }
  return crypto.createHash('sha256').update(JSON.stringify(clone, null, 2)).digest('hex').toUpperCase();
}

function loadManifest(root) {
  const manifestPath = path.join(root, 'AUDIT_MANIFEST.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function loadAppScript(root) {
  const appSourceFiles = SOURCE_SCRIPT_ROOTS.flatMap((relDir) => {
    const absDir = path.join(root, relDir);
    if (!fs.existsSync(absDir)) return [];
    return fs
      .readdirSync(absDir)
      .filter((name) => name.endsWith('.js'))
      .sort()
      .map((name) => path.join(absDir, name));
  });
  if (!appSourceFiles.length) {
    throw new Error(`Artifact source directories are empty or missing: ${SOURCE_SCRIPT_ROOTS.join(', ')}`);
  }
  const appScript = appSourceFiles
    .map((filePath) => {
      const text = fs.readFileSync(filePath, 'utf8');
      return text.endsWith('\n') ? text : `${text}\n`;
    })
    .join('');
  return {
    appScript,
    appSourceFiles: appSourceFiles.map((filePath) => path.relative(root, filePath).replaceAll(path.sep, '/')),
  };
}

function renderArtifact(root, manifest = loadManifest(root)) {
  const templatePath = path.join(root, 'src', 'standalone_artifact.template.html');
  if (!fs.existsSync(templatePath)) {
    throw new Error('Artifact source template missing: src/standalone_artifact.template.html');
  }
  const manifestSha256 = stableArtifactManifestHash(manifest);
  const template = fs.readFileSync(templatePath, 'utf8');
  const { appScript, appSourceFiles } = loadAppScript(root);
  if (!template.includes(APP_SCRIPT_PLACEHOLDER)) {
    throw new Error('Artifact source template is missing the app-script placeholder.');
  }
  const html = template
    .replace(APP_SCRIPT_PLACEHOLDER, () => appScript)
    .replaceAll('__ARTIFACT_RELEASE__', manifest.release)
    .replaceAll('__ARTIFACT_COMMIT__', manifest.gitCommit)
    .replaceAll('__ARTIFACT_MANIFEST_SHA256__', manifestSha256);
  return { html, manifestSha256, templatePath, appSourceFiles };
}

module.exports = {
  loadManifest,
  loadAppScript,
  renderArtifact,
  SOURCE_SCRIPT_ROOTS,
  stableArtifactManifestHash,
};
