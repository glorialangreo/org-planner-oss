import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import sharp from 'sharp';
import { join } from 'node:path';
import { baseline, hash, validateDocument, StorageConflict, StorageSyncError, type DB } from './db.js';
import { defaultView, viewSchema, rosterDetailsSchema, validateState, type Snapshot, type Roster, type Scenario } from '../shared/model.js';
import { emptyRoster, importRoster, importAreas, compareRosters } from '../shared/import.js';
import { exampleRoster } from '../shared/example.js';
import { parsePlannerBackup } from './backup.js';
import { AvatarImportError, downloadAvatar, normalizeAvatar } from './avatars.js';
import { templateRouter } from './templates.js';
import { workspaceBackup, rosterCsv, areasCsv } from './workspace-export.js';
import { localOrigin, type Config } from './config.js';
import { ensureSnapshotExport, readSnapshotExport, removeFailedExport, snapshotPdf } from './snapshots.js';

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const metadata = z.object({ name: z.string().trim().min(1).max(150), description: z.string().trim().max(2000) }).strict();

export function createApp(db: DB, config: Config) {
  const app = express();
  const origin = localOrigin(config.origin);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (req.get('Host') !== origin.host || !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress ?? '') ||
        req.get('Sec-Fetch-Site') === 'cross-site' || (req.get('Origin') && req.get('Origin') !== origin.origin)) {
      return res.status(403).json({ error: 'This workspace accepts same-origin, local-only requests.' });
    }
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'"],
      frameAncestors: ["'none'"], formAction: ["'self'"], upgradeInsecureRequests: null,
    } },
    referrerPolicy: { policy: 'no-referrer' }, hsts: false,
  }));
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store, private'); next(); });
  app.use(express.json({ limit: '12mb' }));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (req.get('Origin') !== config.origin || req.get('X-Org-Planner') !== 'local')) {
      return next(new HttpError(403, 'Request verification failed. Reload and try again.'));
    }
    next();
  }, rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/api/templates', templateRouter);
  const snapshotFor = (id: string): Snapshot => {
    const snapshot = db.getSnapshot(id);
    if (!snapshot) throw new HttpError(404, 'Snapshot unavailable. It may have been removed.');
    return { ...snapshot, view: snapshot.view ?? defaultView, state: validateState(snapshot.state, snapshot.roster.people) };
  };
  app.get('/api/snapshots/:id', (req, res) => res.json(snapshotFor(req.params.id)));
  app.get('/api/snapshots/:id/avatars/:avatarId', (req, res) => {
    const snapshot = snapshotFor(req.params.id);
    const allowed = snapshot.roster.people.some(p => p.avatarId === req.params.avatarId) ||
      snapshot.state.areas?.some(a => a.partners.some(p => p.avatarId === req.params.avatarId));
    if (!allowed) throw new HttpError(404, 'Avatar unavailable.');
    sendAvatar(req.params.avatarId, res);
  });
  function sendAvatar(id: string, res: Response) {
    const row = db.getAvatar(id);
    if (!row) throw new HttpError(404, 'Avatar unavailable.');
    res.type(row.mime).send(Buffer.from(row.bytes));
  }
  app.get('/api/avatars/:id', (req, res) => sendAvatar(req.params.id, res));
  app.post('/api/avatars', async (req, res) => {
    const data = z.union([
      z.object({ base64: z.string().max(4_000_000) }).strict(),
      z.object({ url: z.string().trim().min(1).max(2048) }).strict(),
    ]).parse(req.body);
    let bytes: Buffer;
    try {
      const input = 'url' in data ? await downloadAvatar(data.url) : Buffer.from(data.base64, 'base64');
      if ('base64' in data && input.toString('base64') !== data.base64) throw new AvatarImportError('Invalid photo encoding. Choose another image.');
      bytes = await normalizeAvatar(input);
    } catch (error) {
      if (error instanceof AvatarImportError) throw new HttpError(400, error.message);
      throw error;
    }
    const id = hash(bytes);
    db.addAvatar({ id, mime: 'image/webp', bytes });
    res.status(201).json({ id });
  });
  const referenceRoster = (id?: string) => id ? db.getReference(id)?.roster : baseline(db);
  function addImport(roster: Roster, demo: boolean) {
    const referenceId = randomUUID();
    const { state, ...details } = roster;
    const scenario = { id: randomUUID(), name: `${roster.scope} plan`, description: '', state, roster: details, referenceId, revision: 1 };
    db.transaction(() => { db.addReference({ id: referenceId, roster, demo }); db.createScenario(scenario); });
    return scenario;
  }
  app.post('/api/setup', (req, res) => {
    const data = z.object({ mode: z.enum(['empty', 'example']), name: z.string().trim().min(1).max(150) }).strict().parse(req.body);
    res.status(201).json(addImport(data.mode === 'example' ? exampleRoster() : emptyRoster(data.name), data.mode === 'example'));
  });
  type ImportPreview = { expires: number; roster?: Roster; backup?: ReturnType<typeof validateDocument>;
    areas?: { scenario: Scenario; existing: boolean; previousAreaIds: string[] } };
  const previews = new Map<string, ImportPreview>();
  app.post('/api/imports/preview', async (req, res) => {
    const data = z.object({
      kind: z.enum(['roster', 'backup', 'areas']), text: z.string().max(10_000_000),
      organization: z.string().trim().min(1).max(150),
      referenceId: z.string().optional(),
      scenarioId: z.string().optional(), revision: z.number().int().positive().optional(),
      mapping: z.object({ name: z.string(), id: z.string(), team: z.string(), manager: z.string(), title: z.string(), timezone: z.string() }).optional(),
    }).strict().parse(req.body);
    let item: ImportPreview;
    try {
      if (data.kind === 'backup') {
        const backup = parsePlannerBackup(data.text);
        for (const avatar of backup.avatars) {
          const bytes = Buffer.from(avatar.base64, 'base64');
          const info = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata();
          if (!['png', 'jpeg', 'webp'].includes(info.format ?? '') || bytes.length > 3_000_000) throw new Error('Backup contains an unsupported image.');
        }
        item = { expires: Date.now() + 600_000, backup };
      } else if (data.kind === 'areas') {
        const existing = data.scenarioId ? db.getScenario(data.scenarioId) : undefined;
        if (data.scenarioId && (!existing || existing.revision !== data.revision || existing.referenceId !== data.referenceId)) {
          throw new HttpError(409, 'This scenario changed. Reload the saved scenario and preview the areas again.');
        }
        const reference = referenceRoster(data.referenceId);
        if (!reference) throw new Error('Create an empty workspace or import a roster before importing areas.');
        const { state: referenceState, ...details } = reference;
        const roster = existing?.roster ?? details;
        const state = validateState(existing?.state ?? referenceState, roster.people);
        const scenario: Scenario = { id: randomUUID(), name: `${reference.scope} areas`.slice(0, 150), description: '',
          referenceId: data.referenceId, revision: 1, roster, ...existing,
          state: validateState(importAreas(data.text, state), roster.people) };
        item = { expires: Date.now() + 600_000, areas: {
          scenario, existing: !!existing, previousAreaIds: (state.areas ?? []).map(a => a.id),
        } };
      } else {
        if (!data.mapping) throw new Error('Map the spreadsheet columns first.');
        item = { expires: Date.now() + 600_000, roster: importRoster(data.text, data.mapping, data.organization) };
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, e instanceof z.ZodError ? e.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : e instanceof Error ? e.message : 'Invalid import.');
    }
    for (const [id, preview] of previews) if (preview.expires < Date.now()) previews.delete(id);
    if (previews.size >= 20) previews.delete(previews.keys().next().value!);
    const previewId = randomUUID(); previews.set(previewId, item);
    res.json({ previewId, roster: item.roster, areas: item.areas ? {
      state: item.areas.scenario.state, previousAreaIds: item.areas.previousAreaIds,
      scenarioName: item.areas.scenario.name, createsScenario: !item.areas.existing,
    } : undefined,
      comparison: item.roster ? compareRosters(referenceRoster(data.referenceId) ?? undefined, item.roster) : undefined,
      backup: item.backup ? { references: item.backup.references.length + Number(!!item.backup.baseline), scenarios: item.backup.scenarios.length, snapshots: item.backup.snapshots.length } : undefined });
  });
  app.post('/api/imports/confirm', (req, res) => {
    const { previewId, confirmed } = z.object({ previewId: z.string(), confirmed: z.literal(true) }).strict().parse(req.body);
    const preview = previews.get(previewId);
    if (!confirmed || !preview || preview.expires < Date.now()) throw new HttpError(409, 'Preview expired. Preview the import again before confirming.');
    if (preview.areas) {
      const { scenario, existing } = preview.areas;
      if (!referenceRoster(scenario.referenceId)) throw new HttpError(409, 'Workspace unavailable. Preview the import again.');
      if (existing) {
        if (!db.updateScenario(scenario.id, scenario.revision, scenario)) throw new HttpError(409, 'This scenario changed after the preview. Preview the areas again before confirming.');
        scenario.revision++;
      } else db.createScenario(scenario);
      previews.delete(previewId);
      res.status(201).json({ scenario });
    } else if (preview.backup) { db.restoreAdditive(preview.backup); previews.delete(previewId); res.status(201).json({ restored: true }); }
    else { const scenario = addImport(preview.roster!, false); previews.delete(previewId); res.status(201).json({ scenario }); }
  });
  app.get('/api/backup', (_req, res) => res.attachment('planner-backup.json').json(db.backup()));
  app.get('/api/workspaces/export', (req, res) => {
    const data = z.object({ referenceId: z.string(), format: z.enum(['workspace', 'roster', 'areas']),
      scenarioId: z.string().min(1).optional(), revision: z.coerce.number().int().positive().optional(),
    }).strict().parse(req.query);
    const referenceId = data.referenceId || undefined;
    let roster = referenceRoster(referenceId);
    if (!roster) throw new HttpError(404, 'Workspace unavailable. It may have been deleted.');
    if (data.scenarioId) {
      if (data.format === 'workspace') throw new HttpError(400, 'Workspace JSON includes all its scenarios. Choose a CSV format to export one scenario.');
      const scenario = db.getScenario(data.scenarioId);
      if (!scenario || scenario.referenceId !== referenceId) throw new HttpError(404, 'Scenario unavailable in this workspace.');
      if (data.revision !== scenario.revision) throw new HttpError(409, 'This scenario changed. Reload before exporting its current data.');
      roster = { ...(scenario.roster ?? roster), state: scenario.state };
    }
    if (data.format === 'workspace') res.attachment('planner.json').json(workspaceBackup(db.backup(), referenceId ?? null));
    else res.attachment(`${data.format}.csv`).type('text/csv').send(data.format === 'roster' ? rosterCsv(roster) : areasCsv(roster));
  });
  app.delete('/api/workspaces', (req, res) => {
    const { referenceId } = z.object({ referenceId: z.string().min(1).nullable(), confirmed: z.literal(true) }).strict().parse(req.body);
    db.transaction(() => {
      const ids = db.deleteWorkspace(referenceId);
      if (!ids) throw new HttpError(404, 'Workspace unavailable. It may have already been deleted.');
      for (const id of ids) removeFailedExport(config, id);
    });
    previews.clear();
    res.sendStatus(204);
  });
  app.get('/api/workspace', (_req, res) => {
    const roster = baseline(db);
    const scenarios = db.listScenarios().map(r => ({ ...r, state: validateState(r.state, r.roster?.people ?? referenceRoster(r.referenceId)?.people ?? []) }));
    const snapshots = db.listSnapshots().reverse().map(({ id, name, description, createdAt, referenceId }) => ({ id, name, description, createdAt, referenceId }));
    res.json({ roster, references: db.listReferences(), scenarios, snapshots });
  });
  app.post('/api/scenarios', (req, res) => {
    const data = metadata.extend({ state: z.unknown(), referenceId: z.string().optional(), roster: rosterDetailsSchema.optional() }).parse(req.body);
    const roster = referenceRoster(data.referenceId);
    if (!roster) throw new HttpError(409, 'Import a baseline before creating a scenario.');
    const state = validateState(data.state, data.roster?.people ?? roster.people);
    const id = randomUUID();
    const scenario = { ...data, id, state, revision: 1 };
    db.createScenario(scenario);
    res.status(201).json(scenario);
  });
  app.put('/api/scenarios/:id', (req, res) => {
    const data = metadata.extend({ state: z.unknown(), revision: z.number().int().positive(), roster: rosterDetailsSchema.optional() }).parse(req.body);
    const previous = db.getScenario(req.params.id);
    const roster = previous && referenceRoster(previous.referenceId);
    if (!roster) throw new HttpError(409, 'Baseline unavailable.');
    const people = data.roster?.people ?? previous?.roster?.people ?? roster.people;
    const state = validateState(data.state, people);
    const updated = db.updateScenario(req.params.id, data.revision, { name: data.name, description: data.description, state, roster: data.roster ?? previous?.roster });
    if (!updated) throw new HttpError(409, 'This scenario changed in another window. Your edits are still here. Save a separate scenario or reload.');
    res.json({ revision: data.revision + 1 });
  });
  app.post('/api/snapshots', (req, res) => {
    const data = metadata.extend({ scenarioId: z.string(), revision: z.number().int().positive(), view: viewSchema.default(defaultView) }).parse(req.body);
    const row = db.getScenario(data.scenarioId);
    const roster = row && referenceRoster(row.referenceId);
    if (!row || !roster || row.revision !== data.revision) throw new HttpError(409, 'Save the latest scenario before creating a snapshot.');
    const { state: _baselineState, ...referenceDetails } = roster;
    const snapshotRoster = row.roster ?? referenceDetails;
    const snapshot: Snapshot = { id: randomUUID(), name: data.name, description: data.description,
      createdAt: new Date().toISOString(), state: validateState(row.state, snapshotRoster.people), roster: snapshotRoster, view: data.view, referenceId: row.referenceId ?? null };
    let exported = false;
    try {
      db.transaction(() => {
        db.createSnapshot(snapshot);
        exported = ensureSnapshotExport(db, config, snapshot);
      });
    } catch (error) {
      if (exported && !db.getSnapshot(snapshot.id)) removeFailedExport(config, snapshot.id);
      throw error;
    }
    res.status(201).json(snapshot);
  });
  app.delete('/api/snapshots/:id', (req, res) => {
    if (!db.deleteSnapshot(req.params.id)) throw new HttpError(404, 'Snapshot unavailable. It may have already been removed.');
    res.sendStatus(204);
  });
  app.get('/api/snapshots/:id/html', (req, res) => {
    const snapshot = snapshotFor(req.params.id);
    ensureSnapshotExport(db, config, snapshot);
    res.attachment(`snapshot-${snapshot.id}.html`).type('html').send(readSnapshotExport(config, snapshot.id));
  });
  let printing = false;
  app.get('/api/snapshots/:id/pdf', async (req, res) => {
    const snapshot = snapshotFor(req.params.id);
    if (printing) throw new HttpError(429, 'A PDF is being prepared. Wait for it to finish and try again.');
    printing = true;
    try {
      ensureSnapshotExport(db, config, snapshot);
      const pdf = await snapshotPdf(readSnapshotExport(config, snapshot.id));
      res.attachment(`snapshot-${snapshot.id}.pdf`).type('pdf').send(pdf);
    } catch {
      throw new HttpError(503, 'PDF export failed. Verify Chromium is installed with npx playwright install chromium, then retry. Very large layouts may need teams moved closer together in a new snapshot.');
    } finally { printing = false; }
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'This operation is unavailable.')));
  app.use('/assets', express.static(join(config.distPath, 'assets'), { cacheControl: false, etag: false, dotfiles: 'deny' }));
  app.get('/s/:id', (req, res) => {
    snapshotFor(req.params.id);
    res.sendFile(join(config.distPath, 'index.html'));
  });
  app.get(['/', '/import', '/new'], (_req, res) => res.sendFile(join(config.distPath, 'index.html')));
  app.use((_req, _res, next) => next(new HttpError(404, 'Page unavailable.')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof StorageConflict || err instanceof StorageSyncError) {
      res.status(err instanceof StorageConflict ? 409 : 503).json({ error: err.message });
      return;
    }
    const status = err instanceof HttpError ? err.status : err instanceof z.ZodError || err instanceof Error && [
      'Every person', 'Duplicate ', 'Move members', 'Reporting ', 'Move teams', 'Team leader', 'Area ', 'Referenced avatar',
    ].some(s => err.message.startsWith(s)) ? 400 : 500;
    const message = err instanceof HttpError ? err.message : status === 400 ? err instanceof z.ZodError ? 'Invalid input. Check required fields and limits.' : (err as Error).message : 'The server could not complete the request. Your changes have not been saved.';
    if (status === 500) console.error('Request failed with an internal error. No request or personnel data logged.');
    res.status(status).json({ error: message });
  });
  return app;
}
