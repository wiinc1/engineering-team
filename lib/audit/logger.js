const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createAuditLogger(baseDir) {
  const logDir = path.join(baseDir, 'observability');
  const logPath = path.join(logDir, 'workflow-audit.log');

  function write(level, payload) {
    ensureDir(logDir);
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      ...payload,
    };
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  }

  return {
    info(payload) {
      write('info', payload);
    },
    error(payload) {
      write('error', payload);
    },
    logPath,
  };
}

module.exports = {
  createAuditLogger,
  ensureDir,
};
