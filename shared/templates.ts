import { areaTemplate, rosterTemplate, importRoster, importAreas, suggestMapping, readTable } from './import.js';

export function workspaceTemplate() {
  const roster = importRoster(rosterTemplate, suggestMapping(readTable(rosterTemplate).headers), 'Example workspace');
  roster.importedAt = '2026-01-01T00:00:00.000Z';
  roster.notes.unshift('All people, teams and responsibilities in this template are fictional.');
  roster.state = importAreas(areaTemplate, roster.state);
  return {
    formatVersion: 1 as const, baseline: roster, references: [],
    scenarios: [{ id: 'example-plan', name: 'Example workspace plan', description: 'A fictional workspace for trying imports.', state: roster.state, revision: 1 }],
    snapshots: [], avatars: [],
  };
}

export const releaseTemplates = new Map([
  ['templates/roster.csv', rosterTemplate],
  ['templates/areas.csv', areaTemplate],
  ['templates/workspace.json', JSON.stringify(workspaceTemplate(), null, 2) + '\n'],
]);
