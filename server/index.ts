import { configuration } from './config.js';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { exportExistingSnapshots } from './snapshots.js';

process.umask(0o077);
const config = configuration();
const db = openDatabase(config.databasePath);
try { exportExistingSnapshots(db, config); }
catch (error) { db.close(); throw error; }
const port = Number(new URL(config.origin).port || 80);
const server = createApp(db, config).listen(port, '127.0.0.1', () => {
  console.log(`Org planner listening on loopback port ${port}.`);
});
server.on('error', error => { db.close(); console.error(error.message); process.exitCode = 1; });
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
