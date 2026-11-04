import { z } from 'zod';

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().trim().min(1).max(150);
export const regions = ['Africa', 'America', 'Antarctica', 'Arctic', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Indian', 'Pacific', 'Etc', 'Unknown'] as const;
export type Region = string;
export const timezoneSchema = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Use a valid IANA timezone, for example Asia/Tokyo.').nullable();
export const pointSchema = z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict();
export const personSchema = z.object({
  id, name: text, title: z.string().max(200), timezone: timezoneSchema,
  avatarId: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  source: z.string().max(1000),
}).strict();
export const partnerSchema = personSchema.extend({
  discipline: text,
  context: z.string().max(1000),
}).strict();
export const areaSchema = z.object({
  id, name: text, description: z.string().max(2000), owner: z.string().max(1000),
  source: z.string().max(1000), notes: z.string().max(2000),
  partners: z.array(partnerSchema).max(100),
}).strict();
export const stateSchema = z.object({
  regionGroups: z.array(text).max(100).optional(),
  orgs: z.array(z.object({ id, name: text }).strict()).min(1).max(100),
  teams: z.array(z.object({
    id, name: text, description: z.string().max(2000), orgId: id,
    leaderId: id.nullable(), position: pointSchema,
    source: z.string().max(1000).optional(), areas: z.array(areaSchema).max(50).optional(),
    areaIds: z.array(id).max(500).optional(),
  }).strict()).max(500),
  areas: z.array(areaSchema).max(500).optional(),
  unassignedPosition: pointSchema.optional(),
  assignments: z.array(z.object({
    personId: id, teamId: id.nullable(), managerId: id.nullable(),
    regionOverride: text.nullable(),
  }).strict()).max(2000),
}).strict();
export const rosterSchema = z.object({
  importedAt: z.iso.datetime(), scope: text, complete: z.boolean(),
  notes: z.array(z.string().max(2000)).max(500),
  people: z.array(personSchema).max(2000),
  state: stateSchema,
}).strict();
export type Person = z.infer<typeof personSchema>;
export type Partner = z.infer<typeof partnerSchema>;
export type Area = z.infer<typeof areaSchema>;
export type PlanState = z.infer<typeof stateSchema>;
export type Roster = z.infer<typeof rosterSchema>;
export type Team = PlanState['teams'][number];
export const rosterDetailsSchema = rosterSchema.omit({ state: true });
export type RosterDetails = z.infer<typeof rosterDetailsSchema>;
export type Reference = { id: string; roster: Roster; demo: boolean };
export type Scenario = { id: string; name: string; description: string; state: PlanState; revision: number; referenceId?: string; roster?: RosterDetails };
export const viewSchema = z.object({
  mode: z.enum(['teams', 'timezones', 'reporting', 'areas']),
  viewport: pointSchema.extend({ zoom: z.number().min(0.2).max(1.5) }).strict(),
}).strict();
export type SavedView = z.infer<typeof viewSchema>;
export const defaultView: SavedView = { mode: 'teams', viewport: { x: 28, y: 28, zoom: 1 } };
export const defaultUnassignedPosition = { x: -360, y: 0 };
export type Snapshot = { id: string; name: string; description: string; createdAt: string; roster: Omit<Roster, 'state'>; state: PlanState; view: SavedView; referenceId?: string | null };
export type SnapshotSummary = Pick<Snapshot, 'id' | 'name' | 'description' | 'createdAt' | 'referenceId'>;

// Normalize on reads and writes, without rewriting immutable legacy JSON.
export function normalizeAreas(state: PlanState): PlanState {
  const catalog = new Map<string, Area>();
  for (const area of state.areas ?? []) {
    if (catalog.has(area.id)) throw new Error(`Duplicate area: ${area.id}.`);
    catalog.set(area.id, area);
  }
  const teams = state.teams.map(({ areas, areaIds = [], ...team }) => {
    if (new Set(areaIds).size !== areaIds.length) throw new Error(`Duplicate area assignment for team ${team.id}.`);
    const links = new Set(areaIds);
    for (const area of areas ?? []) {
      const existing = catalog.get(area.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(area)) {
        throw new Error(`Area ${area.id} has conflicting copies. Resolve the source records before editing; no copies were discarded.`);
      }
      catalog.set(area.id, area);
      links.add(area.id);
    }
    return { ...team, areaIds: [...links] };
  });
  if (catalog.size > 500) throw new Error('Area catalog exceeds the 500 area limit.');
  for (const team of teams) {
    if (team.areaIds.some(id => !catalog.has(id))) throw new Error(`Area assignment for team ${team.id} references a missing area.`);
  }
  return { ...state, areas: [...catalog.values()], teams };
}

export function areasForTeam(state: PlanState, team: Team): Area[] {
  return (state.areas ?? []).filter(a => team.areaIds?.includes(a.id));
}

export type AreaDetailsInput = Pick<Area, 'name' | 'description' | 'owner' | 'notes'>;
export function saveArea(state: PlanState, areaId: string, details: AreaDetailsInput, teamIds: string[]): PlanState {
  const normalized = normalizeAreas(state);
  if (teamIds.some(id => !state.teams.some(t => t.id === id))) throw new Error('Area assignment references a missing team.');
  const existing = normalized.areas!.find(a => a.id === areaId);
  const area: Area = { ...(existing ?? { id: areaId, source: 'Created in scenario.', partners: [] }), ...details };
  return {
    ...normalized,
    areas: existing ? normalized.areas!.map(a => a.id === areaId ? area : a) : [...normalized.areas!, area],
    teams: normalized.teams.map(t => ({
      ...t, areaIds: [...(t.areaIds ?? []).filter(id => id !== areaId), ...(teamIds.includes(t.id) ? [areaId] : [])],
    })),
  };
}

export function regionFor(timezone: string | null): Region {
  if (!timezone) return 'Unknown';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { return 'Unknown'; }
  return timezone.includes('/') ? timezone.split('/')[0] : 'Etc';
}

export function regionNames(state: PlanState, people: Person[]): string[] {
  return [...new Set([...(state.regionGroups ?? []), ...people.map(p =>
    state.assignments.find(a => a.personId === p.id)?.regionOverride ?? regionFor(p.timezone))])].sort();
}

export function validateState(input: unknown, people: Person[]): PlanState {
  const state = normalizeAreas(stateSchema.parse(input));
  z.array(personSchema).max(2000).parse(people);
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`);
  };
  unique(people.map(p => p.id), 'person');
  unique(state.orgs.map(o => o.id), 'organization');
  unique(state.teams.map(t => t.id), 'team');
  unique(state.assignments.map(a => a.personId), 'assignment');
  for (const area of state.areas ?? []) unique(area.partners.map(p => p.id), `collaborator in area ${area.id}`);
  const personIds = new Set(people.map(p => p.id));
  const teamIds = new Set(state.teams.map(t => t.id));
  const orgIds = new Set(state.orgs.map(o => o.id));
  if (state.assignments.length !== people.length || state.assignments.some(a => !personIds.has(a.personId))) {
    throw new Error('Every person must be retained exactly once.');
  }
  const assignments = new Map(state.assignments.map(a => [a.personId, a]));
  for (const a of state.assignments) {
    if (a.teamId !== null && !teamIds.has(a.teamId)) throw new Error('Move members before deleting their team.');
    if (a.managerId !== null && !personIds.has(a.managerId)) throw new Error('Reporting manager does not exist.');
    const visited = new Set<string>([a.personId]);
    let manager = a.managerId;
    while (manager) {
      if (visited.has(manager)) throw new Error('Reporting relationships cannot contain cycles.');
      visited.add(manager);
      manager = assignments.get(manager)?.managerId ?? null;
    }
  }
  for (const t of state.teams) {
    if (!orgIds.has(t.orgId)) throw new Error('Move teams before deleting their organization.');
    if (t.leaderId && assignments.get(t.leaderId)?.teamId !== t.id) throw new Error('Team leader must be a member of that team.');
  }
  return state;
}

export function movePerson(state: PlanState, personId: string, teamId: string | null): PlanState {
  return {
    ...state,
    assignments: state.assignments.map(a => a.personId === personId ? { ...a, teamId } : a),
    teams: state.teams.map(t => t.leaderId === personId && t.id !== teamId ? { ...t, leaderId: null } : t),
  };
}
