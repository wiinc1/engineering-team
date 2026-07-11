'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ROOT,
  LABELS,
  ENV_FILE,
  DEFAULT_PORTS,
  nodeBinary,
  launchAgentsDir,
  logsHomeDir,
  resolveForgeadapterDir,
  buildServiceEnv,
  buildUiEnv,
  buildForgeadapterEnv,
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

function buildPlist({
  label,
  programArgs,
  env,
  stdoutLog,
  stderrLog,
  workingDirectory = ROOT,
  keepAlive = true,
  throttleInterval = 5,
}) {
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
    <${keepAlive ? 'true' : 'false'}/>
    <key>ThrottleInterval</key>
    <integer>${Number(throttleInterval) || 5}</integer>
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

/**
 * Build launchd service specs for the factory of record.
 * options.skipUi / options.skipForgeadapter omit claim-topology units.
 */
function buildServiceSpecs(env = buildServiceEnv(), options = {}) {
  const node = nodeBinary();
  const logs = logsHomeDir();
  const forgeadapterDir = options.forgeadapterDir !== undefined
    ? options.forgeadapterDir
    : resolveForgeadapterDir(options.forgeadapterDirExplicit);
  const skipUi = options.skipUi === true;
  const skipForgeadapter = options.skipForgeadapter === true || !forgeadapterDir;

  const specs = [
    {
      key: 'postgresEnsure',
      label: LABELS.postgresEnsure,
      programArgs: [node, path.join(ROOT, 'scripts', 'factory-stack-postgres-watch.js')],
      env,
      workingDirectory: ROOT,
      stdoutLog: path.join(logs, 'postgres-ensure.out.log'),
      stderrLog: path.join(logs, 'postgres-ensure.err.log'),
      keepAlive: true,
      throttleInterval: 10,
    },
    {
      key: 'api',
      label: LABELS.api,
      programArgs: [node, path.join(ROOT, 'scripts', 'run-audit-api.js')],
      env,
      workingDirectory: ROOT,
      stdoutLog: path.join(logs, 'audit-api.out.log'),
      stderrLog: path.join(logs, 'audit-api.err.log'),
      keepAlive: true,
    },
    {
      key: 'workers',
      label: LABELS.workers,
      programArgs: [node, path.join(ROOT, 'scripts', 'run-audit-workers.js')],
      env,
      workingDirectory: ROOT,
      stdoutLog: path.join(logs, 'audit-workers.out.log'),
      stderrLog: path.join(logs, 'audit-workers.err.log'),
      keepAlive: true,
    },
  ];

  if (!skipUi) {
    const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    specs.push({
      key: 'ui',
      label: LABELS.ui,
      programArgs: [
        node,
        viteBin,
        '--host', '127.0.0.1',
        '--port', String(DEFAULT_PORTS.ui),
        '--strictPort',
      ],
      env: buildUiEnv(env),
      workingDirectory: ROOT,
      stdoutLog: path.join(logs, 'ui.out.log'),
      stderrLog: path.join(logs, 'ui.err.log'),
      keepAlive: true,
    });
  }

  if (!skipForgeadapter && forgeadapterDir) {
    specs.push({
      key: 'forgeadapter',
      label: LABELS.forgeadapter,
      programArgs: [node, 'src/index.js'],
      env: buildForgeadapterEnv(env, forgeadapterDir),
      workingDirectory: forgeadapterDir,
      stdoutLog: path.join(logs, 'forgeadapter.out.log'),
      stderrLog: path.join(logs, 'forgeadapter.err.log'),
      keepAlive: true,
    });
  }

  return {
    specs,
    forgeadapterDir,
    skipped: {
      ui: skipUi,
      forgeadapter: skipForgeadapter || !forgeadapterDir,
      forgeadapterReason: skipForgeadapter
        ? 'skipped_by_flag'
        : (forgeadapterDir ? null : 'forgeadapter_checkout_not_found'),
    },
  };
}

function writeServicePlists(env, options = {}) {
  ensureDirs();
  const { specs, forgeadapterDir, skipped } = buildServiceSpecs(env, options);
  const paths = {};
  for (const spec of specs) {
    const file = plistPath(spec.label);
    fs.writeFileSync(file, buildPlist(spec));
    paths[spec.key] = file;
  }
  return { paths, specs, forgeadapterDir, skipped };
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
    if (/path\s*=/.test(out) || /state\s*=/.test(out)) {
      return {
        registered: true,
        running: /state\s*=\s*running/i.test(out) || /pid\s*=\s*[1-9]\d*/i.test(out),
        rawState: (out.match(/state\s*=\s*(\S+)/i) || [])[1] || null,
        pid: Number((out.match(/pid\s*=\s*(\d+)/i) || [])[1]) || null,
      };
    }
  } catch {
    // fall through
  }
  try {
    const list = launchctl('list');
    const hit = list.split('\n').find((line) => line.includes(label));
    if (!hit) return { registered: false, running: false, rawState: null, pid: null };
    const pid = Number(String(hit).trim().split(/\s+/)[0]) || null;
    return {
      registered: true,
      running: Boolean(pid && pid > 0),
      rawState: pid ? 'listed' : 'listed_no_pid',
      pid,
    };
  } catch {
    return { registered: false, running: false, rawState: null, pid: null };
  }
}

function allLabels() {
  return Object.values(LABELS);
}

function installLaunchdServices(env, options = {}) {
  writeServiceEnv(env);
  const written = writeServicePlists(env, options);
  // Boot out everything first so reinstall is clean.
  for (const label of allLabels()) tryBootout(label);
  for (const spec of written.specs) {
    tryBootstrap(written.paths[spec.key]);
    kickstart(spec.label);
  }
  return {
    labels: written.specs.map((s) => s.label),
    plists: written.paths,
    envFile: ENV_FILE,
    logsDir: logsHomeDir(),
    forgeadapterDir: written.forgeadapterDir,
    skipped: written.skipped,
  };
}

function stopLaunchdServices() {
  for (const label of allLabels()) tryBootout(label);
  return {
    labels: LABELS,
    stopped: true,
    plistsRetained: true,
    note: 'Plists retained for reboot (RunAtLoad). Use uninstall to remove permanently.',
  };
}

function uninstallLaunchdServices() {
  for (const label of allLabels()) {
    tryBootout(label);
    const file = plistPath(label);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  return { labels: LABELS, removed: true };
}

function launchdStatus() {
  const status = {};
  for (const [key, label] of Object.entries(LABELS)) {
    const loaded = serviceLoaded(label);
    status[key] = {
      label,
      loaded: loaded.registered === true,
      running: loaded.running === true,
      state: loaded.rawState,
      pid: loaded.pid,
      plist: plistPath(label),
      plistExists: fs.existsSync(plistPath(label)),
    };
  }
  return status;
}

module.exports = {
  buildPlist,
  buildServiceSpecs,
  installLaunchdServices,
  stopLaunchdServices,
  uninstallLaunchdServices,
  launchdStatus,
  tryBootout,
  kickstart,
  writeServiceEnv,
  writeServicePlists,
  serviceLoaded,
  allLabels,
};
