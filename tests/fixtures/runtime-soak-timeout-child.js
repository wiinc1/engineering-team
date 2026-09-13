'use strict';

process.stdout.write('DATABASE_URL=postgres://user:secret@localhost/runtime\n');
process.once('SIGTERM', () => {
  process.stderr.write('termination observed\n');
  setTimeout(() => process.exit(0), 10);
});
setInterval(() => {}, 1_000);
