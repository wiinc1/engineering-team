const { execFileSync } = require('node:child_process');

function gitRawOutput(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trimEnd();
  } catch {
    return '';
  }
}

function gitOutput(root, args) {
  return gitRawOutput(root, args).trim();
}

function normalizeRepositorySlug(owner, repo) {
  const cleanOwner = String(owner || '').trim();
  const cleanRepo = String(repo || '').trim().replace(/\.git$/i, '');
  return cleanOwner && cleanRepo ? `${cleanOwner}/${cleanRepo}` : '';
}

function repositoryFromRemoteUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  let match = url.match(/github\.com[:/]([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (match) return normalizeRepositorySlug(match[1], match[2]);
  match = url.match(/\/([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/);
  return match ? normalizeRepositorySlug(match[1], match[2]) : '';
}

function repositoryFromGitRemotes(root) {
  const preferred = ['github', 'origin'];
  const remotes = gitOutput(root, ['remote']).split(/\s+/).filter(Boolean);
  for (const name of [...preferred, ...remotes.filter((remote) => !preferred.includes(remote))]) {
    const repository = repositoryFromRemoteUrl(gitOutput(root, ['remote', 'get-url', name]));
    if (repository) return repository;
  }
  return '';
}

function normalizeStatusPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function parsePorcelainStatus(output = '') {
  return String(output || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3);
      const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
      return { status, path: normalizeStatusPath(filePath) };
    })
    .filter((entry) => entry.path);
}

function localGitWorktreeState(root = process.cwd()) {
  if (gitOutput(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return {
      workingTreeClean: null,
      dirtyFileCount: null,
      dirtyFiles: [],
    };
  }
  const dirtyFiles = parsePorcelainStatus(gitRawOutput(root, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])).map((entry) => entry.path);
  return {
    workingTreeClean: dirtyFiles.length === 0,
    dirtyFileCount: dirtyFiles.length,
    dirtyFiles: dirtyFiles.slice(0, 20),
  };
}

function localGitProofDefaults(root = process.cwd()) {
  const branch = gitOutput(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    repository: repositoryFromGitRemotes(root),
    branchName: branch && branch !== 'HEAD' ? branch : '',
    implementationCommitSha: gitOutput(root, ['rev-parse', 'HEAD']),
    ...localGitWorktreeState(root),
  };
}

function localGitWorktreeFailure(options = {}, context = 'real delivery planning') {
  if (options.workingTreeClean !== false) return '';
  return `local git worktree must be clean before ${context} (${options.dirtyFileCount} dirty files)`;
}

function requiredLocalGitWorktreeFailure(options = {}, context = 'final real delivery candidate proof') {
  if (options.workingTreeClean === true) return '';
  if (options.workingTreeClean === false) return localGitWorktreeFailure(options, context);
  return `${context} requires local git worktree clean evidence`;
}

function localGitEvidence(options = {}) {
  return {
    branch: options.branch || null,
    commitSha: options.commitSha || null,
    workingTreeClean: typeof options.workingTreeClean === 'boolean' ? options.workingTreeClean : null,
    dirtyFileCount: Number.isInteger(options.dirtyFileCount) ? options.dirtyFileCount : null,
    dirtyFiles: Array.isArray(options.dirtyFiles) ? options.dirtyFiles : [],
  };
}

module.exports = {
  gitOutput,
  gitRawOutput,
  localGitEvidence,
  localGitProofDefaults,
  localGitWorktreeFailure,
  localGitWorktreeState,
  parsePorcelainStatus,
  repositoryFromGitRemotes,
  repositoryFromRemoteUrl,
  requiredLocalGitWorktreeFailure,
};
