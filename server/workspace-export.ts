import { validateState, type Roster } from '../shared/model.js';
import { validateDocument, type StoreDocument } from './db.js';

export function workspaceBackup(source: StoreDocument, referenceId: string | null): StoreDocument {
  const baseline = referenceId === null ? source.baseline : null;
  const references = source.references.filter(r => r.id === referenceId);
  if (!baseline && !references.length) throw new Error('Workspace unavailable. It may have been deleted.');
  const scenarios = source.scenarios.filter(s => (s.referenceId ?? null) === referenceId);
  const snapshots = source.snapshots.filter(s => s.referenceId === referenceId);
  const reference = baseline ?? references[0].roster;
  const views = [
    reference,
    ...scenarios.map(s => ({ people: s.roster?.people ?? reference.people, state: s.state })),
    ...snapshots.map(s => ({ people: s.roster.people, state: s.state })),
  ];
  const photos = new Set(views.flatMap(view => [
    ...view.people, ...(validateState(view.state, view.people).areas ?? []).flatMap(a => a.partners),
  ]).flatMap(person => person.avatarId ? [person.avatarId] : []));
  return validateDocument({ formatVersion: 1, baseline, references, scenarios, snapshots,
    avatars: source.avatars.filter(a => photos.has(a.id)) });
}

function csv(rows: string[][]): string {
  return rows.map(row => row.map(value => {
    // Quoting alone does not stop spreadsheet applications from evaluating formulas.
    const safe = /^\s*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n') + '\r\n';
}

export function rosterCsv(roster: Roster): string {
  const state = validateState(roster.state, roster.people);
  return csv([
    ['person_id', 'name', 'team', 'manager', 'role', 'timezone'],
    ...roster.people.map(person => {
      const assignment = state.assignments.find(a => a.personId === person.id)!;
      return [person.id, person.name, state.teams.find(t => t.id === assignment.teamId)?.name ?? '',
        assignment.managerId ?? '', person.title, person.timezone ?? ''];
    }),
  ]);
}

export function areasCsv(roster: Roster): string {
  const state = validateState(roster.state, roster.people);
  return csv([
    ['name', 'description', 'owner', 'teams'],
    ...(state.areas ?? []).map(area => [
      area.name, area.description, area.owner,
      state.teams.filter(t => t.areaIds?.includes(area.id)).map(t =>
        !t.name.includes(';') && state.teams.filter(other => other.name === t.name || other.id === t.name).length === 1
          ? t.name : t.id).join(';'),
    ]),
  ]);
}
