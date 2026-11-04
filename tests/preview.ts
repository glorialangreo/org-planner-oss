import { resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase, importBaseline } from '../server/db.js';
import { fixture } from './fixture.js';
import sharp from 'sharp';

const port = Number(process.env.TEST_PORT || 4184);
const db = openDatabase(':memory:');
importBaseline(db, fixture());
db.addAvatar({ id: 'a'.repeat(64), mime: 'image/png',
  bytes: await sharp({ create: { width: 28, height: 28, channels: 3, background: '#ddf4ff' } }).png().toBuffer() });
const server = createApp(db, {
  origin: `http://127.0.0.1:${port}`, databasePath: ':memory:', distPath: resolve('dist'),
  snapshotPath: resolve('test-results', `synthetic-snapshots-${port}`),
}).listen(port, '127.0.0.1', () => console.log(`Synthetic-only preview ready at http://127.0.0.1:${port}/`));
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
