import { type Area, type Roster } from '../shared/model.js';

export function areaFixture(): Area {
  return {
    id: 'fictional-workflows', name: 'Example workflows', description: 'Synthetic workflow responsibility.',
    owner: 'Alex Rivera', source: 'Synthetic test fixture', notes: 'Fictional example area.',
    partners: [
      { id: 'fictional-product', name: 'Robin Example', title: 'Product manager', timezone: 'Europe/London', avatarId: null, source: 'Synthetic test fixture', discipline: 'Product', context: 'Portfolio partner' },
      { id: 'fictional-engineer', name: 'Drew Example', title: 'Engineering manager', timezone: null, avatarId: null, source: 'Synthetic test fixture', discipline: 'Engineering', context: 'Named collaborator, not an accountable lead' },
    ],
  };
}

// Fictional names and relationships. Never replace with personnel records.
export function fixture(): Roster {
  return {
    importedAt: '2026-10-01T09:00:00.000Z', scope: 'Synthetic demo · not a real organization', complete: true,
    notes: ['Every person and team in this demo is fictional. No real personnel data is used.'],
    people: [
      ['alex', 'Alex Rivera', 'Design director', 'Europe/Madrid'],
      ['sam', 'Sam Chen', 'Product designer', 'America/Los_Angeles'],
      ['jamie', 'Jamie Brooks', 'Design engineer', 'America/New_York'],
      ['morgan', 'Morgan Ellis', 'Product designer', 'Europe/London'],
      ['taylor', 'Taylor Singh', 'Design manager', 'America/Toronto'],
      ['jordan', 'Jordan Reed', 'Researcher', 'Asia/Tokyo'],
      ['casey', 'Casey Park', 'Product designer', null],
      ['riley', 'Riley Adams', 'Design engineer', 'America/Chicago'],
    ].map(([id, name, title, timezone]) => ({ id: id!, name: name!, title: title!, timezone, avatarId: null, source: 'Synthetic test fixture' })),
    state: {
      orgs: [{ id: 'product', name: 'Product design' }, { id: 'platform', name: 'Platform' }],
      teams: [
        { id: 'experience', name: 'Core experience', description: 'Fictional core workflow team.', orgId: 'product', leaderId: 'alex', position: { x: 0, y: 0 }, areas: [areaFixture()] },
        { id: 'systems', name: 'Design systems', description: 'Fictional shared foundations team.', orgId: 'platform', leaderId: 'taylor', position: { x: 340, y: 0 } },
        { id: 'research', name: 'Research', description: 'Fictional research team.', orgId: 'product', leaderId: null, position: { x: 680, y: 0 } },
      ],
      assignments: [
        ['alex', 'experience', null], ['sam', 'experience', 'alex'], ['jamie', 'experience', 'alex'],
        ['morgan', 'experience', 'alex'], ['taylor', 'systems', 'alex'], ['jordan', 'research', 'alex'],
        ['casey', 'systems', 'taylor'], ['riley', 'systems', 'taylor'],
      ].map(([personId, teamId, managerId]) => ({ personId: personId!, teamId, managerId, regionOverride: null })),
    },
  };
}

export function backupFixture() {
  const roster = fixture();
  const state = {
    ...roster.state,
    areas: [areaFixture()],
  };
  const { state: _state, ...details } = roster;
  return {
    formatVersion: 1, baseline: { ...roster, state }, references: [],
    scenarios: [{ id: 'fixture-plan', name: 'Fictional plan', description: '', state, revision: 3 }],
    snapshots: [{ id: 'fixture-snapshot', name: 'Fictional snapshot', description: '', createdAt: roster.importedAt, roster: details, state }],
    avatars: [],
  };
}
