import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { hash, openDatabase, validateDocument } from '../server/db.js';
import { areasCsv, rosterCsv, workspaceBackup } from '../server/workspace-export.js';
import { emptyRoster, importAreas, importRoster, readTable, suggestMapping } from '../shared/import.js';
import { defaultView, validateState } from '../shared/model.js';
import { fixture } from './fixture.js';

function setup(t: { after: (fn: () => void) => void }) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const app = createApp(db, {
    origin: 'http://127.0.0.1:4189', databasePath: ':memory:',
    distPath: resolve('dist'), snapshotPath: resolve('test-results/transfer-exports'),
  });
  const headers = { Host: '127.0.0.1:4189', Origin: 'http://127.0.0.1:4189', 'X-Org-Planner': 'local' };
  return { db, app, headers };
}

test('workspace downloads contain only the selected reference, plans, associated snapshots and required photos', async t => {
  const { db, app, headers } = setup(t);
  const photos: string[] = [];
  for (const color of ['red', 'green', 'blue', 'yellow', 'purple']) {
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: color } }).png().toBuffer();
    const id = hash(bytes); photos.push(id); db.addAvatar({ id, bytes, mime: 'image/png' });
  }
  const roster = fixture();
  roster.state = validateState(roster.state, roster.people);
  roster.people[0].avatarId = photos[0];
  db.addReference({ id: 'selected', roster, demo: false });
  const { state, ...details } = structuredClone(roster);
  details.people[1].avatarId = photos[1];
  db.createScenario({ id: 'selected-plan', referenceId: 'selected', name: 'Selected plan', description: '', state, roster: details, revision: 1 });
  const frozen = structuredClone(state);
  frozen.areas![0].partners[0].avatarId = photos[2];
  db.createSnapshot({ id: 'selected-snapshot', referenceId: 'selected', name: 'Selected frozen', description: '',
    createdAt: roster.importedAt, state: frozen, roster: details, view: defaultView });
  const other = fixture(); other.people[0].avatarId = photos[3]; other.scope = 'Other fictional workspace';
  db.addReference({ id: 'other', roster: other, demo: false });
  db.createScenario({ id: 'other-plan', referenceId: 'other', name: 'Other plan', description: '', state: other.state, revision: 1 });
  db.createSnapshot({ id: 'unassigned-snapshot', name: 'Unassigned frozen', description: '',
    createdAt: roster.importedAt, state: other.state, roster: { ...details, people: other.people }, view: defaultView });
  db.importBaseline(emptyRoster('Original fictional workspace'));
  const before = db.backup();
  const response = await request(app).get('/api/workspaces/export?referenceId=selected&format=workspace').set(headers).expect(200);
  assert.match(response.headers['content-disposition'], /filename="?planner\.json"?/);
  const exported = validateDocument(response.body);
  assert.equal(exported.baseline, null);
  assert.deepEqual(exported.references.map(r => r.id), ['selected']);
  assert.deepEqual(exported.scenarios.map(s => s.id), ['selected-plan']);
  assert.deepEqual(exported.snapshots.map(s => s.id), ['selected-snapshot']);
  assert.deepEqual(exported.avatars.map(a => a.id).sort(), photos.slice(0, 3).sort());
  assert.deepEqual(db.backup(), before);
  const preview = (await request(app).post('/api/imports/preview').set(headers).send({
    kind: 'backup', organization: 'Restored', text: JSON.stringify(exported),
  }).expect(200)).body;
  assert.deepEqual(db.backup(), before);
  await request(app).post('/api/imports/confirm').set(headers).send({ previewId: preview.previewId, confirmed: true }).expect(201);
  assert.equal(db.listReferences().length, 3);
  assert.deepEqual(db.getReference('selected'), before.references[0]);
  assert.equal(db.listSnapshots().at(-1)!.referenceId, db.listReferences().at(-1)!.id);
  const full = (await request(app).get('/api/backup').set(headers).expect(200)).body;
  assert.equal(full.references.length, 3);
  assert.ok(full.baseline);
  assert.ok(full.snapshots.some((s: { id: string }) => s.id === 'unassigned-snapshot'));
  assert.equal(full.avatars.length, 5);
  await request(app).get('/api/workspaces/export?referenceId=missing&format=workspace').set(headers).expect(404);
  await request(app).get('/api/workspaces/export?format=workspace').set(headers).expect(400);
});

test('original baseline export excludes other workspaces and unassigned snapshots', t => {
  const { db } = setup(t);
  const roster = fixture();
  const { state, ...details } = roster;
  db.importBaseline(roster);
  db.createScenario({ id: 'original-plan', name: 'Original plan', description: '', state, revision: 1 });
  for (const [id, referenceId] of [['associated', null], ['unassigned', undefined]] as const) {
    db.createSnapshot({ id, referenceId, name: id, description: '', createdAt: roster.importedAt, state, roster: details, view: defaultView });
  }
  db.addReference({ id: 'other', roster: emptyRoster('Other'), demo: false });
  const result = workspaceBackup(db.backup(), null);
  assert.deepEqual(result.baseline, roster);
  assert.deepEqual(result.references, []);
  assert.equal(result.scenarios.length, 1);
  assert.deepEqual(result.snapshots.map(s => s.id), ['associated']);
});

test('CSV exports quote punctuation, use compatible headers and neutralize spreadsheet formulas', () => {
  const roster = fixture();
  roster.people[0].name = 'Cedar, "Finch"';
  roster.people[0].title = 'Design\nand research';
  roster.people[1].name = '=HYPERLINK("https://example.invalid")';
  roster.people[2].title = '\t@SUM(1,2)';
  roster.state = validateState(roster.state, roster.people);
  roster.state.areas![0].description = 'Support, "research"\nand planning';
  roster.state.areas![0].owner = '+SUM(1,2)';
  const text = rosterCsv(roster);
  const table = readTable(text);
  assert.deepEqual(table.headers, ['person_id', 'name', 'team', 'manager', 'role', 'timezone']);
  assert.equal(table.rows[0][1], roster.people[0].name);
  assert.equal(table.rows[0][4], roster.people[0].title);
  assert.equal(table.rows[1][1], `'${roster.people[1].name}`);
  assert.equal(table.rows[2][4], `'${roster.people[2].title}`);
  const restored = importRoster(text, suggestMapping(table.headers), 'CSV copy');
  assert.equal(restored.people.length, roster.people.length);
  assert.equal(restored.state.assignments[1].managerId, 'alex');
  const areaText = areasCsv(roster);
  const areaTable = readTable(areaText);
  assert.deepEqual(areaTable.headers, ['name', 'description', 'owner', 'teams']);
  assert.equal(areaTable.rows[0][1], roster.state.areas![0].description);
  assert.equal(areaTable.rows[0][2], "'+SUM(1,2)");
  const areaCopy = importAreas(areaText, { ...roster.state, areas: [], teams: roster.state.teams.map(t => ({ ...t, areaIds: [] })) });
  assert.equal(areaCopy.areas!.length, 1);
  assert.equal(areaCopy.teams[0].areaIds!.length, 1);
});

test('CSV routes export selected baseline, including legacy areas, rather than another workspace or scenario', async t => {
  const { db, app, headers } = setup(t);
  db.importBaseline(fixture());
  db.addReference({ id: 'empty', roster: emptyRoster('Empty'), demo: false });
  const roster = await request(app).get('/api/workspaces/export?referenceId=&format=roster').set(headers).expect(200);
  assert.match(roster.headers['content-type'], /text\/csv/);
  assert.equal(readTable(roster.text).rows.length, fixture().people.length);
  const areas = await request(app).get('/api/workspaces/export?referenceId=&format=areas').set(headers).expect(200);
  assert.equal(readTable(areas.text).rows[0][0], 'Example workflows');
  const empty = await request(app).get('/api/workspaces/export?referenceId=empty&format=roster').set(headers).expect(200);
  assert.deepEqual(readTable(empty.text).rows, []);
});

test('CSV exports use the requested scenario revision and reject mismatched workspaces', async t => {
  const { db, app, headers } = setup(t);
  const roster = fixture();
  db.addReference({ id: 'selected', roster, demo: false });
  db.addReference({ id: 'other', roster: emptyRoster('Other'), demo: false });
  const changed = structuredClone(roster);
  changed.people[0].name = 'Fictional Edited Name';
  changed.state = validateState(changed.state, changed.people);
  changed.state.areas![0].description = 'Changed responsibility';
  const { state, ...details } = changed;
  db.createScenario({ id: 'edited', referenceId: 'selected', name: 'Edited', description: '', state, roster: details, revision: 1 });
  const before = db.backup();
  for (const [format, expected] of [['roster', 'Fictional Edited Name'], ['areas', 'Changed responsibility']]) {
    const response = await request(app).get(`/api/workspaces/export?referenceId=selected&format=${format}&scenarioId=edited&revision=1`).set(headers).expect(200);
    assert.ok(response.text.includes(expected));
  }
  await request(app).get('/api/workspaces/export?referenceId=other&format=roster&scenarioId=edited&revision=1').set(headers).expect(404);
  await request(app).get('/api/workspaces/export?referenceId=selected&format=roster&scenarioId=edited&revision=2').set(headers).expect(409);
  await request(app).get('/api/workspaces/export?referenceId=selected&format=roster&scenarioId=edited').set(headers).expect(409);
  await request(app).get('/api/workspaces/export?referenceId=selected&format=workspace&scenarioId=edited&revision=1').set(headers).expect(400);
  assert.deepEqual(db.backup(), before);
});

test('import and new workspace URLs serve the application on direct navigation', async t => {
  const { app, headers } = setup(t);
  for (const path of ['/import', '/new']) {
    const response = await request(app).get(path).set(headers).expect(200);
    assert.match(response.headers['content-type'], /text\/html/);
  }
});

test('area preview from baseline creates an editable scenario only after confirmation', async t => {
  const { db, app, headers } = setup(t);
  db.addReference({ id: 'selected', roster: fixture(), demo: false });
  const before = db.backup();
  const preview = (await request(app).post('/api/imports/preview').set(headers).send({
    kind: 'areas', referenceId: 'selected', organization: 'Synthetic',
    text: 'name,description,owner,teams\nNew responsibility,Example description,Cedar Finch,experience;systems',
  }).expect(200)).body;
  assert.deepEqual(db.backup(), before);
  assert.equal(preview.areas.createsScenario, true);
  assert.equal(preview.areas.state.areas.length, 2);
  await request(app).post('/api/imports/confirm').set(headers).send({ previewId: preview.previewId }).expect(400);
  const result = (await request(app).post('/api/imports/confirm').set(headers).send({ previewId: preview.previewId, confirmed: true }).expect(201)).body;
  assert.equal(result.scenario.referenceId, 'selected');
  assert.equal(result.scenario.state.areas.length, 2);
  assert.deepEqual(db.getReference('selected'), before.references[0]);
  await request(app).post('/api/imports/confirm').set(headers).send({ previewId: preview.previewId, confirmed: true }).expect(409);
});

test('area import updates only the saved scenario and refuses stale confirmations or previews', async t => {
  const { db, app, headers } = setup(t);
  const scenario = (await request(app).post('/api/setup').set(headers).send({ mode: 'example', name: 'Example' }).expect(201)).body;
  const original = db.getReference(scenario.referenceId);
  const body = { kind: 'areas', referenceId: scenario.referenceId, scenarioId: scenario.id, revision: 1,
    organization: 'Example', text: 'name,description,owner,teams\nNew responsibility,Example,Cedar Finch,Workshop' };
  const preview = (await request(app).post('/api/imports/preview').set(headers).send(body).expect(200)).body;
  assert.equal(preview.areas.createsScenario, false);
  db.updateScenario(scenario.id, 1, { name: 'Concurrent rename', description: '', state: scenario.state, roster: scenario.roster });
  const before = db.backup();
  await request(app).post('/api/imports/confirm').set(headers).send({ previewId: preview.previewId, confirmed: true }).expect(409);
  await request(app).post('/api/imports/preview').set(headers).send(body).expect(409);
  assert.deepEqual(db.backup(), before);
  const fresh = (await request(app).post('/api/imports/preview').set(headers).send({ ...body, revision: 2 }).expect(200)).body;
  const result = (await request(app).post('/api/imports/confirm').set(headers).send({ previewId: fresh.previewId, confirmed: true }).expect(201)).body;
  assert.equal(result.scenario.id, scenario.id);
  assert.equal(result.scenario.name, 'Concurrent rename');
  assert.equal(result.scenario.revision, 3);
  assert.equal(db.listScenarios().length, 1);
  assert.deepEqual(db.getReference(scenario.referenceId), original);
});

test('areas require an explicit existing workspace and never infer missing teams', async t => {
  const { db, app, headers } = setup(t);
  const body = { kind: 'areas', organization: 'Empty', text: 'name,description,owner,teams\nResponsibility,Example,,' };
  await request(app).post('/api/imports/preview').set(headers).send(body).expect(400);
  assert.equal(db.listReferences().length, 0);
  const scenario = (await request(app).post('/api/setup').set(headers).send({ mode: 'empty', name: 'Empty' }).expect(201)).body;
  const before = db.backup();
  await request(app).post('/api/imports/preview').set(headers).send({ ...body, referenceId: scenario.referenceId, text: body.text + 'Missing team' }).expect(400);
  assert.deepEqual(db.backup(), before);
  const preview = (await request(app).post('/api/imports/preview').set(headers).send({ ...body, referenceId: scenario.referenceId, scenarioId: scenario.id, revision: 1 }).expect(200)).body;
  assert.equal(preview.areas.state.areas[0].name, 'Responsibility');
  assert.deepEqual(preview.areas.state.teams, []);
});
