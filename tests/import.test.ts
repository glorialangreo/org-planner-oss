import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRosters, emptyRoster, importAreas, importRoster, readTable, rosterTemplate, suggestMapping } from '../shared/import.js';
import { validateState, regionNames } from '../shared/model.js';

const parse = (text: string) => importRoster(text, suggestMapping(readTable(text).headers), 'Fictional studio');
test('CSV supports quoted commas, escaped quotes, CRLF and multiline cells; TSV paste has the same semantics', () => {
  const csv = 'id,name,role,manager\r\none,"Cedar, Finch","Research\nand ""strategy""",\r\ntwo,Nova,Engineer,one\r\n';
  const roster = parse(csv);
  assert.equal(roster.people[0].name, 'Cedar, Finch');
  assert.equal(roster.people[0].title, 'Research\nand "strategy"');
  assert.equal(roster.state.assignments[1].managerId, 'one');
  assert.equal(parse('id\tname\tteam\tmanager\none\tCedar\tWorkshop\t\ntwo\tNova\tWorkshop\tone').state.teams.length, 1);
  assert.throws(() => readTable('name,name\nA,B'), /unique/);
  assert.throws(() => readTable('name,id\nA'), /expected 2 cells/);
  assert.throws(() => readTable('name\n"unclosed'), /not closed/);
  assert.throws(() => readTable('name\n"A"bad'), /Unexpected/);
});
test('imports resolve explicit IDs and reject ambiguous names, cycles, duplicate IDs and missing references', () => {
  assert.throws(() => parse('id,name,manager\na,Same,\nb,Same,\nc,Third,Same'), /ambiguous/);
  assert.throws(() => parse('id,name,manager\na,A,b\nb,B,a'), /cycles/);
  assert.throws(() => parse('id,name\na,A\na,B'), /duplicate person ID/);
  assert.throws(() => parse('id,name,manager\na,A,missing'), /missing/);
  assert.throws(() => parse('id,name,timezone\na,A,not-a-zone'), /Row 2, timezone.*IANA timezone/);
  assert.equal(parse('id,name,manager\na,Same,\nb,Same,a').state.assignments[1].managerId, 'a');
  const roster = parse(rosterTemplate);
  assert.equal(roster.state.teams[0].leaderId, null);
  assert.equal(roster.state.assignments[0].managerId, null);
  assert.equal(roster.people[1].timezone, 'Asia/Tokyo');
});
test('empty rosters and custom region groups retain exact timezones', () => {
  const empty = emptyRoster('New studio');
  assert.equal(validateState(empty.state, empty.people).assignments.length, 0);
  const roster = parse(rosterTemplate);
  roster.state.regionGroups = ['Service hours A'];
  roster.state.assignments[0].regionOverride = 'Service hours A';
  assert.deepEqual(regionNames(roster.state, roster.people), ['Asia', 'Service hours A']);
  assert.equal(roster.people[0].timezone, 'Europe/Madrid');
});
test('later import comparison includes team and reporting changes for stable person IDs', () => {
  const previous = parse(rosterTemplate);
  const next = parse(rosterTemplate.replace('Workshop,example-1', 'Research,'));
  const comparison = compareRosters(previous, next);
  assert.deepEqual(comparison.added, []);
  assert.deepEqual(comparison.absent, []);
  assert.deepEqual(comparison.relationships, ['Nova Vale: team from Workshop to Research', 'Nova Vale: manager from Cedar Finch to No manager']);
});
test('area import adds shared and unassigned responsibilities and rejects ambiguous or missing teams', () => {
  const roster = parse(rosterTemplate);
  const state = importAreas('name,description,owner,teams\nSupport,Help users,Cedar Finch,Workshop\nResearch,Learn from users,,', roster.state);
  assert.equal(state.areas!.length, 2);
  assert.equal(state.teams[0].areaIds!.length, 1);
  assert.equal(roster.state.areas!.length, 0);
  validateState(state, roster.people);
  assert.throws(() => importAreas('name,description,owner,teams\nSupport,,,Unknown', roster.state), /missing or ambiguous/);
  assert.throws(() => importAreas('name,description,owner,teams\nSupport,,,', state), /already exists/);
});
