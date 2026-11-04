import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { readTable, rosterTemplate, suggestMapping } from '../shared/import.js';
import { backupFixture } from './fixture.js';

function setup(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'planner-test-'));
  const db = openDatabase(join(directory, 'planner.json'));
  const app = createApp(db, { origin: 'http://127.0.0.1:4189', databasePath: join(directory, 'planner.json'), distPath: resolve('dist'), snapshotPath: join(directory, 'exports') });
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const headers = { Host: '127.0.0.1:4189', Origin: 'http://127.0.0.1:4189', 'X-Org-Planner': 'local' };
  return { db, app, headers };
}
test('first-run empty workspace supports editable roster and immutable baseline and snapshots', async t => {
  const { db, app, headers } = setup(t);
  const fresh = (await request(app).get('/api/workspace').set(headers).expect(200)).body;
  assert.equal(fresh.references.length, 0);
  const plan = (await request(app).post('/api/setup').set(headers).send({ mode: 'empty', name: 'Fictional studio' }).expect(201)).body;
  const original = db.getReference(plan.referenceId);
  const person = { id: 'cedar', name: 'Cedar Finch', title: 'Coordinator', timezone: 'Africa/Nairobi', avatarId: null, source: 'Test' };
  plan.roster.people.push(person);
  plan.state.assignments.push({ personId: person.id, teamId: null, managerId: null, regionOverride: 'Service hours A' });
  await request(app).put(`/api/scenarios/${plan.id}`).set(headers).send({ name: plan.name, description: '', roster: plan.roster, state: plan.state, revision: 1 }).expect(200);
  const snapshot = (await request(app).post('/api/snapshots').set(headers).send({ name: 'Frozen', description: '', scenarioId: plan.id, revision: 2 }).expect(201)).body;
  assert.equal(snapshot.roster.people[0].name, person.name);
  plan.roster.people[0].name = 'Cedar Vale';
  await request(app).put(`/api/scenarios/${plan.id}`).set(headers).send({ name: plan.name, description: '', roster: plan.roster, state: plan.state, revision: 2 }).expect(200);
  assert.deepEqual(db.getReference(plan.referenceId), original);
  assert.equal(db.getSnapshot(snapshot.id)!.roster.people[0].name, 'Cedar Finch');
  await request(app).put(`/api/scenarios/${plan.id}`).set(headers).send({ name: plan.name, description: '', roster: plan.roster, state: plan.state, revision: 2 }).expect(409);
});
test('preview has no persistence, confirmations are single-use, and later imports never remove old people', async t => {
  const { db, app, headers } = setup(t);
  const example = (await request(app).post('/api/setup').set(headers).send({ mode: 'example', name: 'Example' }).expect(201)).body;
  const old = db.backup();
  const text = 'person_id,name,manager\nnew,New Fictional Person,';
  const preview = (await request(app).post('/api/imports/preview').set(headers).send({
    kind: 'roster', text, mapping: suggestMapping(readTable(text).headers), organization: 'New studio', referenceId: example.referenceId,
  }).expect(200)).body;
  assert.deepEqual(db.backup(), old);
  assert.equal(preview.comparison.absent.length, example.roster.people.length);
  await request(app).post('/api/imports/confirm').set(headers).send({ previewId: preview.previewId }).expect(400);
  await request(app).post('/api/imports/confirm').set(headers).send({ previewId: preview.previewId, confirmed: true }).expect(201);
  await request(app).post('/api/imports/confirm').set(headers).send({ previewId: preview.previewId, confirmed: true }).expect(409);
  assert.deepEqual(db.getScenario(example.id), old.scenarios[0]);
  assert.equal(db.listReferences().length, 2);
  assert.equal(db.listReferences()[0].demo, true);
  assert.equal(db.listReferences()[1].demo, false);
  assert.equal(db.listReferences()[1].roster.people.length, 1);
});
test('backups restore independent copies transactionally and reject malformed or dangling references', async t => {
  const { db, app, headers } = setup(t);
  const plan = (await request(app).post('/api/setup').set(headers).send({ mode: 'example', name: 'Example' }).expect(201)).body;
  await request(app).post('/api/snapshots').set(headers).send({ name: 'Frozen', description: '', scenarioId: plan.id, revision: 1 }).expect(201);
  const original = db.backup();
  const backup = (await request(app).get('/api/backup').set(headers).expect(200)).body;
  const preview = (await request(app).post('/api/imports/preview').set(headers).send({ kind: 'backup', organization: 'Restore', text: JSON.stringify(backup) }).expect(200)).body;
  assert.equal(preview.backup.snapshots, 1);
  await request(app).post('/api/imports/confirm').set(headers).send({ previewId: preview.previewId, confirmed: true }).expect(201);
  assert.equal(db.listReferences().length, 2);
  assert.equal(db.listScenarios().length, 2);
  assert.equal(db.listSnapshots().length, 2);
  assert.deepEqual(db.getScenario(plan.id), original.scenarios[0]);
  assert.notEqual(db.listSnapshots()[0].id, db.listSnapshots()[1].id);
  const before = db.backup();
  backup.scenarios[0].referenceId = 'missing';
  await request(app).post('/api/imports/preview').set(headers).send({ kind: 'backup', organization: 'Restore', text: JSON.stringify(backup) }).expect(400);
  assert.deepEqual(db.backup(), before);
  await request(app).post('/api/imports/preview').set(headers).send({ kind: 'backup', organization: 'Restore', text: 'not json' }).expect(400);
});
test('invalid spreadsheet preview returns an actionable error and stores nothing', async t => {
  const { db, app, headers } = setup(t);
  const text = rosterTemplate.replace('example-1,Researcher', 'missing,Researcher');
  const response = await request(app).post('/api/imports/preview').set(headers).send({ kind: 'roster', organization: 'Fictional', text, mapping: suggestMapping(readTable(text).headers) }).expect(400);
  assert.match(response.body.error, /Row 3.*missing/);
  assert.equal(db.listReferences().length, 0);
});
test('local photos are normalized without metadata and unsupported uploads never reach storage', async t => {
  const { db, app, headers } = setup(t);
  const bytes = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#448855' } }).jpeg().withMetadata().toBuffer();
  const uploaded = (await request(app).post('/api/avatars').set(headers).send({ base64: bytes.toString('base64') }).expect(201)).body;
  const image = db.getAvatar(uploaded.id)!;
  const metadata = await sharp(image.bytes).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 160); assert.equal(metadata.height, 160);
  assert.equal(metadata.exif, undefined);
  await request(app).post('/api/avatars').set(headers).send({ base64: Buffer.from('<svg></svg>').toString('base64') }).expect(400);
  assert.equal(db.backup().avatars.length, 1);
});
test('JSON backup preview only persists restored copies after confirmation', async t => {
  const { db, app, headers } = setup(t);
  const old = backupFixture();
  const before = db.backup();
  const preview = (await request(app).post('/api/imports/preview').set(headers).send({ kind: 'backup', organization: 'Restore', text: JSON.stringify(old) }).expect(200)).body;
  assert.equal(preview.backup.snapshots, 1);
  assert.deepEqual(db.backup(), before);
  await request(app).post('/api/imports/confirm').set(headers).send({ previewId: preview.previewId, confirmed: true }).expect(201);
  assert.equal(db.listReferences()[0].roster.people.length, old.baseline.people.length);
  assert.equal(db.listScenarios()[0].state.areas![0].owner, old.baseline.state.areas[0].owner);
  assert.equal(db.listSnapshots().length, 1);
});
