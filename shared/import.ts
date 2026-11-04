import { rosterSchema, validateState, type Roster, type PlanState, type Area } from './model.js';

export type Columns = 'name' | 'id' | 'team' | 'manager' | 'title' | 'timezone';
export type Mapping = Record<Columns, string>;
export const rosterTemplate = 'person_id,name,team,manager,role,timezone\nexample-1,Cedar Finch,Workshop,,Team lead,Europe/Madrid\nexample-2,Nova Vale,Workshop,example-1,Researcher,Asia/Tokyo\n';
export const areaTemplate = 'name,description,owner,teams\nCustomer support,Help customers use the service,Cedar Finch,Workshop\n';

export function readTable(text: string): { headers: string[]; rows: string[][] } {
  if (text.length > 2_000_000) throw new Error('The spreadsheet exceeds 2 MB. Split it into smaller references.');
  const delimiter = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === delimiter || c === '\n' || c === '\r') {
      row.push(cell.trim()); cell = ''; closed = false;
      if (c !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else {
      if (closed || c === '"') throw new Error('Unexpected quote or text after a closing quote. Check the CSV quoting.');
      cell += c;
    }
  }
  if (quoted) throw new Error('A quoted cell is not closed. Check the CSV quoting.');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map(h => h.replace(/^\uFEFF/, '')) ?? [];
  if (!headers.length || headers.some(h => !h)) throw new Error('Add a non-empty header for every column.');
  if (new Set(headers).size !== headers.length) throw new Error('Column headers must be unique.');
  if (rows.length > 2000) throw new Error('The limit is 2,000 people per reference.');
  rows.forEach((r, i) => { if (r.length !== headers.length) throw new Error(`Row ${i + 2}: expected ${headers.length} cells, found ${r.length}.`); });
  return { headers, rows };
}

export function suggestMapping(headers: string[]): Mapping {
  const aliases = { name: ['name', 'full name'], id: ['person_id', 'id', 'person id'], team: ['team'], manager: ['manager', 'manager_id', 'reports to'], title: ['role', 'title'], timezone: ['timezone', 'time zone'] };
  return Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, headers.find(h => names.includes(h.toLowerCase())) ?? ''])) as Mapping;
}

export function emptyRoster(name: string): Roster {
  return rosterSchema.parse({
    importedAt: new Date().toISOString(), scope: name.trim(), complete: true, notes: [],
    people: [], state: { orgs: [{ id: 'organization', name: name.trim() }], teams: [], areas: [], assignments: [], regionGroups: [], unassignedPosition: { x: 0, y: 0 } },
  });
}

export function importRoster(text: string, mapping: Mapping, organization: string): Roster {
  const { headers, rows } = readTable(text);
  if (!mapping.name || !headers.includes(mapping.name)) throw new Error('Map the name column before previewing.');
  const selected = Object.values(mapping).filter(Boolean);
  if (new Set(selected).size !== selected.length) throw new Error('Map each source column to only one field.');
  if (selected.some(h => !headers.includes(h))) throw new Error('A mapped column is missing. Map the columns again.');
  if (!rows.length) throw new Error('Add at least one person below the header, or choose Start empty.');
  const value = (row: string[], field: Columns) => mapping[field] ? row[headers.indexOf(mapping[field])] : '';
  const roster = emptyRoster(organization);
  const teamIds = new Map<string, string>();
  const ids = new Set<string>();
  rows.forEach((row, i) => {
    const name = value(row, 'name');
    const suppliedId = value(row, 'id');
    const id = suppliedId || `person-${i + 1}`;
    if (!name) throw new Error(`Row ${i + 2}: name is required.`);
    if (ids.has(id)) throw new Error(`Row ${i + 2}: duplicate person ID "${id}". Give each person a unique ID.`);
    ids.add(id);
    roster.people.push({ id, name, title: value(row, 'title'), timezone: value(row, 'timezone') || null, avatarId: null, source: 'Spreadsheet import' });
    const team = value(row, 'team');
    if (team && !teamIds.has(team)) {
      const teamId = `team-${teamIds.size + 1}`;
      const index = teamIds.size; teamIds.set(team, teamId);
      roster.state.teams.push({ id: teamId, name: team, description: '', leaderId: null, orgId: 'organization', position: { x: index % 3 * 340, y: Math.floor(index / 3) * 500 }, areaIds: [] });
    }
    roster.state.assignments.push({ personId: id, teamId: teamIds.get(team) ?? null, managerId: null, regionOverride: null });
  });
  rows.forEach((row, i) => {
    const manager = value(row, 'manager');
    if (!manager) return;
    const byId = roster.people.find(p => p.id === manager);
    const byName = roster.people.filter(p => p.name === manager);
    if (!byId && byName.length > 1) throw new Error(`Row ${i + 2}: manager "${manager}" is ambiguous. Use their person ID.`);
    const found = byId ?? byName[0];
    if (!found) throw new Error(`Row ${i + 2}: manager "${manager}" is missing. Add them or leave the manager cell empty.`);
    roster.state.assignments[i].managerId = found.id;
  });
  if (rows.some(row => !value(row, 'id'))) roster.notes.push('Some IDs were generated from row numbers. Download a JSON backup to retain them. Supply stable person IDs for comparisons between imports.');
  roster.notes.push('Team membership does not assign a manager or team leader. Blank managers remain unset.');
  const result = rosterSchema.safeParse(roster);
  if (!result.success) throw new Error(result.error.issues.map(issue => {
    const [field, index, detail] = issue.path;
    return field === 'people' && typeof index === 'number'
      ? `Row ${index + 2}, ${String(detail)}: ${issue.message}`
      : `${issue.path.join('.')}: ${issue.message}`;
  }).join('\n'));
  const parsed = result.data;
  if (parsed.state.teams.length) parsed.state.unassignedPosition = { x: -360, y: 0 };
  return { ...parsed, state: validateState(parsed.state, parsed.people) };
}

export function compareRosters(previous: Roster | undefined, next: Roster) {
  const before = new Map(previous?.people.map(p => [p.id, p]) ?? []);
  const after = new Set(next.people.map(p => p.id));
  const relationships: string[] = [];
  for (const person of next.people) {
    if (!before.has(person.id)) continue;
    const old = previous!.state.assignments.find(a => a.personId === person.id)!;
    const current = next.state.assignments.find(a => a.personId === person.id)!;
    const oldTeam = previous!.state.teams.find(t => t.id === old.teamId)?.name ?? 'Unassigned';
    const newTeam = next.state.teams.find(t => t.id === current.teamId)?.name ?? 'Unassigned';
    if (oldTeam !== newTeam) relationships.push(`${person.name}: team from ${oldTeam} to ${newTeam}`);
    if (old.managerId !== current.managerId) {
      const oldManager = previous!.people.find(p => p.id === old.managerId)?.name ?? 'No manager';
      const newManager = next.people.find(p => p.id === current.managerId)?.name ?? 'No manager';
      relationships.push(`${person.name}: manager from ${oldManager} to ${newManager}`);
    }
  }
  return {
    added: next.people.filter(p => !before.has(p.id)).map(p => p.name),
    changed: next.people.filter(p => before.has(p.id) && JSON.stringify(before.get(p.id)) !== JSON.stringify(p)).map(p => p.name),
    absent: [...before.values()].filter(p => !after.has(p.id)).map(p => p.name),
    relationships,
  };
}

export function importAreas(text: string, state: PlanState): PlanState {
  const { headers, rows } = readTable(text);
  for (const header of ['name', 'description', 'owner', 'teams']) if (!headers.includes(header)) throw new Error(`Missing area column: ${header}. Use the area template.`);
  const next = structuredClone(state);
  next.areas ??= [];
  rows.forEach((row, i) => {
    const value = (key: string) => row[headers.indexOf(key)];
    const name = value('name');
    if (!name || next.areas!.some(a => a.name === name)) throw new Error(`Row ${i + 2}: area name is empty or already exists. Use a distinct name.`);
    const id = `area-import-${next.areas!.length + 1}`;
    if (next.areas!.some(a => a.id === id)) throw new Error(`Row ${i + 2}: generated area ID conflicts. Add this area manually.`);
    const area: Area = { id, name, description: value('description'), owner: value('owner'), source: 'Area spreadsheet import', notes: '', partners: [] };
    next.areas!.push(area);
    for (const teamName of value('teams').split(';').map(s => s.trim()).filter(Boolean)) {
      const teams = next.teams.filter(t => t.id === teamName || t.name === teamName);
      if (teams.length !== 1) throw new Error(`Row ${i + 2}: team "${teamName}" is missing or ambiguous. Use a team ID or create the team first.`);
      teams[0].areaIds = [...new Set([...(teams[0].areaIds ?? []), id])];
    }
  });
  if (!rows.length) throw new Error('Add at least one area below the header.');
  return next;
}
