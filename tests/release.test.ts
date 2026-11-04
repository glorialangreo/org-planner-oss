import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseProblems } from '../scripts/release-rules.js';
import { readFileSync } from 'node:fs';
import { releaseTemplates } from '../shared/templates.js';

test('release check blocks runtime data and exports even if forcibly tracked', () => {
  for (const path of ['data/planner.json', 'snapshots/example.html', 'report.pdf', 'backup.json', 'people.csv', '.env', 'assets/photo.png']) {
    assert.ok(releaseProblems(path, '{}').length, path);
  }
  assert.ok(releaseProblems('package.json', '{"baseline":{}}').length);
  assert.deepEqual(releaseProblems('src/App.tsx', 'export const name = "Org planner";'), []);
});
test('release check detects credential shapes without storing a real credential', () => {
  assert.ok(releaseProblems('src/App.tsx', `const token = "${'ghp_' + 'a'.repeat(30)}"`).length);
});
test('the approved MIT license is included in source releases', () => {
  const license = readFileSync('LICENSE', 'utf8');
  assert.ok(license.startsWith('MIT License\n'));
  assert.ok(license.includes('Copyright (c) 2026 Gloria Langreo'));
  assert.deepEqual(releaseProblems('LICENSE', license), []);
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).license, 'MIT');
  assert.equal(JSON.parse(readFileSync('package-lock.json', 'utf8')).packages[''].license, 'MIT');
});
test('only exact fictional templates can be distributed as example data', () => {
  for (const [path, expected] of releaseTemplates) {
    assert.equal(readFileSync(path, 'utf8'), expected);
    assert.deepEqual(releaseProblems(path, expected), []);
    assert.ok(releaseProblems(path, expected.replace('Cedar Finch', 'Unexpected Name')).length);
  }
  assert.ok(releaseProblems('templates/extra.json', '{"baseline":{}}').length);
  assert.ok(releaseProblems('templates/extra.csv', 'id,name\n1,Unexpected Name').length);
});
