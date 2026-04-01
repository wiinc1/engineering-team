#!/usr/bin/env node
/**
 * software-factory-command-router
 * REST polling variant — no gateway conflict with OpenClaw
 * Polls Discord REST API for new messages in #software-factory every 2s
 * Routes !task, !board, !sre, !sprint commands to task operations
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { createAuditStore, assertAuditBackendConfiguration, isLocalLikeEnvironment, resolveAuditBackend } = require('../lib/audit');

// Config
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = '1488319729574744095'; // #software-factory
const GUILD_ID = '1401352193751126106';
const WORKSPACE_DIR = path.join(__dirname, '..');
const COMMAND_PREFIX = '!';
const auditBackendConfig = isLocalLikeEnvironment()
    ? {
        backend: resolveAuditBackend({ backend: process.env.AUDIT_STORE_BACKEND, connectionString: process.env.DATABASE_URL }),
        connectionString: process.env.DATABASE_URL,
      }
    : assertAuditBackendConfiguration();
const auditStore = createAuditStore({ baseDir: path.join(__dirname, '..'), ...auditBackendConfig });

let lastMessageId = null;
let processedIds = new Set(); // dedup across restarts
const POLL_INTERVAL = 2000; // ms

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function discordRequest(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'discord.com',
            path: `/api/v10${endpoint}`,
            method,
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json',
                'User-Agent': 'DiscordBot (software-factory-router/1.0)',
            }
        };
        if (body) opts.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
        
        const req = https.request(opts, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(data); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// ─── Fetch messages ────────────────────────────────────────────────────────────

async function fetchMessages() {
    try {
        let endpoint = `/channels/${CHANNEL_ID}/messages?limit=10`;
        if (lastMessageId) endpoint += `&before=${lastMessageId}`;
        
        const messages = await discordRequest('GET', endpoint);
        
        if (!Array.isArray(messages)) return [];
        
        // Process oldest first (Discord returns newest first)
        return messages.reverse();
    } catch (err) {
        console.error('[poll] fetch error:', err.message);
        return [];
    }
}

// ─── Command routing ───────────────────────────────────────────────────────────

async function handleMessage(msg) {
    if (msg.guild_id !== GUILD_ID) return;
    if (msg.channel_id !== CHANNEL_ID) return;
    if (msg.author.bot) return;
    
    const text = msg.content.trim();
    if (!text.startsWith(COMMAND_PREFIX)) return;
    if (processedIds.has(msg.id)) return;
    processedIds.add(msg.id);

    // Keep set bounded
    if (processedIds.size > 1000) {
        const arr = Array.from(processedIds);
        processedIds = new Set(arr.slice(-500));
    }

    console.log('[command]', msg.author.username, text);
    
    const [rawCmd, ...rest] = text.slice(1).split(' ');
    const cmd = rawCmd.toLowerCase();
    const args = rest.join(' ');
    
    let response;
    
    try {
        switch (cmd) {
            case 'help':
                response = formatHelp();
                break;
            case 'board':
                response = await cmdBoard(args);
                break;
            case 'task':
                response = await cmdTask(args, msg);
                break;
            case 'sre':
                response = await cmdSre(args, msg);
                break;
            case 'sprint':
                response = await cmdSprint(args, msg);
                break;
            case 'stats':
                response = await cmdStats();
                break;
            default:
                response = `Unknown command: \`${rawCmd}\`\nType \`!help\` for available commands.`;
        }
    } catch (err) {
        response = `Error: ${err.message}`;
        console.error('[command error]', err);
    }
    
    if (response) {
        await sendReply(msg.channel_id, msg.id, response);
    }
    
    lastMessageId = msg.id;
}

// ─── Commands ──────────────────────────────────────────────────────────────────

function buildIdempotencyKey(parts) {
    return parts.filter(Boolean).join(':');
}

function recordAuditEvent({ taskId, eventType, actorId, payload, idempotencyKey, occurredAt, causationId }) {
    return auditStore.appendEvent({
        tenantId: 'engineering-team',
        taskId,
        eventType,
        actorType: 'discord_user',
        actorId,
        payload,
        idempotencyKey,
        correlationId: idempotencyKey,
        occurredAt,
        causationId,
        source: 'command_router',
    });
}

function formatHelp() {
    return `**Software Factory — Available Commands**

\`!board\` — Show kanban board
\`!board task <TSK-XXX>\` — Show task details
\`!task create <title> --priority <P0|P1|P2|P3> --agent <dev|sre|qa|research|design> --description <text>\` — Create task
\`!task move <TSK-XXX> <BACKLOG|TODO|IN_PROGRESS|VERIFY|DONE|REOPEN> [--note <text>]\` — Move task
\`!task assign <TSK-XXX> <agent>\` — Assign agent
\`!task list [--status <status>] [--priority <priority>]\` — List tasks
\`!sre approve <TSK-XXX>\` — SRE approves task → DONE
\`!sre findings <TSK-XXX> --finding <text> --action <text>\` — Log SRE findings
\`!sprint start <name>\` — Start sprint
\`!sprint log <note>\` — Add sprint log entry
\`!stats\` — Show factory stats

Workflow: BACKLOG → TODO → IN_PROGRESS → VERIFY → DONE
SRE gate: VERIFY state requires Site Reliability Engineer sign-off`;
}

async function cmdBoard(args) {
    const boardPath = path.join(WORKSPACE_DIR, 'engineering-team', 'BOARD.md');
    const board = fs.readFileSync(boardPath, 'utf8');
    
    const lines = board.split('\n');
    let output = '**📋 Software Factory Board**\n\n';
    
    let section = '';
    let taskCount = 0;
    for (const line of lines) {
        if (line.startsWith('## ')) section = line.replace('## ', '');
        if (line.includes('TSK-')) {
            const parts = line.split('|').map(s => s.trim());
            if (parts.length >= 5) {
                const task = parts[1] || '';
                const priority = parts[2] || '';
                const assignee = parts[3] || '';
                const status = parts[4] || '';
                const updated = parts[5] || '';
                if (task) {
                    output += `• **${task}** \`${priority}\` \`${status}\`\n`;
                    taskCount++;
                }
            }
        }
    }
    
    if (taskCount === 0) output += '_No active tasks_\n';
    output += '\n_Type `!help` for commands_';
    
    return output;
}

async function cmdTask(args, msg) {
    const parts = args.trim().split(' ');
    const sub = parts[0];
    
    if (sub === 'create') {
        return await taskCreate(args.replace(sub, '').trim(), msg);
    } else if (sub === 'move') {
        return await taskMove(args.replace(sub, '').trim(), msg);
    } else if (sub === 'assign') {
        return await taskAssign(args.replace(sub, '').trim());
    } else if (sub === 'list') {
        return await taskList(args.replace(sub, '').trim());
    } else if (sub === '') {
        return 'Usage: `!task create|move|assign|list`';
    } else {
        return await taskShow(sub);
    }
}

async function taskCreate(argsStr, msg) {
    const titleMatch = argsStr.match(/^"([^"]+)"|^([^--\s]+)/);
    const title = titleMatch ? (titleMatch[1] || titleMatch[2]) : 'Untitled Task';
    
    const priorityMatch = argsStr.match(/--priority\s+(\S+)/);
    const agentMatch = argsStr.match(/--agent\s+(\S+)/);
    const descMatch = argsStr.match(/--description\s+"?(.+?)"?$/);
    
    const priority = priorityMatch ? priorityMatch[1].toUpperCase() : 'P3';
    const agent = agentMatch ? agentMatch[1].toLowerCase() : 'dev';
    const description = descMatch ? descMatch[1].trim() : 'No description provided.';
    
    const tasksDir = path.join(WORKSPACE_DIR, 'engineering-team', 'tasks');
    const existing = fs.readdirSync(tasksDir).filter(f => f.startsWith('TSK-'));
    const maxNum = existing.reduce((max, f) => {
        const n = parseInt(f.match(/TSK-(\d+)/)?.[1] || 0);
        return n > max ? n : max;
    }, 0);
    const taskId = `TSK-${String(maxNum + 1).padStart(3, '0')}`;
    
    const now = new Date().toISOString();
    const date = now.slice(0, 10);
    const time = now.slice(11, 16) + ' CDT';
    
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    
    const taskContent = `# ${taskId} — ${title}

**Created:** ${date} ${time}
**Updated:** ${date} ${time}
**ID:** ${taskId}
**Status:** BACKLOG

## 📌 Summary

${description}

## 🎯 Deliverables

- [ ] Deliverable 1
- [ ] Deliverable 2

## 🧑‍💻 Agent

**Type:** ${agent}
**Notes:** Assigned via Discord command by ${msg.author.username}

## 📋 SRE Verification Checklist

- [ ] Logs reviewed (no ERROR-level entries)
- [ ] Telemetry/metrics within baseline
- [ ] Exit codes clean
- [ ] Smoke/synthetic checks passed
- [ ] No regressions in downstream services

## 🔄 Status History

| Date | From | To | Actor | Note |
|------|------|----|----|------|
| ${date} | — | BACKLOG | ${msg.author.username} | Created via Discord |

## 📎 Findings (if reopened)

<!-- SRE fills this if issues are found during VERIFY -->
-

## 💬 Notes

<!-- Comments, context, decisions -->

`;

    fs.writeFileSync(path.join(tasksDir, `${taskId.toLowerCase()}-${slug}.md`), taskContent);

    recordAuditEvent({
        taskId,
        eventType: 'task.created',
        actorId: msg.author.username,
        payload: {
            title,
            description,
            priority,
            assignee: agent,
            initial_stage: 'BACKLOG'
        },
        idempotencyKey: buildIdempotencyKey(['task-create', taskId, msg.id]),
        occurredAt: now,
    });
    
    // Update BOARD.md
    const boardPath = path.join(WORKSPACE_DIR, 'engineering-team', 'BOARD.md');
    let board = fs.readFileSync(boardPath, 'utf8');
    
    board = board.replace(/(\| — \| — \| — \| — \|\n)/, `| ${taskId} | ${priority} | ${agent} | BACKLOG | ${date} |\n`);
    board = board.replace(/(> _Last sync: pending_)/, `> _Last sync: ${date} ${time}_`);
    
    fs.writeFileSync(boardPath, board);
    
    return `✅ **Task Created:** ${taskId}\n**Title:** ${title}\n**Priority:** ${priority}\n**Agent:** ${agent}\n**Description:** ${description}\n\nUpdate board → BACKLOG`;
}

async function taskMove(argsStr, msg) {
    const parts = argsStr.trim().split(' ');
    const taskId = parts[0];
    const newStatus = parts[1]?.toUpperCase();
    const noteMatch = argsStr.match(/--note\s+(.+)/);
    const note = noteMatch ? noteMatch[1] : '';
    
    if (!taskId || !newStatus) return 'Usage: `!task move <TSK-XXX> <STATUS> [--note <text>]`';
    
    const validStatuses = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'VERIFY', 'DONE', 'REOPEN'];
    if (!validStatuses.includes(newStatus)) {
        return `Invalid status. Use: ${validStatuses.join(' | ')}`;
    }
    
    const tasksDir = path.join(WORKSPACE_DIR, 'engineering-team', 'tasks');
    const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md'));
    
    const taskFile = taskFiles.find(f => f.toLowerCase().includes(taskId.toLowerCase()));
    if (!taskFile) return `Task ${taskId} not found.`;
    
    const taskPath = path.join(tasksDir, taskFile);
    let content = fs.readFileSync(taskPath, 'utf8');
    
    const oldStatusMatch = content.match(/\*\*Status:\*\* (\w+)/);
    const oldStatus = oldStatusMatch ? oldStatusMatch[1] : 'UNKNOWN';
    
    const now = new Date().toISOString();
    const date = now.slice(0, 10);
    const time = now.slice(11, 16) + ' CDT';
    
    content = content
        .replace(/\*\*Status:\*\* \w+/, `**Status:** ${newStatus}`)
        .replace(/\*\*Updated:\*\* .+/, `**Updated:** ${date} ${time}`)
        .replace(/(## 🔄 Status History\n\n\| Date \| From \| To \| Actor \| Note \|\n\|------\|------\|----\|----|------\|\n)/, 
            `| ${date} | ${oldStatus} | ${newStatus} | ${msg.author.username} | ${note || 'Status change'} |\n`);

    fs.writeFileSync(taskPath, content);

    let eventType = 'task.stage_changed';
    if (newStatus === 'DONE') {
        eventType = 'task.closed';
    } else if (newStatus === 'REOPEN') {
        eventType = 'task.rollback_recorded';
    }

    recordAuditEvent({
        taskId,
        eventType,
        actorId: msg.author.username,
        payload: {
            from_stage: oldStatus,
            to_stage: newStatus,
            note,
        },
        idempotencyKey: buildIdempotencyKey(['task-move', taskId, newStatus, msg.id]),
        occurredAt: now,
    });
    
    let reply = `✅ **${taskId}** moved: \`${oldStatus}\` → **\`${newStatus}\`**`;
    if (note) reply += `\n_Note: ${note}_`;
    
    if (newStatus === 'VERIFY') {
        reply += '\n\n⚠️ **SRE Gate** — task now requires SRE verification before DONE.';
    }
    if (newStatus === 'REOPEN') {
        reply += '\n\n🔴 **REOPENED** — SRE findings logged, returning to TODO.';
    }
    
    return reply;
}

async function taskShow(taskId) {
    const tasksDir = path.join(WORKSPACE_DIR, 'engineering-team', 'tasks');
    const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md'));
    const taskFile = taskFiles.find(f => f.toLowerCase().includes(taskId.toLowerCase()));
    
    if (!taskFile) return `Task ${taskId} not found.`;
    
    const content = fs.readFileSync(path.join(tasksDir, taskFile), 'utf8');
    
    const titleMatch = content.match(/^# .+/m);
    const statusMatch = content.match(/\*\*Status:\*\* (\w+)/);
    const agentMatch = content.match(/\*\*Type:\*\* (\w+)/);
    const createdMatch = content.match(/\*\*Created:\*\* (.+)/);
    
    const title = titleMatch ? titleMatch[0].replace('# ', '') : taskFile;
    const status = statusMatch ? statusMatch[1] : '?';
    const agent = agentMatch ? agentMatch[1] : '?';
    const created = createdMatch ? createdMatch[1] : '?';
    
    return `**${title}**\nStatus: \`${status}\` | Agent: \`${agent}\` | Created: ${created}\n_File: \`${taskFile}\`_`;
}

async function taskList(argsStr) {
    const statusMatch = argsStr.match(/--status\s+(\w+)/i);
    const priorityMatch = argsStr.match(/--priority\s+(\w+)/i);
    
    const tasksDir = path.join(WORKSPACE_DIR, 'engineering-team', 'tasks');
    const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md') && (f.startsWith('TSK-') || f.startsWith('task-')));
    
    let tasks = files.map(f => {
        const content = fs.readFileSync(path.join(tasksDir, f), 'utf8');
        const idMatch = f.match(/^(TSK-\d+)/i);
        const statusMatch = content.match(/\*\*Status:\*\* (\w+)/);
        const agentMatch = content.match(/\*\*Type:\*\* (\w+)/);
        return {
            id: idMatch ? idMatch[1].toUpperCase() : f,
            status: statusMatch ? statusMatch[1] : '?',
            agent: agentMatch ? agentMatch[1] : '?',
            file: f
        };
    });
    
    if (statusMatch) tasks = tasks.filter(t => t.status.toLowerCase() === statusMatch[1].toLowerCase());
    if (priorityMatch) tasks = tasks.filter(t => t.file.toLowerCase().includes(priorityMatch[1].toLowerCase()));
    
    if (tasks.length === 0) return '_No tasks found matching filters_';
    
    const output = tasks.map(t => `• **${t.id}** \`${t.status}\` [\`${t.agent}\`]`).join('\n');
    return `**Tasks (${tasks.length}):**\n${output}`;
}

async function taskAssign(argsStr) {
    const parts = argsStr.trim().split(' ');
    const taskId = parts[0];
    const agent = parts[1]?.toLowerCase();
    
    if (!taskId || !agent) return 'Usage: `!task assign <TSK-XXX> <agent>`';
    
    const tasksDir = path.join(WORKSPACE_DIR, 'engineering-team', 'tasks');
    const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md'));
    const taskFile = taskFiles.find(f => f.toLowerCase().includes(taskId.toLowerCase()));
    
    if (!taskFile) return `Task ${taskId} not found.`;

    const taskPath = path.join(tasksDir, taskFile);
    let content = fs.readFileSync(taskPath, 'utf8');
    const previousAgentMatch = content.match(/\*\*Type:\*\* (\w+)/);
    const previousAgent = previousAgentMatch ? previousAgentMatch[1] : null;
    content = content.replace(/\*\*Type:\*\* \w+/, `**Type:** ${agent}`);
    fs.writeFileSync(taskPath, content);

    recordAuditEvent({
        taskId,
        eventType: agent ? 'task.assigned' : 'task.unassigned',
        actorId: 'system',
        payload: {
            previous_assignee: previousAgent,
            assignee: agent,
        },
        idempotencyKey: buildIdempotencyKey(['task-assign', taskId, agent]),
    });
    
    const idMatch = taskFile.match(/TSK-\d+/i);
    return `✅ **${idMatch ? idMatch[0].toUpperCase() : taskFile}** assigned to \`${agent}\``;
}

async function cmdSre(args, msg) {
    const parts = args.trim().split(' ');
    const sub = parts[0];
    
    if (sub === 'approve') {
        const taskId = args.replace(sub, '').trim();
        if (!taskId) return 'Usage: `!sre approve <TSK-XXX>`';
        
        const tasksDir = path.join(WORKSPACE_DIR, 'engineering-team', 'tasks');
        const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md'));
        const taskFile = taskFiles.find(f => f.toLowerCase().includes(taskId.toLowerCase()));
        
        if (!taskFile) return `Task ${taskId} not found.`;
        
        const taskPath = path.join(tasksDir, taskFile);
        let content = fs.readFileSync(taskPath, 'utf8');
        
        const now = new Date().toISOString();
        const date = now.slice(0, 10);
        const time = now.slice(11, 16) + ' CDT';
        
        content = content
            .replace(/\*\*Status:\*\* \w+/, `**Status:** DONE`)
            .replace(/\*\*Updated:\*\* .+/, `**Updated:** ${date} ${time}`)
            .replace(/(## 🔄 Status History\n\n\| Date \| From \| To \| Actor \| Note \|\n\|------\|------\|----\|----|------\|\n)/,
                `| ${date} | VERIFY | DONE | ${msg.author.username} (SRE) | SRE approved |\n`);

        fs.writeFileSync(taskPath, content);

        recordAuditEvent({
            taskId,
            eventType: 'task.closed',
            actorId: msg.author.username,
            payload: {
                from_stage: 'VERIFY',
                to_stage: 'DONE',
                note: 'SRE approved',
            },
            idempotencyKey: buildIdempotencyKey(['sre-approve', taskId, msg.id]),
            occurredAt: now,
        });
        
        return `✅ **${taskId} APPROVED by SRE** → **DONE**\n_SRE verification complete — task closed._`;
    }
    
    if (sub === 'findings') {
        const taskIdMatch = args.match(/^(TSK-\d+)/i);
        const findingMatch = args.match(/--finding\s+(.+?)(?:\s+--action\s+|$)/s);
        const actionMatch = args.match(/--action\s+(.+)$/s);
        
        if (!taskIdMatch) return 'Usage: `!sre findings <TSK-XXX> --finding <text> --action <text>`';
        
        const taskId = taskIdMatch[1];
        const finding = findingMatch ? findingMatch[1].trim() : 'Issues found during verification.';
        const action = actionMatch ? actionMatch[1].trim() : 'Dev needs to address.';
        
        const tasksDir = path.join(WORKSPACE_DIR, 'engineering-team', 'tasks');
        const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md'));
        const taskFile = taskFiles.find(f => f.toLowerCase().includes(taskId.toLowerCase()));
        
        if (!taskFile) return `Task ${taskId} not found.`;
        
        const taskPath = path.join(tasksDir, taskFile);
        let content = fs.readFileSync(taskPath, 'utf8');
        
        const now = new Date().toISOString();
        const date = now.slice(0, 10);
        const time = now.slice(11, 16) + ' CDT';
        
        content = content
            .replace(/\*\*Status:\*\* \w+/, `**Status:** REOPEN`)
            .replace(/\*\*Updated:\*\* .+/, `**Updated:** ${date} ${time}`)
            .replace(/(<!-- SRE fills this if issues are found during VERIFY -->\n- \n)/, 
                `- **${date} ${time}** — ${msg.author.username} (SRE):\n  - Finding: ${finding}\n  - Action: ${action}\n`)
            .replace(/(## 🔄 Status History\n\n\| Date \| From \| To \| Actor \| Note \|\n\|------\|------\|----\|----|------\|\n)/,
                `| ${date} | VERIFY | REOPEN | ${msg.author.username} (SRE) | ${finding.slice(0, 50)} |\n`);

        fs.writeFileSync(taskPath, content);

        recordAuditEvent({
            taskId,
            eventType: 'task.escalated',
            actorId: msg.author.username,
            payload: {
                severity: 'blocking',
                reason: finding,
                resolution_action: action,
            },
            idempotencyKey: buildIdempotencyKey(['sre-findings', taskId, msg.id]),
            occurredAt: now,
        });
        
        return `🔴 **${taskId} REOPENED — SRE Findings:**\n**Finding:** ${finding}\n**Action:** ${action}\n\nReturned to TODO for dev follow-up.`;
    }
    
    return 'Usage: `!sre approve <TSK-XXX>` or `!sre findings <TSK-XXX> --finding <text> --action <text>`';
}

async function cmdSprint(args, msg) {
    const parts = args.trim().split(' ');
    const sub = parts[0];
    
    if (sub === 'start') {
        const name = args.replace(sub, '').trim() || 'Unnamed Sprint';
        const sessionPath = path.join(WORKSPACE_DIR, 'engineering-team', 'SESSION.md');
        const now = new Date().toISOString();
        const date = now.slice(0, 10);
        const time = now.slice(11, 16) + ' CDT';
        
        const content = `# Sprint Session — Active

**Sprint:** ${name}
**Started:** ${date} ${time}
**Status:** 🟡 Active

---

## 📝 Session Log

| Time | Event |
|------|-------|
| ${date} ${time} | Sprint started — ${name} |

---

## 🎯 Sprint Goals

- [ ] Goal 1
- [ ] Goal 2

---

## 📦 Delivered This Sprint

| Task | Status | Notes |
|------|--------|-------|
| | | |

---

## 🔭 Next Up

-

---

_Archived sessions → \`sessions/\` directory_
`;
        fs.writeFileSync(sessionPath, content);
        return `🏃 **Sprint Started:** ${name}\n_Logged to SESSION.md_`;
    }
    
    if (sub === 'log') {
        const note = args.replace(sub, '').trim();
        if (!note) return 'Usage: `!sprint log <note>`';
        
        const sessionPath = path.join(WORKSPACE_DIR, 'engineering-team', 'SESSION.md');
        let content = fs.readFileSync(sessionPath, 'utf8');
        
        const now = new Date().toISOString();
        const date = now.slice(0, 10);
        const time = now.slice(11, 16) + ' CDT';
        
        content = content.replace(
            /(\| Time \| Event \|\n\|------\|------\|\n)/,
            `| ${date} ${time} | ${note} |\n`
        );
        
        fs.writeFileSync(sessionPath, content);
        return `📝 Sprint log: ${note}`;
    }
    
    return 'Usage: `!sprint start <name>` or `!sprint log <note>`';
}

async function cmdStats() {
    const tasksDir = path.join(WORKSPACE_DIR, 'engineering-team', 'tasks');
    const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md') && (f.startsWith('TSK-') || f.startsWith('task-')));
    
    const counts = { BACKLOG: 0, TODO: 0, IN_PROGRESS: 0, VERIFY: 0, DONE: 0, REOPEN: 0 };
    
    for (const f of files) {
        const content = fs.readFileSync(path.join(tasksDir, f), 'utf8');
        const statusMatch = content.match(/\*\*Status:\*\* (\w+)/);
        if (statusMatch && counts.hasOwnProperty(statusMatch[1])) {
            counts[statusMatch[1]]++;
        }
    }
    
    const total = files.length;
    const done = counts.DONE;
    const doneRate = total > 0 ? Math.round((done / total) * 100) : 0;
    
    return `**📊 Software Factory Stats**

Total tasks: ${total}
In flight: ${counts.IN_PROGRESS + counts.VERIFY} (${counts.IN_PROGRESS} in progress, ${counts.VERIFY} in verify)
Done: ${counts.DONE} (${doneRate}%)

Board: \`${counts.BACKLOG}\` backlog · \`${counts.TODO}\` todo · \`${counts.IN_PROGRESS}\` in progress · \`${counts.VERIFY}\` verify · \`${counts.DONE}\` done · \`${counts.REOPEN}\` reopened`;
}

// ─── Discord reply ─────────────────────────────────────────────────────────────

async function sendReply(channelId, messageId, content) {
    try {
        await discordRequest('POST', `/channels/${channelId}/messages`, {
            content,
            message_reference: { message_id: messageId, fail_on_not_found: false }
        });
    } catch (err) {
        console.error('[reply error]', err.message);
    }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function poll() {
    const messages = await fetchMessages();
    for (const msg of messages) {
        await handleMessage(msg);
    }
}

// ─── Startup ──────────────────────────────────────────────────────────────────

console.log('🚀 Software Factory Command Router (REST polling) starting...');
console.log('[config] Workspace:', WORKSPACE_DIR);
console.log('[config] Channel:', CHANNEL_ID);

if (!BOT_TOKEN) {
    console.error('[config] Missing DISCORD_BOT_TOKEN');
    process.exit(1);
}

// Test auth on startup
discordRequest('GET', '/users/@me').then(user => {
    console.log('[auth] Bot logged in as:', user.username || 'unknown');
}).catch(err => {
    console.error('[auth] Failed:', err.message);
    process.exit(1);
});

// Start polling
setInterval(poll, POLL_INTERVAL);
console.log('[poll] Polling every', POLL_INTERVAL, 'ms');
