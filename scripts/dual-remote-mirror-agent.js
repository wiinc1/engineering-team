#!/usr/bin/env node
'use strict';

/**
 * Install / uninstall / run the dual-remote mirror agent via launchd (macOS).
 *
 * Prefer installing from a durable clone (not a disposable worktree):
 *   git clone <gitlab> ~/src/engineering-team
 *   cd ~/src/engineering-team && npm run remotes:mirror:install
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const LABEL = 'com.engineering-team.dual-remote-mirror';
const DEFAULT_INTERVAL_SEC = 900;
const ROOT = path.resolve(
  process.env.DUAL_REMOTE_AGENT_ROOT || path.resolve(__dirname, '..'),
);

function launchAgentsDir() {
  return process.env.LAUNCH_AGENTS_DIR
    || path.join(process.env.HOME || '', 'Library', 'LaunchAgents');
}

function logsDir() {
  return process.env.DUAL_REMOTE_LOG_DIR
    || path.join(process.env.HOME || '', 'Library', 'Logs', 'engineering-team-dual-remote');
}

function plistPath() {
  return path.join(launchAgentsDir(), `${LABEL}.plist`);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function nodeBinary() {
  return process.execPath;
}

function guiDomain() {
  try {
    return `gui/${process.getuid()}`;
  } catch {
    return 'gui/501';
  }
}

function buildPlist({ intervalSec = DEFAULT_INTERVAL_SEC, root = ROOT } = {}) {
  const programArgs = [
    nodeBinary(),
    path.join(root, 'scripts', 'dual-remote-mirror-github.js'),
    '--merge-when-ready',
  ];
  const argsXml = programArgs.map((a) => `      <string>${escapeXml(a)}</string>`).join('\n');
  const stdout = path.join(logsDir(), 'mirror.out.log');
  const stderr = path.join(logsDir(), 'mirror.err.log');
  const envPath = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.dirname(nodeBinary()),
    '/usr/bin',
    '/bin',
  ].join(':');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${escapeXml(LABEL)}</string>
    <key>Comment</key>
    <string>Mirror GitLab primary main to GitHub backup (dual-remote E2E)</string>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>${Number(intervalSec) || DEFAULT_INTERVAL_SEC}</integer>
    <key>WorkingDirectory</key>
    <string>${escapeXml(root)}</string>
    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${escapeXml(envPath)}</string>
      <key>HOME</key>
      <string>${escapeXml(process.env.HOME || '')}</string>
      <key>DUAL_REMOTE_AGENT_ROOT</key>
      <string>${escapeXml(root)}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${escapeXml(stdout)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(stderr)}</string>
  </dict>
</plist>
`;
}

function install(opts = {}) {
  const root = path.resolve(opts.root || ROOT);
  if (!fs.existsSync(path.join(root, 'scripts', 'dual-remote-mirror-github.js'))) {
    throw new Error(`scripts/dual-remote-mirror-github.js not found under ${root}`);
  }
  const dir = launchAgentsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(logsDir(), { recursive: true });
  const plist = plistPath();
  fs.writeFileSync(plist, buildPlist({
    intervalSec: opts.intervalSec || DEFAULT_INTERVAL_SEC,
    root,
  }));
  try {
    execFileSync('launchctl', ['bootout', guiDomain(), plist], { stdio: 'ignore' });
  } catch {
    // not loaded
  }
  execFileSync('launchctl', ['bootstrap', guiDomain(), plist], { stdio: 'inherit' });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    action: 'install',
    label: LABEL,
    plist,
    root,
    intervalSec: opts.intervalSec || DEFAULT_INTERVAL_SEC,
    logs: logsDir(),
    note: 'Prefer durable clone path via DUAL_REMOTE_AGENT_ROOT or install from ~/src/engineering-team',
  }, null, 2)}\n`);
}

function uninstall() {
  const plist = plistPath();
  try {
    execFileSync('launchctl', ['bootout', guiDomain(), plist], { stdio: 'ignore' });
  } catch {
    // ignore
  }
  if (fs.existsSync(plist)) fs.unlinkSync(plist);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    action: 'uninstall',
    label: LABEL,
    plist,
  }, null, 2)}\n`);
}

function ghAuthHealth() {
  try {
    const out = execFileSync('gh', ['auth', 'status'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    return { ok: true, detail: out.split('\n').slice(0, 6).join(' | ') };
  } catch (error) {
    return {
      ok: false,
      detail: (error.stderr || error.message || String(error)).split('\n').slice(0, 4).join(' | '),
    };
  }
}

function minutesSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 60000);
}

function status() {
  const plist = plistPath();
  let loaded = false;
  try {
    const out = execFileSync('launchctl', ['print', `${guiDomain()}/${LABEL}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    loaded = /state\s*=|path\s*=/.test(out) || out.length > 0;
  } catch {
    loaded = false;
  }
  const lastSyncPath = path.join(ROOT, 'observability', 'dual-remote', 'last-sync.json');
  let lastSync = null;
  if (fs.existsSync(lastSyncPath)) {
    try {
      lastSync = JSON.parse(fs.readFileSync(lastSyncPath, 'utf8'));
    } catch {
      lastSync = { error: 'unreadable' };
    }
  }
  const auth = ghAuthHealth();
  const rootExists = fs.existsSync(path.join(ROOT, 'scripts', 'dual-remote-mirror-github.js'));
  process.stdout.write(`${JSON.stringify({
    label: LABEL,
    plist,
    installed: fs.existsSync(plist),
    loaded,
    root: ROOT,
    rootHealthy: rootExists,
    logs: logsDir(),
    ghAuth: auth,
    lastSync,
    minutesSinceLastSync: minutesSince(lastSync?.recordedAt),
    lastAction: lastSync?.action || null,
    lastExitCode: lastSync?.exitCode ?? null,
    lastPrUrl: lastSync?.prUrl || null,
    lastError: lastSync?.error || lastSync?.reason || null,
  }, null, 2)}\n`);
}

function runOnce(argv) {
  const script = path.join(ROOT, 'scripts', 'dual-remote-mirror-github.js');
  const result = spawnSync(nodeBinary(), [script, ...argv], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  process.exitCode = result.status == null ? 1 : result.status;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    process.stdout.write(`Usage: node scripts/dual-remote-mirror-agent.js <install|uninstall|status|run> [args]

  install [--interval-sec 900] [--root /path/to/clone]
  uninstall
  status
  run [mirror flags...]

Durable install example:
  git clone ssh://git@192.168.1.116:2424/wiinc1/engineering-team.git ~/src/engineering-team
  cd ~/src/engineering-team && git remote add github https://github.com/wiinc1/engineering-team.git
  npm run remotes:mirror:install
  # or: node scripts/dual-remote-mirror-agent.js install --root ~/src/engineering-team
`);
    return;
  }
  if (cmd === 'install') {
    const idx = rest.indexOf('--interval-sec');
    const intervalSec = idx >= 0 ? Number(rest[idx + 1]) : DEFAULT_INTERVAL_SEC;
    const ridx = rest.indexOf('--root');
    const root = ridx >= 0 ? rest[ridx + 1] : process.env.DUAL_REMOTE_AGENT_ROOT;
    install({ intervalSec, root });
    return;
  }
  if (cmd === 'uninstall') {
    uninstall();
    return;
  }
  if (cmd === 'status') {
    status();
    return;
  }
  if (cmd === 'run') {
    runOnce(rest);
    return;
  }
  process.stderr.write(`Unknown command: ${cmd}\n`);
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  LABEL,
  DEFAULT_INTERVAL_SEC,
  buildPlist,
  install,
  uninstall,
  status,
  ghAuthHealth,
  main,
};
