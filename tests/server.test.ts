import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase, importBaseline, hash, type DB } from '../server/db.js';
import { configuration, type Config } from '../server/config.js';
import { homedir } from 'node:os';
import { exportExistingSnapshots, renderSnapshotHtml } from '../server/snapshots.js';
import { defaultView, saveArea, validateState, type Snapshot } from '../shared/model.js';
import { areaFixture, fixture } from './fixture.js';

let db: DB;
let dir: string;
let config: Config;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  dir = resolve('test-results', `server-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  config = { origin: 'http://127.0.0.1:4173', databasePath: join(dir, 'planner.json'), distPath: resolve('dist'), snapshotPath: join(dir, 'snapshots') };
  db = openDatabase(config.databasePath);
  importBaseline(db, fixture());
  app = createApp(db, config);
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
const local = () => ({ Host: '127.0.0.1:4173', Origin: config.origin, 'X-Org-Planner': 'local' });
async function scenario(state = fixture().state) {
  return (await request(app).post('/api/scenarios').set(local()).send({ name: 'Alternative', description: '', state }).expect(201)).body;
}
async function snapshot(): Promise<Snapshot> {
  const s = await scenario();
  return (await request(app).post('/api/snapshots').set(local()).send({ name: 'Review', description: 'Locked', scenarioId: s.id, revision: 1 }).expect(201)).body;
}
test('workspace and snapshots open without authentication; old identity routes are gone', async () => {
  await request(app).get('/api/workspace').set({ Host: '127.0.0.1:4173' }).expect(200);
  const snap = await snapshot();
  await request(app).get(`/api/snapshots/${snap.id}`).set(local()).expect(200);
  await request(app).get(`/s/${snap.id}`).set(local()).expect(200);
  for (const path of ['/api/me', '/login', '/auth/github', '/auth/callback', '/.env', '/server/db.ts', `/api/snapshots/${snap.id}/viewers`]) {
    await request(app).get(path).set(local()).expect(404);
  }
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(config.databasePath, 'utf8'))), ['formatVersion', 'baseline', 'references', 'scenarios', 'snapshots', 'avatars']);
});
test('loopback host and cross-origin protections remain without account authentication', async () => {
  await request(app).get('/api/workspace').set({ Host: 'evil.example' }).expect(403);
  await request(app).get('/api/workspace').set({ ...local(), 'Sec-Fetch-Site': 'cross-site' }).expect(403);
  await request(app).get('/api/workspace').set({ ...local(), Origin: 'https://evil.example' }).expect(403);
  await request(app).post('/api/scenarios').set({ Host: '127.0.0.1:4173', Origin: config.origin }).send({}).expect(403);
  await request(app).post('/api/scenarios').set({ Host: '127.0.0.1:4173', 'X-Org-Planner': 'local' }).send({}).expect(403);
  await request(app).post('/api/scenarios').set({ ...local(), Origin: 'https://evil.example' }).send({}).expect(403);
  assert.throws(() => createApp(db, { ...config, origin: 'http://0.0.0.0:4173' }), /local-only/);
});
test('snapshots and baseline are immutable through API and storage methods', async () => {
  const snap = await snapshot();
  assert.equal('state' in snap.roster, false);
  await request(app).put(`/api/snapshots/${snap.id}`).set(local()).send({ name: 'Changed' }).expect(404);
  await request(app).put('/api/baseline').set(local()).send({}).expect(404);
  assert.throws(() => db.createSnapshot({ ...snap, name: 'Changed' }), /immutable/);
  assert.throws(() => db.importBaseline(fixture()), /already exists/);
  const copy = db.getSnapshot(snap.id)!;
  copy.name = 'Detached copy';
  assert.equal(db.getSnapshot(snap.id)!.name, snap.name);
  const s = (await request(app).get('/api/workspace').set(local()).expect(200)).body.scenarios[0];
  s.state.teams[0].name = 'Changed in draft';
  await request(app).put(`/api/scenarios/${s.id}`).set(local()).send({ name: s.name, description: s.description, state: s.state, revision: 1 }).expect(200);
  assert.equal((await request(app).get(`/api/snapshots/${snap.id}`).set(local()).expect(200)).body.state.teams[0].name, 'Core experience');
});
test('snapshot HTML is self-contained, frozen, escaped and persistent; removal keeps exported copies', async () => {
  const snap = await snapshot();
  const file = join(config.snapshotPath, `${snap.id}.html`);
  const html = readFileSync(file, 'utf8');
  assert.match(html, /snapshot-data/);
  assert.match(html, /Alex Rivera/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  const download = await request(app).get(`/api/snapshots/${snap.id}/html`).set(local()).expect(200);
  assert.equal(download.text, html);
  assert.match(download.headers['content-disposition'], /attachment/);
  const evil = renderSnapshotHtml(db, config, { ...snap, name: '</title><script>alert(1)</script>', description: '</script><img src=x onerror=alert(1)>' });
  assert.ok(!evil.includes('</title><script>alert(1)'));
  assert.ok(!evil.includes('</script><img src=x'));
  const before = db.getBaseline();
  await request(app).delete(`/api/snapshots/${snap.id}`).set(local()).expect(204);
  for (const path of [`/s/${snap.id}`, `/api/snapshots/${snap.id}`, `/api/snapshots/${snap.id}/html`, `/api/snapshots/${snap.id}/pdf`]) {
    await request(app).get(path).set(local()).expect(404);
  }
  assert.equal(readFileSync(file, 'utf8'), html);
  assert.deepEqual(db.getBaseline(), before);
  db.close(); db = openDatabase(config.databasePath); app = createApp(db, config);
  assert.equal((await request(app).get('/api/workspace').set(local()).expect(200)).body.scenarios.length, 1);
  assert.equal(db.listSnapshots().length, 0);
});
test('failed HTML writes do not publish a snapshot, and failed deletion retains its data', async () => {
  const s = await scenario();
  const broken = createApp(db, { ...config, snapshotPath: config.databasePath });
  await request(broken).post('/api/snapshots').set(local()).send({ name: 'Cannot save', description: '', scenarioId: s.id, revision: 1 }).expect(500);
  assert.equal(db.listSnapshots().length, 0);
  const snap = await snapshot();
  const failure = mock.method(db, 'deleteSnapshot', () => { throw new Error('Synthetic failure'); });
  await request(app).delete(`/api/snapshots/${snap.id}`).set(local()).expect(500);
  await request(app).get(`/api/snapshots/${snap.id}`).set(local()).expect(200);
  failure.mock.restore();
});
test('reopening JSON preserves planning data and exports missing snapshots without rewriting them', async () => {
  const snap = await snapshot();
  const before = db.getSnapshot(snap.id);
  rmSync(join(config.snapshotPath, `${snap.id}.html`));
  db.close(); db = openDatabase(config.databasePath); app = createApp(db, config);
  exportExistingSnapshots(db, config);
  assert.ok(existsSync(join(config.snapshotPath, `${snap.id}.html`)));
  assert.deepEqual(db.getSnapshot(snap.id), before);
  await request(app).delete(`/api/snapshots/${snap.id}`).set(local()).expect(204);
});
test('optimistic revisions reject stale writes and unsaved snapshot publication', async () => {
  const s = await scenario();
  const payload = { name: s.name, description: '', state: s.state, revision: 1 };
  await request(app).put(`/api/scenarios/${s.id}`).set(local()).send(payload).expect(200);
  await request(app).put(`/api/scenarios/${s.id}`).set(local()).send(payload).expect(409);
  await request(app).post('/api/snapshots').set(local()).send({ name: 'Stale', description: '', scenarioId: s.id, revision: 1 }).expect(409);
});
test('server rejects cycles and missing people, independent of client', async () => {
  const r = fixture();
  r.state.assignments[0].managerId = 'sam';
  await request(app).post('/api/scenarios').set(local()).send({ name: 'Cycle', description: '', state: r.state }).expect(400);
  r.state.assignments.pop();
  await request(app).post('/api/scenarios').set(local()).send({ name: 'Lost person', description: '', state: r.state }).expect(400);
});
test('area catalog persists shared and unassigned edits across reopen while frozen snapshots retain original data', async () => {
  const original = fixture();
  const before = db.getBaseline();
  const details = { name: 'Scenario area', description: 'Owner responsibility', owner: 'Synthetic lead', notes: 'Planning note' };
  const s = await scenario(saveArea(original.state, 'new-area', details, []));
  const shared = saveArea(s.state, 'new-area', { ...details, name: 'Shared area' }, ['experience', 'systems']);
  await request(app).put(`/api/scenarios/${s.id}`).set(local()).send({ name: s.name, description: '', state: shared, revision: 1 }).expect(200);
  const snap = (await request(app).post('/api/snapshots').set(local()).send({ name: 'Shared areas', description: '', scenarioId: s.id, revision: 2 }).expect(201)).body;
  const detached = saveArea(shared, 'new-area', { ...details, notes: 'Later change' }, []);
  await request(app).put(`/api/scenarios/${s.id}`).set(local()).send({ name: s.name, description: '', state: detached, revision: 2 }).expect(200);
  db.close(); db = openDatabase(config.databasePath); app = createApp(db, config);
  const workspace = (await request(app).get('/api/workspace').set(local()).expect(200)).body;
  assert.deepEqual(workspace.scenarios[0].state, detached);
  assert.deepEqual(workspace.scenarios[0].state.assignments, original.state.assignments);
  assert.deepEqual((await request(app).get(`/api/snapshots/${snap.id}`).set(local()).expect(200)).body.state, shared);
  assert.deepEqual(db.getBaseline(), before);
});
test('legacy and unassigned partner photos remain snapshot scoped; conflicting areas never overwrite saved data', async () => {
  const original = fixture();
  const image = Buffer.from('synthetic partner photo'), avatarId = hash(image);
  const unrelated = Buffer.from('unrelated synthetic photo'), unrelatedId = hash(unrelated);
  db.addAvatar({ id: avatarId, mime: 'image/webp', bytes: image });
  db.addAvatar({ id: unrelatedId, mime: 'image/webp', bytes: unrelated });
  original.state.teams[0].areas![0].partners[0].avatarId = avatarId;
  original.state.teams[1].areas = structuredClone(original.state.teams[0].areas);
  const { state, ...roster } = original;
  const legacy: Snapshot = { id: 'legacy-snapshot', name: 'Legacy', description: '', createdAt: original.importedAt, state, roster, view: defaultView };
  db.createSnapshot(legacy);
  const snap = (await request(app).get(`/api/snapshots/${legacy.id}`).set(local()).expect(200)).body;
  assert.equal(snap.state.areas.length, 1);
  await request(app).get(`/api/snapshots/${legacy.id}/avatars/${avatarId}`).set(local()).expect(200);
  await request(app).get(`/api/snapshots/${legacy.id}/avatars/${unrelatedId}`).set(local()).expect(404);
  assert.deepEqual(db.getSnapshot(legacy.id), legacy);
  const normalized = validateState(state, roster.people);
  normalized.teams.forEach(t => { t.areaIds = []; });
  const s = await scenario(normalized);
  const frozen = (await request(app).post('/api/snapshots').set(local()).send({ name: 'Unassigned partners', description: '', scenarioId: s.id, revision: 1 }).expect(201)).body;
  await request(app).get(`/api/snapshots/${frozen.id}/avatars/${avatarId}`).set(local()).expect(200);
  assert.match(readFileSync(join(config.snapshotPath, `${frozen.id}.html`), 'utf8'), /data:image\/webp;base64/);
  const conflicting = structuredClone(normalized);
  conflicting.teams[0].areas = [areaFixture()];
  await request(app).put(`/api/scenarios/${s.id}`).set(local()).send({ name: s.name, description: '', state: conflicting, revision: 1 }).expect(400);
  assert.equal(db.getScenario(s.id)!.revision, 1);
});
test('configuration defaults outside the repository, accepts explicit directories and refuses remote origins', () => {
  assert.equal(configuration({}).origin, 'http://127.0.0.1:4186');
  assert.equal(configuration({}).databasePath, resolve(homedir(), '.org-planner/planner.json'));
  assert.equal(configuration({ DATA_DIR: '' }).databasePath, resolve(homedir(), '.org-planner/planner.json'));
  assert.equal(configuration({}).snapshotPath, resolve(homedir(), '.org-planner/exports'));
  assert.equal(configuration({ DATA_DIR: resolve('.private') }).databasePath, resolve('.private/planner.json'));
  assert.throws(() => configuration({ DATA_DIR: 'relative/path' }), /absolute directory/);
  assert.throws(() => configuration({ APP_ORIGIN: 'http://example.com' }), /local-only/);
  assert.throws(() => configuration({ APP_ORIGIN: 'https://127.0.0.1' }), /local-only/);
});
test('avatar upload refuses insecure URLs and invalid images without a network fetch', async () => {
  await request(app).post('/api/avatars').set(local()).send({ url: 'http://127.0.0.1/example' }).expect(400);
  await request(app).post('/api/avatars').set(local()).send({ base64: Buffer.from('<svg></svg>').toString('base64') }).expect(400);
});
