'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./defaults');

function decodeXml(value = '') {
  return String(value)
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

function plistStringForKey(xml, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<key>${escaped}<\\/key>\\s*<string>([\\s\\S]*?)<\\/string>`));
  return match ? decodeXml(match[1]) : null;
}

function plistArrayForKey(xml, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<key>${escaped}<\\/key>\\s*<array>([\\s\\S]*?)<\\/array>`));
  if (!match) return [];
  return [...match[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((entry) => decodeXml(entry[1]));
}

function temporaryPath(candidate) {
  const normalized = path.resolve(candidate);
  return normalized === '/tmp' || normalized.startsWith('/tmp/')
    || normalized === '/private/tmp' || normalized.startsWith('/private/tmp/')
    || normalized.split(path.sep).includes('_checkouts');
}

function boundPaths(xml) {
  const workingDirectory = plistStringForKey(xml, 'WorkingDirectory');
  const configuredRoot = plistStringForKey(xml, 'FACTORY_STACK_REPO_ROOT');
  const programArgs = plistArrayForKey(xml, 'ProgramArguments');
  const paths = [workingDirectory, ...programArgs.filter((entry) => path.isAbsolute(entry))].filter(Boolean);
  let repoBindingRoot = null;
  try {
    const bindings = JSON.parse(plistStringForKey(xml, 'FORGEADAPTER_REPO_BINDINGS') || '{}');
    repoBindingRoot = bindings['wiinc1/engineering-team']?.repoPath || null;
    if (repoBindingRoot) paths.push(repoBindingRoot);
  } catch {
    return { workingDirectory, configuredRoot, repoBindingRoot, paths, invalidRepoBindings: true };
  }
  return { workingDirectory, configuredRoot, repoBindingRoot, paths, invalidRepoBindings: false };
}

function inspectLaunchdPlist(plistFile, { expectedRoot = ROOT } = {}) {
  const remediation = 'Run npm run factory:stack:restart from the canonical checkout.';
  if (!fs.existsSync(plistFile)) {
    return { ok: false, expectedRoot, stalePaths: [plistFile], reasons: ['plist_missing'], remediation };
  }
  const values = boundPaths(fs.readFileSync(plistFile, 'utf8'));
  const stalePaths = [...new Set(values.paths.filter((entry) => temporaryPath(entry) || !fs.existsSync(entry)))];
  const reasons = [];
  if (values.workingDirectory && path.resolve(values.workingDirectory) !== path.resolve(expectedRoot)
    && values.workingDirectory.includes('engineering-team')) reasons.push('working_directory_conflict');
  if (values.configuredRoot && path.resolve(values.configuredRoot) !== path.resolve(expectedRoot)) reasons.push('bound_root_conflict');
  if (values.repoBindingRoot && path.resolve(values.repoBindingRoot) !== path.resolve(expectedRoot)) reasons.push('forgeadapter_repo_binding_conflict');
  if (values.invalidRepoBindings) reasons.push('forgeadapter_repo_bindings_invalid');
  if (stalePaths.length) reasons.push('stale_or_temporary_path');
  return {
    ok: reasons.length === 0,
    expectedRoot,
    configuredRoot: values.configuredRoot,
    workingDirectory: values.workingDirectory,
    repoBindingRoot: values.repoBindingRoot,
    stalePaths,
    reasons: [...new Set(reasons)],
    remediation: reasons.length ? remediation : null,
  };
}

module.exports = { inspectLaunchdPlist, plistArrayForKey, plistStringForKey, temporaryPath };
