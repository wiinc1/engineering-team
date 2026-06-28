#!/usr/bin/env node

const path = require('node:path');

process.env.TSK_RESEED_TASK_ID = process.env.TSK_RESEED_TASK_ID || 'TSK-279';
process.env.TSK_ISSUE_URL = process.env.TSK_ISSUE_URL || 'https://github.com/wiinc1/engineering-team/issues/279';
process.env.TSK_DESIGN_SCOPE_MODE = 'design_full';
process.env.TSK_PARITY_BAR = process.env.TSK_PARITY_BAR
  || 'Desktop Command Center matches issue #279 screenshot structure: grouped sidebar, command bar, urgency queue lanes, and persistent inspector.';
process.env.TSK_RAW_REQUIREMENTS = process.env.TSK_RAW_REQUIREMENTS
  || 'Implement issue #279 Command Center redesign on desktop: grouped navigation, command bar, urgency queue sections, and persistent inspector anchored to docs/design/assets/command-console-redesign-target.png.';
process.env.TSK_TASK_TITLE = process.env.TSK_TASK_TITLE || 'Command Center redesign (issue #279)';

require(path.join(__dirname, 'reseed-tsk-001-local.js'));