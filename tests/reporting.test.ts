import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportingLayout } from '../shared/reporting.js';
import { fixture } from './fixture.js';

test('reporting layout keeps managers above reports and subtrees together without overlap', () => {
  const { assignments } = fixture().state;
  const positions = reportingLayout(assignments);
  assert.equal(positions.size, assignments.length);
  for (const a of assignments) {
    if (a.managerId) assert.equal(positions.get(a.personId)!.y - positions.get(a.managerId)!.y, 250);
  }
  const children = assignments.filter(a => a.managerId === 'alex').map(a => positions.get(a.personId)!.x);
  assert.equal(positions.get('alex')!.x, (children[0] + children.at(-1)!) / 2);
  assert.ok(positions.get('morgan')!.x < positions.get('casey')!.x);
  assert.ok(positions.get('riley')!.x < positions.get('jordan')!.x);
  const values = [...positions.values()];
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
    assert.ok(Math.abs(values[i].x - values[j].x) >= 260 || Math.abs(values[i].y - values[j].y) >= 184);
  }
});

test('reporting layout retains independent roots and never mutates memberships or managers', () => {
  const { assignments } = fixture().state;
  assignments.find(a => a.personId === 'taylor')!.managerId = null;
  const original = structuredClone(assignments);
  const positions = reportingLayout(assignments);
  assert.equal(positions.size, assignments.length);
  assert.equal(positions.get('alex')!.y, 0);
  assert.equal(positions.get('taylor')!.y, 0);
  assert.deepEqual(assignments, original);
});
