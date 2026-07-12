#!/usr/bin/env node
'use strict';

/**
 * Install / uninstall / run the dual-remote mirror agent via launchd (macOS).
 *
 *   node scripts/dual-remote-mirror-agent.js install
 *   node scripts/dual-remote-mirror-agent.js uninstall
 *   node scripts/dual-remote-mirror-agent.js run [--dry-run] ...
 *   node scripts/dual-remote-mirror-agent.js status
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const LABEL = 'com.engineering-team.dual-remote-mirror';
const DEFAULT_INTERVAL_SEC = 900; // 15 minutes
const ROOT = path.resolve(__dirname, '..');

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

function buildPlist({ intervalSec = DEFAULT_INTERVAL_SEC, extraArgs = [] } = {}) {
  const programArgs = [
    nodeBinary(),
    path.join(ROOT, 'scripts', 'dual-remote-mirror-github.js'),
    '--merge-when-ready',
    ...extraArgs,
  ];
  const argsXml = programArgs.map((a) => `      <string>${escapeXml(a)}</string>`).join('\n');
  const stdout = path.join(logsDir(), 'mirror.out.log');
  const stderr = path.join(logsDir(), 'mirror.err.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${escapeXml(LABEL)}</string>
    <key>Comment</key>
    <string>Mirror GitLab primary main to GitHub backup (dual-remote MVP)</string>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>${Number(intervalSec) || DEFAULT_INTERVAL_SEC}</integer>
    <key>WorkingDirectory</key>
    <string>${escapeXml(ROOT)}</string>
    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
      <key>HOME</key>
      <string>${escapeXml(process.env.HOME || '')}</string>
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
  const dir = launchAgentsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(logsDir(), { recursive: true });
  const plist = plistPath();
  fs.writeFileSync(plist, buildPlist({
    intervalSec: opts.intervalSec || DEFAULT_INTERVAL_SEC,
  }));
  try {
    execFileSync('launchctl', ['bootout', `gui/${process.getuid?.() || 501}`, plist], {
      stdio: 'ignore',
    });
  } catch {
    // not loaded
  }
  execFileSync('launchctl', ['bootstrap', `gui/${process.getuid?.() || 501}`, plist], {
    stdio: 'inherit',
  });
  process.stdout.write(JSON.stringify({
    ok: true,
    action: 'install',
    label: LABEL,
    plist,
    intervalSec: opts.intervalSec || DEFAULT_INTERVAL_SEC,
    logs: logsDir(),
  }, null, 2));
  process.stdout.write('\n');
}

function uninstall() {
  const plist = plistPath();
  try {
    execFileSync('launchctl', ['bootout', `gui/${process.getuid?.() || 501}`, plist], {
      stdio: 'ignore',
    });
  } catch {
    // ignore
  }
  if (fs.existsSync(plist)) fs.unlinkSync(plist);
  process.stdout.write(JSON.stringify({
    ok: true,
    action: 'uninstall',
    label: LABEL,
    plist,
  }, null, 2));
  process.stdout.write('\n');
}

function status() {
  const plist = plistPath();
  let loaded = false;
  try {
    const out = execFileSync('launchctl', ['print', `gui/${process.getuid?.() || 501}/${LABEL}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    loaded = /state\s*=\s*running|path\s*=/.test(out) || out.length > 0;
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
  process.stdout.write(JSON.stringify({
    label: LABEL,
    plist,
    installed: fs.existsSync(plist),
    loaded,
    logs: logsDir(),
    lastSync,
  }, null, 2));
  process.stdout.write('\n');
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

  install [--interval-sec 900]   Install launchd agent (default every 15m)
  uninstall                      Remove launchd agent
  status                         Show install + last-sync artifact
  run [mirror flags...]          Run one mirror pass (forwards to dual-remote-mirror-github.js)
`);
    return;
  }
  if (cmd === 'install') {
    const idx = rest.indexOf('--interval-sec');
    const intervalSec = idx >= 0 ? Number(rest[idx + 1]) : DEFAULT_INTERVAL_SEC;
    install({ intervalSec });
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
  main,
};
