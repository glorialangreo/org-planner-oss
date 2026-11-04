import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { templateRouter } from '../server/templates.js';
import { areaTemplate, rosterTemplate } from '../shared/import.js';
import { parsePlannerBackup } from '../server/backup.js';

const app = express().use('/api/templates', templateRouter);

test('workspace template is a current-format fictional backup ready to import', async () => {
  const response = await request(app).get('/api/templates/planner.json').expect(200);
  assert.match(response.headers['content-disposition'], /filename="?planner.json"?/);
  const backup = parsePlannerBackup(response.text);
  assert.equal(backup.baseline?.scope, 'Example workspace');
  assert.equal(backup.baseline?.people.length, 2);
  assert.equal(backup.baseline?.state.areas?.length, 1);
  assert.deepEqual(backup.avatars, []);
  await request(app).head('/api/templates/planner.json').expect(200);
});

for (const [path, filename, contents] of [
  ['roster.csv', 'roster-template.csv', rosterTemplate],
  ['areas.csv', 'areas-template.csv', areaTemplate],
]) {
  test(`${path} is a real CSV attachment with the complete template`, async () => {
    const response = await request(app).get(`/api/templates/${path}`).expect(200);
    assert.equal(response.headers['content-disposition'].replaceAll('"', ''), `attachment; filename=${filename}`);
    assert.match(response.headers['content-type'], /^text\/csv; charset=utf-8$/);
    assert.equal(response.text, contents);
    assert.equal(Number(response.headers['content-length']), Buffer.byteLength(contents));
  });

  test(`${path} supports HEAD without sending file contents`, async () => {
    const response = await request(app).head(`/api/templates/${path}`).expect(200);
    assert.equal(response.headers['content-disposition'].replaceAll('"', ''), `attachment; filename=${filename}`);
    assert.equal(response.text, undefined);
  });
}

test('unknown templates return an explicit 404 instead of application HTML', async () => {
  const response = await request(app).get('/api/templates/unknown.csv').expect(404);
  assert.match(response.body.error, /Template unavailable/);
  await request(app).get('/api/templates/toString').expect(404);
  await request(app).post('/api/templates/roster.csv').expect(404);
});
