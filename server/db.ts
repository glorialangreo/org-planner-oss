import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rosterSchema, rosterDetailsSchema, stateSchema, viewSchema, validateState, type Reference, type Roster, type Scenario, type Snapshot } from '../shared/model.js';

export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const details = { id: identifier, name: z.string().min(1).max(150), description: z.string().max(2000) };
const snapshotSchema = z.object({
  ...details, createdAt: z.iso.datetime(), roster: rosterSchema.omit({ state: true }),
  state: stateSchema, view: viewSchema.optional(), referenceId: identifier.nullable().optional(),
}).strict();
const avatarSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), mime: z.enum(['image/webp', 'image/png', 'image/jpeg']),
  base64: z.string().min(1).refine(value => Buffer.from(value, 'base64').toString('base64') === value, 'Invalid photo encoding'),
}).strict();
const documentSchema = z.object({
  formatVersion: z.literal(1), baseline: rosterSchema.nullable(),
  references: z.array(z.object({ id: identifier, roster: rosterSchema, demo: z.boolean() }).strict()).default([]),
  scenarios: z.array(z.object({ ...details, state: stateSchema, revision: z.number().int().positive(),
    referenceId: identifier.optional(), roster: rosterDetailsSchema.optional() }).strict()),
  snapshots: z.array(snapshotSchema), avatars: z.array(avatarSchema),
}).strict();
export type StoreDocument = z.infer<typeof documentSchema>;
type Avatar = { id: string; mime: string; bytes: Uint8Array };
export class StorageConflict extends Error {}
export class StorageSyncError extends Error {}

export function validateDocument(input: unknown): StoreDocument {
  const data = documentSchema.parse(input);
  for (const items of [data.references, data.scenarios, data.snapshots, data.avatars]) {
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate stored IDs.');
  }
  if (!data.baseline && !data.references.length && data.scenarios.length) throw new Error('Stored scenarios require a baseline.');
  if (data.baseline) validateState(data.baseline.state, data.baseline.people);
  for (const reference of data.references) validateState(reference.roster.state, reference.roster.people);
  for (const s of data.scenarios) {
    const reference = s.referenceId ? data.references.find(r => r.id === s.referenceId)?.roster : data.baseline;
    if (!reference) throw new Error('Scenario reference is unavailable.');
    validateState(s.state, s.roster?.people ?? reference.people);
  }
  for (const s of data.snapshots) {
    if (s.referenceId === null && !data.baseline || typeof s.referenceId === 'string' && !data.references.some(r => r.id === s.referenceId)) {
      throw new Error('Snapshot reference is unavailable.');
    }
    validateState(s.state, s.roster.people);
  }
  const avatars = new Set(data.avatars.map(a => a.id));
  const views = [
    ...(data.baseline ? [data.baseline] : []),
    ...data.references.map(r => r.roster),
    ...data.scenarios.map(s => ({ people: s.roster?.people ?? (s.referenceId ? data.references.find(r => r.id === s.referenceId)!.roster.people : data.baseline!.people), state: s.state })),
    ...data.snapshots.map(s => ({ people: s.roster.people, state: s.state })),
  ];
  for (const view of views) {
    const state = validateState(view.state, view.people);
    for (const person of [...view.people, ...(state.areas ?? []).flatMap(a => a.partners)]) {
      if (person.avatarId && !avatars.has(person.avatarId)) throw new Error('Referenced avatar was not imported.');
    }
  }
  return data;
}

// One atomic document keeps scenario revisions, snapshots and photos in the same commit.
export class JsonStore {
  private data: StoreDocument;
  private pending: StoreDocument | null = null;
  private contents: string | null = null;
  private closed = false;
  private lock: string | null = null;
  private path: string | null;

  constructor(path: string) {
    this.path = path === ':memory:' ? null : resolve(path);
    this.data = { formatVersion: 1, baseline: null, references: [], scenarios: [], snapshots: [], avatars: [] };
    if (!this.path) return;
    if (!this.path.endsWith('.json')) throw new Error('JSON storage requires a .json file.');
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const lock = `${this.path}.lock`;
    try {
      writeFileSync(lock, `${process.pid}\n`, { flag: 'wx', mode: 0o600, flush: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`JSON storage is locked: ${lock}. Stop the other planner process. After a crash, verify the PID in the lock is no longer running before removing that lock file.`);
      }
      throw error;
    }
    this.lock = lock;
    try {
      if (existsSync(this.path)) {
        this.contents = readFileSync(this.path, 'utf8');
        try { this.data = validateDocument(JSON.parse(this.contents)); }
        catch { throw new Error('Invalid planner JSON. Restore a valid backup or repair the file while the app is stopped. Existing data was not overwritten.'); }
      } else {
        this.persist(this.data);
      }
    } catch (error) { this.close(); throw error; }
  }

  private current() {
    if (this.closed) throw new Error('JSON storage is closed.');
    return this.pending ?? this.data;
  }
  private persist(next: StoreDocument) {
    if (!this.path) return;
    const disk = existsSync(this.path) ? readFileSync(this.path, 'utf8') : null;
    if (disk !== this.contents) throw new StorageConflict('Planner JSON changed outside the app. Your edits have not been saved. Restart the app before continuing.');
    const contents = `${JSON.stringify(next, null, 2)}\n`;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    let renamed = false;
    try {
      writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600, flush: true });
      renameSync(temporary, this.path);
      renamed = true;
      this.contents = contents;
      // Keep memory consistent even if directory syncing fails after the rename.
      this.data = next;
      try {
        const directory = openSync(dirname(this.path), 'r');
        try { fsyncSync(directory); } finally { closeSync(directory); }
      } catch {
        throw new StorageSyncError('The JSON file was replaced, but disk synchronization failed. Reload to check the saved state before making more changes.');
      }
    } finally {
      if (!renamed && existsSync(temporary)) unlinkSync(temporary);
    }
  }
  transaction<T>(action: () => T): T {
    this.current();
    if (this.pending) throw new Error('Nested storage transactions are not supported.');
    this.pending = structuredClone(this.data);
    try {
      const result = action();
      if (result instanceof Promise) throw new Error('Storage transactions must be synchronous.');
      const next = validateDocument(this.pending);
      this.persist(next);
      this.data = next;
      return result;
    } finally { this.pending = null; }
  }
  private change<T>(action: (data: StoreDocument) => T): T {
    if (this.pending) return action(this.pending);
    return this.transaction(() => action(this.current()));
  }
  getBaseline() { return structuredClone(this.current().baseline); }
  listReferences() { return structuredClone(this.current().references); }
  getReference(id: string) { return structuredClone(this.current().references.find(r => r.id === id)); }
  addReference(reference: Reference) {
    this.change(data => {
      if (data.references.some(r => r.id === reference.id)) throw new Error('Reference is immutable.');
      data.references.push(structuredClone(reference));
    });
  }
  backup() { return structuredClone(this.current()); }
  deleteWorkspace(referenceId: string | null) {
    if (referenceId === null ? !this.getBaseline() : !this.getReference(referenceId)) return undefined;
    const snapshotIds = this.listSnapshots().filter(s => s.referenceId === referenceId).map(s => s.id);
    const referencedPhotos = (data: StoreDocument) => {
      const views = [
        ...(data.baseline ? [data.baseline] : []),
        ...data.references.map(r => r.roster),
        ...data.scenarios.map(s => ({ people: s.roster?.people ?? [], state: s.state })),
        ...data.snapshots.map(s => ({ people: s.roster.people, state: s.state })),
      ];
      return new Set(views.flatMap(view => [
        ...view.people, ...(view.state.areas ?? []).flatMap(a => a.partners),
        ...view.state.teams.flatMap(t => (t.areas ?? []).flatMap(a => a.partners)),
      ]).flatMap(person => person.avatarId ? [person.avatarId] : []));
    };
    this.change(data => {
      const before = referencedPhotos(data);
      if (referenceId === null) data.baseline = null;
      else data.references = data.references.filter(r => r.id !== referenceId);
      data.scenarios = data.scenarios.filter(s => (s.referenceId ?? null) !== referenceId);
      data.snapshots = data.snapshots.filter(s => !snapshotIds.includes(s.id));
      const used = referencedPhotos(data);
      // Unreferenced uploads may belong to a person form still being saved in another window.
      data.avatars = data.avatars.filter(a => !before.has(a.id) || used.has(a.id));
    });
    return snapshotIds;
  }
  restoreAdditive(input: unknown) {
    const incoming = validateDocument(input);
    this.transaction(() => {
      for (const avatar of incoming.avatars) this.addAvatar({ ...avatar, bytes: Buffer.from(avatar.base64, 'base64') });
      const ids = new Map<string | null, string>();
      if (incoming.baseline) {
        const id = randomUUID(); ids.set(null, id);
        this.addReference({ id, roster: incoming.baseline, demo: false });
      }
      for (const ref of incoming.references) {
        const id = randomUUID(); ids.set(ref.id, id); this.addReference({ ...ref, id });
      }
      for (const s of incoming.scenarios) this.createScenario({ ...s, id: randomUUID(), referenceId: ids.get(s.referenceId ?? null) });
      for (const s of incoming.snapshots) this.createSnapshot({ ...s, id: randomUUID(),
        referenceId: s.referenceId !== undefined ? ids.get(s.referenceId) : ids.size === 1 ? [...ids.values()][0] : undefined,
        view: s.view ?? { mode: 'teams', viewport: { x: 28, y: 28, zoom: 1 } } });
    });
  }
  importBaseline(input: unknown) {
    this.change(data => {
      if (data.baseline) throw new Error('A baseline already exists. Use a new data directory for a new reference import.');
      const roster = rosterSchema.parse(input);
      validateState(roster.state, roster.people);
      for (const p of roster.people) {
        if (p.avatarId && !data.avatars.some(a => a.id === p.avatarId)) throw new Error('Referenced avatar was not imported.');
      }
      data.baseline = roster;
    });
  }
  listScenarios() { return structuredClone(this.current().scenarios); }
  getScenario(id: string) { return structuredClone(this.current().scenarios.find(s => s.id === id)); }
  createScenario(scenario: Scenario) {
    this.change(data => {
      if (data.scenarios.some(s => s.id === scenario.id)) throw new Error('Duplicate scenario.');
      data.scenarios.push(structuredClone(scenario));
    });
  }
  updateScenario(id: string, revision: number, patch: Pick<Scenario, 'name' | 'description' | 'state' | 'roster'>) {
    if (this.getScenario(id)?.revision !== revision) return false;
    this.change(data => {
      const index = data.scenarios.findIndex(s => s.id === id);
      data.scenarios[index] = { ...data.scenarios[index], ...structuredClone(patch), id, revision: revision + 1 };
    });
    return true;
  }
  listSnapshots() { return structuredClone(this.current().snapshots); }
  getSnapshot(id: string) { return structuredClone(this.current().snapshots.find(s => s.id === id)); }
  createSnapshot(snapshot: Snapshot) {
    this.change(data => {
      if (data.snapshots.some(s => s.id === snapshot.id)) throw new Error('Snapshot is immutable.');
      data.snapshots.push(structuredClone(snapshot));
    });
  }
  deleteSnapshot(id: string) {
    if (!this.getSnapshot(id)) return false;
    this.change(data => { data.snapshots = data.snapshots.filter(s => s.id !== id); });
    return true;
  }
  getAvatar(id: string): Avatar | undefined {
    const avatar = this.current().avatars.find(a => a.id === id);
    return avatar && { id, mime: avatar.mime, bytes: Buffer.from(avatar.base64, 'base64') };
  }
  addAvatar(avatar: Avatar) {
    this.change(data => {
      const existing = data.avatars.find(a => a.id === avatar.id);
      const next = avatarSchema.parse({ id: avatar.id, mime: avatar.mime, base64: Buffer.from(avatar.bytes).toString('base64') });
      if (existing) {
        if (existing.mime !== next.mime || existing.base64 !== next.base64) throw new Error('Avatar is immutable.');
        return;
      }
      data.avatars.push(next);
    });
  }
  close() {
    this.closed = true;
    if (this.lock) { unlinkSync(this.lock); this.lock = null; }
  }
}
export const openDatabase = (path: string) => new JsonStore(path);
export type DB = JsonStore;
export function baseline(db: DB): Roster | null {
  const roster = db.getBaseline();
  return roster && { ...roster, state: validateState(roster.state, roster.people) };
}
export function importBaseline(db: DB, input: unknown) { db.importBaseline(input); }
