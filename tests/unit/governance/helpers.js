const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function runScript(scriptName, cwd, env = {}) {
  return spawnSync('node', [path.join(SCRIPTS_DIR, scriptName)], {
    cwd,
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: '',
      GITHUB_EVENT_PATH: '',
      ...env,
    },
    encoding: 'utf8',
  });
}

function runScriptWithArgs(scriptName, args, cwd, env = {}) {
  return spawnSync('node', [path.join(SCRIPTS_DIR, scriptName), ...args], {
    cwd,
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: '',
      GITHUB_EVENT_PATH: '',
      ...env,
    },
    encoding: 'utf8',
  });
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initGitRepo(root) {
  git(root, ['init']);
  git(root, ['config', 'user.email', 'governance@example.com']);
  git(root, ['config', 'user.name', 'Governance Tests']);
}

function commitAll(root, message) {
  git(root, ['add', '.']);
  git(root, ['commit', '-m', message]);
}

module.exports = {
  commitAll,
  git,
  initGitRepo,
  makeTempDir,
  runScript,
  runScriptWithArgs,
  writeFile,
};
