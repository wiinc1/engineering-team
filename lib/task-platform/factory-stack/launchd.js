'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ROOT,
  LABELS,
  ENV_FILE,
  nodeBinary,
  launchAgentsDir,
  logsHomeDir,
} = require('./defaults');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function envDictXml(env) {
  return Object.entries(env).map(([key, value]) => (
    `      <key>${escapeXml(key)}</key>\n      <string>${escapeXml(value)}</string>`
  )).join('\n');
}

function buildPlist({ label, programArgs, env, stdoutLog, stderrLog, workingDirectory = ROOT }) {
  const argsXml = programArgs.map((arg) => `      <string>${escapeXml(arg)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${escapeXml(label)}</string>
    <key>Comment</key>
    <string>Engineering Team factory stack service</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>WorkingDirectory</key>
    <string>${escapeXml(workingDirectory)}</string>
    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${envDictXml(env)}
    </dict>
    <key>StandardOutPath</key>
    <string>${escapeXml(stdoutLog)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(stderrLog)}</string>
  </dict>
</plist>
`;
}

function plistPath(label) {
  return path.join(launchAgentsDir(), `${label}.plist`);
}

function ensureDirs() {
  fs.mkdirSync(launchAgentsDir(), { recursive: true });
  fs.mkdirSync(logsHomeDir(), { recursive: true });
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
}

function writeServiceEnv(env) {
  ensureDirs();
  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  fs.writeFileSync(ENV_FILE, `${lines.join('\n')}\n`);
  return ENV_FILE;
}

function writeServicePlists(env) {
  ensureDirs();
  const node = nodeBinary();
  const logs = logsHomeDir();
  const apiPlist = buildPlist({
    label: LABELS.api,
    programArgs: [node, path.join(ROOT, 'scripts', 'run-audit-api.js')],
    env,
    stdoutLog: path.join(logs, 'audit-api.out.log'),
    stderrLog: path.join(logs, 'audit-api.err.log'),
  });
  const workersPlist = buildPlist({
    label: LABELS.workers,
    programArgs: [node, path.join(ROOT, 'scripts', 'run-audit-workers.js')],
    env,
    stdoutLog: path.join(logs, 'audit-workers.out.log'),
    stderrLog: path.join(logs, 'audit-workers.err.log'),
  });
  const apiPath = plistPath(LABELS.api);
  const workersPath = plistPath(LABELS.workers);
  fs.writeFileSync(apiPath, apiPlist);
  fs.writeFileSync(workersPath, workersPlist);
  return { apiPath, workersPath };
}

function launchctl(...args) {
  return execFileSync('launchctl', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function uidDomain() {
  return `gui/${process.getuid()}`;
}

function tryBootout(label) {
  try {
    launchctl('bootout', `${uidDomain()}/${label}`);
    return true;
  } catch {
    try {
      launchctl('unload', '-w', plistPath(label));
      return true;
    } catch {
      return false;
    }
  }
}

function tryBootstrap(plistFile) {
  try {
    launchctl('bootstrap', uidDomain(), plistFile);
    return true;
  } catch (error) {
    const message = String(error.stderr || error.message || error);
    if (/already bootstrapped|Input\/output error|service already loaded/i.test(message)) {
      return true;
    }
    try {
      launchctl('load', '-w', plistFile);
      return true;
    } catch (fallbackError) {
      throw new Error(`launchctl bootstrap/load failed for ${plistFile}: ${fallbackError.stderr || fallbackError.message}`);
    }
  }
}

function kickstart(label) {
  try {
    launchctl('kickstart', '-k', `${uidDomain()}/${label}`);
    return true;
  } catch {
    return false;
  }
}

function serviceLoaded(label) {
  try {
    const out = launchctl('print', `${uidDomain()}/${label}`);
    // Treat any registered launchd job as loaded (running, spawn scheduled, etc.).
    if (/path\s*=/.test(out) || /state\s*=/.test(out)) {
      return {
        registered: true,
        running: /state\s*=\s*running/i.test(out) || /pid\s*=\s*[1-9]\d*/i.test(out),
        rawState: (out.match(/state\s*=\s*(\S+)/i) || [])[1] || null,
      };
    }
  } catch {
    // fall through
  }
  try {
    const list = launchctl('list');
    const hit = list.split('\n').some((line) => line.includes(label));
    return { registered: hit, running: hit, rawState: hit ? 'listed' : null };
  } catch {
    return { registered: false, running: false, rawState: null };
  }
}

function installLaunchdServices(env) {
  writeServiceEnv(env);
  const paths = writeServicePlists(env);
  tryBootout(LABELS.api);
  tryBootout(LABELS.workers);
  tryBootstrap(paths.apiPath);
  tryBootstrap(paths.workersPath);
  kickstart(LABELS.api);
  kickstart(LABELS.workers);
  return {
    labels: LABELS,
    plists: paths,
    envFile: ENV_FILE,
    logsDir: logsHomeDir(),
  };
}

function stopLaunchdServices() {
  tryBootout(LABELS.api);
  tryBootout(LABELS.workers);
  return {
    labels: LABELS,
    stopped: true,
    plistsRetained: true,
    note: 'Plists retained for reboot (RunAtLoad). Use uninstall to remove permanently.',
  };
}

function uninstallLaunchdServices() {
  tryBootout(LABELS.api);
  tryBootout(LABELS.workers);
  for (const label of Object.values(LABELS)) {
    const file = plistPath(label);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  return { labels: LABELS, removed: true };
}

function launchdStatus() {
  const api = serviceLoaded(LABELS.api);
  const workers = serviceLoaded(LABELS.workers);
  return {
    api: {
      label: LABELS.api,
      loaded: api.registered === true,
      running: api.running === true,
      state: api.rawState,
      plist: plistPath(LABELS.api),
    },
    workers: {
      label: LABELS.workers,
      loaded: workers.registered === true,
      running: workers.running === true,
      state: workers.rawState,
      plist: plistPath(LABELS.workers),
    },
  };
}

module.exports = {
  buildPlist,
  installLaunchdServices,
  stopLaunchdServices,
  uninstallLaunchdServices,
  launchdStatus,
  tryBootout,
  kickstart,
  writeServiceEnv,
  writeServicePlists,
};
