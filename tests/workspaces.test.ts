import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase, hash } from '../server/db.js';
import { fixture, backupFixture } from './fixture.js';
import { defaultView } from '../shared/model.js';

function setup(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-delete-'));
  const databasePath = join(directory, 'planner.json');
  const snapshotPath = join(directory, 'exports');
  const db = openDatabase(databasePath);
  const app = createApp(db, { origin: 'http://127.0.0.1:4189', databasePath, snapshotPath, distPath: resolve('dist') });
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  return { db, app, databasePath, snapshotPath, headers: { Host: '127.0.0.1:4189', Origin: 'http://127.0.0.1:4189', 'X-Org-Planner': 'local' } };
}

test('confirmed workspace deletion removes only its scenarios, snapshots, exports and unused photos', async t => {
  const { db, app, headers, snapshotPath } = setup(t);
  const photos = await Promise.all(['red', 'blue'].map(async background => {
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background } }).png().toBuffer();
    return { id: hash(bytes), mime: 'image/png', bytes };
  }));
  photos.forEach(photo => db.addAvatar(photo));
  for (const id of ['a', 'b']) {
    const roster = fixture();
    roster.scope = `Fictional workspace ${id}`;
    roster.people[0].avatarId = id === 'a' ? photos[0].id : null;
    roster.people[1].avatarId = photos[1].id;
    db.addReference({ id, roster, demo: false });
    const { state, ...details } = roster;
    db.createScenario({ id, name: id, description: '', state, roster: details, referenceId: id, revision: 1 });
  }
  const a = (await request(app).post('/api/snapshots').set(headers).send({ name: 'Frozen A', description: '', scenarioId: 'a', revision: 1 }).expect(201)).body;
  const b = (await request(app).post('/api/snapshots').set(headers).send({ name: 'Frozen B', description: '', scenarioId: 'b', revision: 1 }).expect(201)).body;
  assert.equal(a.referenceId, 'a');
  const before = db.backup();
  const bHtml = readFileSync(join(snapshotPath, `${b.id}.html`));
  await request(app).delete('/api/workspaces').set(headers).send({ referenceId: 'a' }).expect(400);
  await request(app).delete('/api/workspaces').set({ Host: headers.Host }).send({ referenceId: 'a', confirmed: true }).expect(403);
  assert.deepEqual(db.backup(), before);
  await request(app).delete('/api/workspaces').set(headers).send({ referenceId: 'a', confirmed: true }).expect(204);
  assert.equal(db.getReference('a'), undefined);
  assert.equal(db.getScenario('a'), undefined);
  assert.equal(db.getSnapshot(a.id), undefined);
  assert.equal(db.getAvatar(photos[0].id), undefined);
  assert.ok(db.getAvatar(photos[1].id));
  assert.deepEqual(db.getReference('b'), before.references[1]);
  assert.deepEqual(db.getScenario('b'), before.scenarios[1]);
  assert.deepEqual(db.getSnapshot(b.id), before.snapshots[1]);
  assert.equal(existsSync(join(snapshotPath, `${a.id}.html`)), false);
  assert.deepEqual(readFileSync(join(snapshotPath, `${b.id}.html`)), bHtml);
  await request(app).get(`/api/snapshots/${a.id}`).set(headers).expect(404);
  await request(app).put('/api/scenarios/a').set(headers).send({ ...before.scenarios[0], referenceId: undefined, id: undefined }).expect(409);
  await request(app).delete('/api/workspaces').set(headers).send({ referenceId: 'a', confirmed: true }).expect(404);
  await request(app).delete('/api/workspaces').set(headers).send({ referenceId: 'b', confirmed: true }).expect(204);
  assert.deepEqual(db.backup(), { formatVersion: 1, baseline: null, references: [], scenarios: [], snapshots: [], avatars: [] });
});

test('failed export cleanup rolls back workspace deletion', async t => {
  const { db, app, headers, snapshotPath, databasePath } = setup(t);
  db.importBaseline(fixture());
  db.createScenario({ id: 'plan', name: 'Plan', description: '', state: fixture().state, revision: 1 });
  const snapshot = (await request(app).post('/api/snapshots').set(headers).send({ name: 'Frozen', description: '', scenarioId: 'plan', revision: 1 }).expect(201)).body;
  const path = join(snapshotPath, `${snapshot.id}.html`);
  rmSync(path); mkdirSync(path); writeFileSync(join(path, 'blocked'), 'synthetic');
  const before = readFileSync(databasePath);
  await request(app).delete('/api/workspaces').set(headers).send({ referenceId: null, confirmed: true }).expect(500);
  assert.deepEqual(readFileSync(databasePath), before);
  assert.ok(db.getBaseline());
  assert.ok(db.getSnapshot(snapshot.id));
});

test('backup restore remaps snapshot ownership and never guesses between multiple workspaces', t => {
  const { db } = setup(t);
  const single = backupFixture();
  db.restoreAdditive(single);
  const first = db.listReferences()[0].id;
  assert.equal(db.listSnapshots()[0].referenceId, first);
  const current = db.backup();
  db.restoreAdditive(current);
  const second = db.listReferences()[1].id;
  assert.equal(db.listSnapshots()[1].referenceId, second);
  db.deleteWorkspace(first);
  assert.equal(db.listSnapshots().length, 1);
  assert.equal(db.listSnapshots()[0].referenceId, second);
  const multiple = { ...single, references: [{ id: 'another', roster: fixture(), demo: false }] };
  db.restoreAdditive(multiple);
  const unassigned = db.listSnapshots().find(s => s.referenceId === undefined)!;
  assert.ok(unassigned);
  for (const reference of db.listReferences()) db.deleteWorkspace(reference.id);
  assert.ok(db.getSnapshot(unassigned.id));
});

test('baseline deletion does not confuse a reference named baseline, and shared snapshot photos survive', t => {
  const { db } = setup(t);
  db.importBaseline(fixture());
  db.addReference({ id: 'baseline', roster: fixture(), demo: false });
  const { state, ...roster } = fixture();
  db.createSnapshot({ id: 'owned-baseline', name: 'Baseline snapshot', description: '', createdAt: roster.importedAt, roster, state, view: defaultView, referenceId: null });
  db.createSnapshot({ id: 'owned-reference', name: 'Reference snapshot', description: '', createdAt: roster.importedAt, roster, state, view: defaultView, referenceId: 'baseline' });
  const copy = openDatabase(':memory:');
  try {
    copy.restoreAdditive(db.backup());
    assert.notEqual(copy.listSnapshots()[0].referenceId, copy.listSnapshots()[1].referenceId);
  } finally { copy.close(); }
  db.deleteWorkspace(null);
  assert.equal(db.getBaseline(), null);
  assert.equal(db.getSnapshot('owned-baseline'), undefined);
  assert.ok(db.getSnapshot('owned-reference'));
  assert.ok(db.getReference('baseline'));
});

test('workspace deletion preserves a photo uploaded by another window before its person is saved', t => {
  const { db } = setup(t);
  db.addReference({ id: 'a', roster: fixture(), demo: false });
  const bytes = Buffer.from('synthetic pending upload');
  const id = hash(bytes);
  db.addAvatar({ id, bytes, mime: 'image/webp' });
  db.deleteWorkspace('a');
  assert.ok(db.getAvatar(id));
});
