import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlannerBackup } from '../server/backup.js';
import { openDatabase } from '../server/db.js';
import { backupFixture } from './fixture.js';

test('current backup preserves all records and restores independent copies', () => {
  const original = backupFixture();
  const text = JSON.stringify(original);
  const backup = parsePlannerBackup(text);
  assert.deepEqual(backup, JSON.parse(text));
  assert.equal(backup.baseline!.state.areas![0].owner, 'Alex Rivera');
  assert.equal(backup.baseline!.state.teams[0].areas![0].owner, 'Alex Rivera');
  assert.equal(backup.scenarios[0].state.areas![0].owner, 'Alex Rivera');
  assert.equal(backup.snapshots[0].state.areas![0].owner, 'Alex Rivera');
  assert.deepEqual(backup.baseline!.people, original.baseline.people);
  assert.deepEqual(backup.scenarios[0].state.assignments, original.scenarios[0].state.assignments);
  assert.equal(backup.scenarios[0].revision, 3);
  assert.equal(JSON.stringify(original), text);
  const db = openDatabase(':memory:');
  try {
    db.restoreAdditive(backup);
    assert.equal(db.listScenarios()[0].state.areas![0].owner, 'Alex Rivera');
    assert.notEqual(db.listScenarios()[0].id, original.scenarios[0].id);
    assert.notEqual(db.listSnapshots()[0].id, original.snapshots[0].id);
    assert.equal(db.listSnapshots()[0].roster.people.length, original.baseline.people.length);
  } finally { db.close(); }
});
test('invalid backups return concise recovery guidance rather than all schema issues', () => {
  assert.throws(() => parsePlannerBackup('{broken'), /not valid JSON.*Nothing has been restored/);
  assert.throws(() => parsePlannerBackup('[]'), /not a supported planner backup/);
  assert.throws(() => parsePlannerBackup('{"formatVersion":99}'), /not a supported planner backup/);
  try {
    parsePlannerBackup('{"formatVersion":1,"baseline":{},"scenarios":[{},{}],"snapshots":[{},{}],"avatars":[{}]}');
    assert.fail('Expected failure');
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.ok(e.message.length < 400);
    assert.match(e.message, /Nothing has been restored/);
  }
});
test('unsupported fields are rejected instead of silently converting or dropping records', () => {
  const value = JSON.parse(JSON.stringify(backupFixture()));
  value.baseline.state.areas[0].unsupportedOwner = value.baseline.state.areas[0].owner;
  delete value.baseline.state.areas[0].owner;
  assert.throws(() => parsePlannerBackup(JSON.stringify(value)), /missing or unsupported data.*Nothing has been restored/);
});
