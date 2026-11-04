import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exampleRoster } from '../shared/example.js';
import { validateState } from '../shared/model.js';

test('larger example is wholly fictional with several reporting levels and shared responsibilities', () => {
  const roster = exampleRoster();
  assert.equal(roster.people.length, 38);
  assert.equal(roster.state.teams.length, 9);
  assert.equal(roster.state.orgs.length, 3);
  assert.equal(roster.state.areas!.length, 7);
  assert.deepEqual(validateState(roster.state, roster.people), roster.state);
  assert.ok(roster.people.every(p => p.source.includes('Fictional') && p.avatarId === null));
  assert.equal(roster.state.assignments.filter(a => a.teamId === null).length, 2);
  assert.ok(roster.state.areas!.some(a => roster.state.teams.filter(t => t.areaIds?.includes(a.id)).length > 1));
  assert.ok(roster.state.areas!.some(a => !roster.state.teams.some(t => t.areaIds?.includes(a.id))));
  assert.equal(roster.state.assignments.find(a => a.personId === 'workshop-2')!.managerId, 'workshop-1');
  assert.equal(roster.state.assignments.find(a => a.personId === 'workshop-1')!.managerId, 'briar');
  assert.equal(roster.state.assignments.find(a => a.personId === 'briar')!.managerId, 'cedar');
  assert.ok(new Set(roster.people.map(p => p.timezone)).size >= 10);
  const second = exampleRoster();
  roster.people[0].name = 'An edited example';
  assert.equal(second.people[0].name, 'Cedar Finch');
});
