import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateState, movePerson, regionFor, saveArea, areasForTeam } from '../shared/model.js';
import { areaFixture, fixture } from './fixture.js';

test('moving a leader preserves reporting and clears old leadership', () => {
  const r = fixture(); const next = movePerson(r.state, 'alex', 'systems');
  assert.equal(next.teams[0].leaderId, null);
  assert.equal(next.assignments.find(a => a.personId === 'sam')?.managerId, 'alex');
  validateState(next, r.people);
});
test('cycles, duplicate memberships, missing people and orphan teams are rejected', () => {
  const r = fixture();
  for (const edit of [
    () => { r.state.assignments[0].managerId = 'sam'; },
    () => { r.state.assignments.pop(); },
    () => { r.state.assignments[1].personId = 'alex'; },
    () => { r.state.teams.pop(); },
    () => { r.state.orgs.pop(); },
  ]) {
    const before = structuredClone(r.state);
    edit(); assert.throws(() => validateState(r.state, r.people)); r.state = before;
  }
});
test('team deletion with explicit transfer retains everyone', () => {
  const r = fixture();
  r.state.teams = r.state.teams.filter(t => t.id !== 'experience');
  r.state.assignments = r.state.assignments.map(a => a.teamId === 'experience' ? { ...a, teamId: null } : a);
  assert.equal(validateState(r.state, r.people).assignments.length, 8);
});
test('timezone categories cover all IANA regions without assuming US or European groups', () => {
  assert.equal(regionFor(null), 'Unknown');
  assert.equal(regionFor('not-a-timezone'), 'Unknown');
  assert.equal(regionFor('Europe/Madrid'), 'Europe');
  assert.equal(regionFor('America/Los_Angeles'), 'America');
  assert.equal(regionFor('America/Toronto'), 'America');
  assert.equal(regionFor('America/Chicago'), 'America');
  assert.equal(regionFor('Africa/Algiers'), 'Africa');
});

test('Unassigned positions are optional for old scenarios and validated for new edits', () => {
  const r = fixture();
  assert.equal(validateState(r.state, r.people).unassignedPosition, undefined);
  r.state.unassignedPosition = { x: -240, y: 80 };
  assert.deepEqual(validateState(r.state, r.people).unassignedPosition, { x: -240, y: 80 });
  const moved = movePerson(r.state, 'sam', null);
  assert.deepEqual(moved.unassignedPosition, r.state.unassignedPosition);
  assert.equal(moved.assignments.find(a => a.personId === 'sam')?.managerId, 'alex');
  assert.throws(() => validateState({ ...r.state, unassignedPosition: { x: Infinity, y: 0 } }, r.people));
  assert.throws(() => validateState({ ...r.state, unassignedPosition: { x: 0, y: 100001 } }, r.people));
});

test('legacy shared areas normalize without losing provenance, partners or memberships', () => {
  const r = fixture();
  r.state.teams[1].areas = [areaFixture()];
  const original = structuredClone(r.state);
  const state = validateState(r.state, r.people);
  assert.deepEqual(r.state, original);
  assert.deepEqual(state.areas, [areaFixture()]);
  assert.deepEqual(state.teams.slice(0, 2).map(t => t.areaIds), [['fictional-workflows'], ['fictional-workflows']]);
  assert.ok(state.teams.every(t => !('areas' in t)));
  assert.deepEqual(state.assignments, original.assignments);
  assert.deepEqual(validateState(state, r.people), state);
});

test('area create, shared edit, reassign and unassign retain the catalog and design structure', () => {
  const r = fixture();
  const details = { name: 'New area', description: 'New responsibility', owner: '', notes: '' };
  let state = validateState(saveArea(r.state, 'new-area', details, []), r.people);
  assert.equal(state.areas!.length, 2);
  assert.ok(state.teams.every(t => !t.areaIds?.includes('new-area')));
  state = validateState(saveArea(state, 'new-area', details, ['experience', 'systems']), r.people);
  assert.deepEqual(state.teams.filter(t => t.areaIds?.includes('new-area')).map(t => t.id), ['experience', 'systems']);
  state = validateState(saveArea(state, 'new-area', { ...details, description: 'Shared change' }, ['experience', 'systems']), r.people);
  for (const team of state.teams.slice(0, 2)) assert.equal(areasForTeam(state, team).find(a => a.id === 'new-area')?.description, 'Shared change');
  state = validateState(saveArea(state, 'new-area', details, ['research']), r.people);
  assert.deepEqual(state.teams.filter(t => t.areaIds?.includes('new-area')).map(t => t.id), ['research']);
  state = validateState(saveArea(state, 'new-area', details, []), r.people);
  assert.equal(state.areas!.length, 2);
  assert.ok(state.teams.every(t => !t.areaIds?.includes('new-area')));
  state = validateState(saveArea(state, 'fictional-workflows', details, []), r.people);
  assert.deepEqual(state.areas![0].partners, areaFixture().partners);
  assert.equal(state.areas![0].source, areaFixture().source);
  assert.deepEqual(state.assignments, r.state.assignments);
  assert.deepEqual(state.teams.map(({ areaIds: _links, ...t }) => t), r.state.teams.map(({ areas: _legacy, ...t }) => t));
});

test('conflicting legacy/catalog copies, duplicate catalog IDs and dangling links are explicit errors', () => {
  const r = fixture();
  r.state.teams[1].areas = [{ ...areaFixture(), notes: 'Different source conclusion' }];
  assert.throws(() => validateState(r.state, r.people), /conflicting copies.*no copies were discarded/);
  r.state.teams[1].areas = [];
  r.state.areas = [{ ...areaFixture(), partners: [] }];
  assert.throws(() => validateState(r.state, r.people), /conflicting copies/);
  r.state.areas = [areaFixture(), areaFixture()];
  assert.throws(() => validateState(r.state, r.people), /Duplicate area/);
  r.state.areas = [];
  r.state.teams[1].areaIds = ['absent'];
  assert.throws(() => validateState(r.state, r.people), /missing area/);
  r.state.teams[1].areaIds = ['fictional-workflows', 'fictional-workflows'];
  assert.throws(() => validateState(r.state, r.people), /Duplicate area assignment/);
});

test('deleting the final assigned team keeps its area and legacy states without areas work', () => {
  const r = fixture();
  const state = validateState(r.state, r.people);
  state.teams = state.teams.filter(t => t.id !== 'experience');
  state.assignments = state.assignments.map(a => a.teamId === 'experience' ? { ...a, teamId: null } : a);
  assert.deepEqual(validateState(state, r.people).areas, [areaFixture()]);
  delete r.state.teams[0].areas;
  assert.deepEqual(validateState(r.state, r.people).areas, []);
});
