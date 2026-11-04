import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, hash } from '../server/db.js';
import { defaultView, type Snapshot } from '../shared/model.js';
import { fixture } from './fixture.js';

function directory(t: { after: (action: () => void) => void }) {
  const dir = resolve('test-results', `storage-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('JSON stores all planning data and photos across reopen with immutable detached reads', t => {
  const path = join(directory(t), 'planner.json');
  let db = openDatabase(path);
  const roster = fixture();
  const photo = { id: hash('photo'), mime: 'image/webp', bytes: Buffer.from('photo') };
  roster.people[0].avatarId = photo.id;
  const scenario = { id: 'scenario', name: 'Proposal', description: 'Notes', state: roster.state, revision: 3 };
  const { state, ...people } = roster;
  const snapshot: Snapshot = { id: 'snapshot', name: 'Frozen', description: '', createdAt: roster.importedAt, roster: people, state, view: defaultView };
  db.transaction(() => {
    db.addAvatar(photo); db.importBaseline(roster); db.createScenario(scenario); db.createSnapshot(snapshot);
  });
  db.close();
  const doc = JSON.parse(fs.readFileSync(path, 'utf8'));
  assert.equal(doc.formatVersion, 1);
  assert.equal(doc.avatars[0].base64, photo.bytes.toString('base64'));
  assert.equal(fs.statSync(path).mode & 0o777, 0o600);
  db = openDatabase(path);
  try {
    assert.deepEqual(db.getBaseline(), roster);
    assert.deepEqual(db.getScenario(scenario.id), scenario);
    assert.deepEqual(db.getSnapshot(snapshot.id), snapshot);
    assert.deepEqual(db.getAvatar(photo.id), photo);
    const detached = db.getScenario(scenario.id)!; detached.state.teams[0].name = 'Wrong';
    assert.deepEqual(db.getScenario(scenario.id), scenario);
    assert.equal(db.updateScenario(scenario.id, 2, scenario), false);
    assert.equal(db.updateScenario(scenario.id, 3, { ...scenario, name: 'New name' }), true);
    assert.equal(db.getScenario(scenario.id)!.revision, 4);
    assert.throws(() => db.addAvatar({ ...photo, bytes: Buffer.from('changed') }), /immutable/);
    assert.throws(() => db.createSnapshot(snapshot), /immutable/);
  } finally { db.close(); }
});
test('transactions roll back memory and disk on callback, validation and filesystem failures', t => {
  let db: ReturnType<typeof openDatabase> | undefined;
  t.after(() => db?.close());
  const dir = directory(t), path = join(dir, 'planner.json');
  db = openDatabase(path);
  db.importBaseline(fixture());
  const before = fs.readFileSync(path, 'utf8');
  const s = { id: 'scenario', name: 'New', description: '', state: fixture().state, revision: 1 };
  assert.throws(() => db!.transaction(() => { db!.createScenario(s); throw new Error('Synthetic abort'); }), /Synthetic abort/);
  assert.throws(() => db!.createScenario({ ...s, state: { ...s.state, assignments: [] } }), /Every person/);
  assert.equal(db.listScenarios().length, 0);
  assert.equal(fs.readFileSync(path, 'utf8'), before);
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('Synthetic rename failure'); };
  syncBuiltinESMExports();
  try { assert.throws(() => db!.createScenario(s), /Synthetic rename failure/); }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.equal(db.listScenarios().length, 0);
  assert.equal(fs.readFileSync(path, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['planner.json', 'planner.json.lock']);
  db.createScenario(s);
  assert.equal(db.listScenarios().length, 1);
});
test('one writer owns the JSON file; external edits and invalid JSON are never overwritten', t => {
  const path = join(directory(t), 'planner.json');
  const db = openDatabase(path);
  assert.throws(() => openDatabase(path), /locked/);
  db.importBaseline(fixture());
  const before = fs.readFileSync(path, 'utf8');
  fs.writeFileSync(path, `${before}\n`);
  assert.throws(() => db.createScenario({ id: 's', name: 'New', description: '', state: fixture().state, revision: 1 }), /changed outside/);
  assert.equal(db.listScenarios().length, 0);
  db.close();
  assert.equal(fs.existsSync(`${path}.lock`), false);
  const reopened = openDatabase(path); reopened.close();
  fs.writeFileSync(path, '{broken');
  assert.throws(() => openDatabase(path), /Invalid planner JSON/);
  assert.equal(fs.readFileSync(path, 'utf8'), '{broken');
  assert.equal(fs.existsSync(`${path}.lock`), false);
});
