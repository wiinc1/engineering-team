'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '../..');
const alertPath = path.join(root, 'monitoring/alerts/langgraph-runtime.yml');
const fixturePath = path.join(root, 'tests/fixtures/langgraph/alerts.json');
const runbookPath = path.join(root, 'docs/runbooks/langgraph-checkpoints.md');
const expected = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('every LangGraph alert has the reviewed expression threshold severity duration and runbook link', () => {
  const document = yaml.load(fs.readFileSync(alertPath, 'utf8'));
  const rules = document.groups.flatMap((group) => group.rules);
  assert.equal(rules.length, Object.keys(expected).length);
  assert.deepEqual(new Set(rules.map((rule) => rule.alert)), new Set(Object.keys(expected)));
  for (const rule of rules) {
    assert.equal(rule.expr, expected[rule.alert].expr, `${rule.alert} expression or threshold drifted`);
    assert.equal(rule.for, expected[rule.alert].for, `${rule.alert} duration drifted`);
    assert.equal(rule.labels?.severity, expected[rule.alert].severity, `${rule.alert} severity drifted`);
    assert.equal(rule.annotations?.runbook_url, 'docs/runbooks/langgraph-checkpoints.md#alerts-and-triage');
  }
  assert.match(fs.readFileSync(runbookPath, 'utf8'), /^## Alerts and triage$/m);
});
