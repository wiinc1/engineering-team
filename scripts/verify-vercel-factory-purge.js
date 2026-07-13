#!/usr/bin/env node
'use strict';

/**
 * GitLab #277 — Verify Vercel is not treated as factory runtime of record.
 * Exit 0 when no active factory-claim paths remain; print residual historical docs.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();

const ACTIVE_GLOBS = [
  'README.md',
  'docs/architecture.md',
  'docs/product/software-factory-control-plane-prd.md',
  'docs/reports/FACTORY_AUTONOMY_DECISIONS.md',
  'docs/reports/AUTONOMOUS_SOFTWARE_FACTORY_READINESS_ASSESSMENT_2026-07-10.md',
  'docs/runbooks/golden-path-autonomous-delivery.md',
  'docs/runbooks/milestone-a-hosted-factory.md',
  'docs/runbooks/milestone-e-deploy-automation.md',
  'docs/runbooks/gp-007-production-workers.md',
  'docs/runbooks/audit-foundation.md',
  'package.json',
  'repo-contract.yaml',
  'fly.toml',
];

const FORBIDDEN_CLAIM_PATTERNS = [
  /factory\s+(of\s+record|green|proof|runtime|host).{0,80}vercel/i,
  /vercel.{0,80}factory\s+(of\s+record|green|proof|runtime|host)/i,
  /deploy(ed|ment)?.{0,40}factory.{0,40}vercel/i,
  /vercel\.json/,
  /engineering-team-zeta\.vercel\.app/,
];

const ALLOWED_CONTEXT = [
  /not part of the factory/i,
  /not the factory/i,
  /must not be used for factory/i,
  /removed/i,
  /removal/i,
  /remove Vercel/i,
  /remove.*vercel/i,
  /non-claim/i,
  /out of scope/i,
  /historical/i,
  /legacy/i,
  /target apps?/i,
  /not Vercel/i,
  /not vercel/i,
  /purge/i,
  /workstream/i,
];

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

function lineHits(text, pattern) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  lines.forEach((line, idx) => {
    if (pattern.test(line) && !ALLOWED_CONTEXT.some((ok) => ok.test(line))) {
      hits.push({ line: idx + 1, text: line.trim().slice(0, 160) });
    }
  });
  return hits;
}

function main() {
  const report = {
    schemaVersion: 'vercel-factory-purge-verify.v1',
    issue: 277,
    generatedAt: new Date().toISOString(),
    vercelJsonPresent: fs.existsSync(path.join(ROOT, 'vercel.json')),
    vercelDirPresent: fs.existsSync(path.join(ROOT, '.vercel')),
    activeFindings: [],
    residualHistorical: [],
    ok: true,
  };

  if (report.vercelJsonPresent) {
    report.ok = false;
    report.activeFindings.push({ file: 'vercel.json', detail: 'vercel.json present — remove for factory purge' });
  }
  if (report.vercelDirPresent) {
    report.ok = false;
    report.activeFindings.push({ file: '.vercel', detail: '.vercel directory present' });
  }

  for (const rel of ACTIVE_GLOBS) {
    const text = read(rel);
    if (text == null) continue;
    for (const pattern of FORBIDDEN_CLAIM_PATTERNS) {
      const hits = lineHits(text, pattern);
      for (const hit of hits) {
        report.ok = false;
        report.activeFindings.push({ file: rel, ...hit, pattern: String(pattern) });
      }
    }
  }

  // Historical residual inventory (non-blocking when labeled)
  const historicalRoots = ['docs/reports', 'docs/design', 'docs/issues'];
  for (const root of historicalRoots) {
    const abs = path.join(ROOT, root);
    if (!fs.existsSync(abs)) continue;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(md|json)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (/vercel/i.test(text)) {
            report.residualHistorical.push(path.relative(ROOT, full));
          }
        }
      }
    };
    walk(abs);
  }

  const outDir = path.join(ROOT, 'observability', 'factory-closeout');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'issue-277-vercel-purge.json');
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: report.ok, activeFindings: report.activeFindings.length, residualHistorical: report.residualHistorical.length, outPath }, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

main();
