const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { createAuditApiServer } = require("../../lib/audit/http");

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function authHeaders(secret, roles) {
  return {
    authorization: `Bearer ${sign(
      {
        sub: "assignment-persisted-agent-e2e",
        tenant_id: "tenant-assignment-persisted-agent-e2e",
        roles,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      secret,
    )}`,
  };
}

async function withServer(run) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-assignment-persisted-agent-e2e-"));
  const secret = "task-assignment-persisted-agent-e2e-secret";
  const { server } = createAuditApiServer({ baseDir, jwtSecret: secret });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, secret });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("e2e: supported persisted agent assigns live then deactivates without losing historical owner display", async () => {
  await withServer(runPersistedAgentE2e);
});

async function runPersistedAgentE2e({ baseUrl, secret }) {
  const agentId = "qa-persisted-e2e";
  const taskId = "TSK-ASSIGN-PERSISTED-E2E";
  const createdVersion = await createPersistedAgent({ baseUrl, secret, agentId });
  await assertAgentVisible({ baseUrl, secret, agentId });
  await createTask({ baseUrl, secret, taskId });
  await assignTask({ baseUrl, secret, taskId, agentId });
  await deactivateAgent({ baseUrl, secret, agentId, createdVersion });
  await assertAgentHiddenFromAssignment({ baseUrl, secret, agentId });
  await assertHistoricalOwnerStable({ baseUrl, secret, taskId, agentId });
}

async function createPersistedAgent({ baseUrl, secret, agentId }) {
  const response = await fetch(`${baseUrl}/api/v1/ai-agents`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(secret, ["pm"]) },
    body: JSON.stringify({ agentId, displayName: "Persisted E2E QA", role: "qa" }),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.data.agentId, agentId);
  assert.equal(body.data.role, "qa");
  assert.equal(body.data.active, true);
  assert.equal(body.data.assignable, true);
  return body.data.version;
}

async function assertAgentVisible({ baseUrl, secret, agentId }) {
  const response = await fetch(`${baseUrl}/ai-agents`, { headers: authHeaders(secret, ["reader"]) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items.some((agent) => agent.id === agentId && agent.display_name === "Persisted E2E QA"), true);
}

async function createTask({ baseUrl, secret, taskId }) {
  const response = await fetch(`${baseUrl}/tasks/${taskId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(secret, ["contributor"]) },
    body: JSON.stringify({
      eventType: "task.created",
      actorType: "agent",
      idempotencyKey: `create:${taskId}`,
      payload: { title: "Persisted assignment owner display", initial_stage: "BACKLOG", priority: "P1" },
    }),
  });
  assert.equal(response.status, 202);
}

async function assignTask({ baseUrl, secret, taskId, agentId }) {
  const response = await fetch(`${baseUrl}/tasks/${taskId}/assignment`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(secret, ["pm"]) },
    body: JSON.stringify({ agentId }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.owner.agentId, agentId);
  assert.equal(body.data.owner.displayName, "Persisted E2E QA");
  assert.equal(body.data.owner.role, "qa");
}

async function deactivateAgent({ baseUrl, secret, agentId, createdVersion }) {
  const response = await fetch(`${baseUrl}/api/v1/ai-agents/${agentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders(secret, ["pm"]) },
    body: JSON.stringify({ version: createdVersion, active: false }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.active, false);
  assert.equal(body.data.assignable, false);
}

async function assertAgentHiddenFromAssignment({ baseUrl, secret, agentId }) {
  let response = await fetch(`${baseUrl}/ai-agents`, { headers: authHeaders(secret, ["reader"]) });
  assert.equal(response.status, 200);
  let body = await response.json();
  assert.equal(body.items.some((agent) => agent.id === agentId), false);
  response = await fetch(`${baseUrl}/api/v1/ai-agents?includeInactive=true`, { headers: authHeaders(secret, ["reader"]) });
  assert.equal(response.status, 200);
  body = await response.json();
  assert.equal(body.data.some((agent) => agent.agentId === agentId && !agent.active && !agent.assignable), true);
}

async function assertHistoricalOwnerStable({ baseUrl, secret, taskId, agentId }) {
  const response = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, { headers: authHeaders(secret, ["reader"]) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.owner.agentId, agentId);
  assert.equal(body.data.owner.displayName, "Persisted E2E QA");
  assert.equal(body.data.owner.role, "qa");
  assert.equal(body.data.owner.active, false);
  assert.equal(body.data.owner.assignable, false);
}
