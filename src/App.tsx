import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowDown, ArrowRight, ArrowUp, Plus, LockKeyhole, Layers, Network, Globe2, Search, Undo2, Redo2, X, Camera, Check, Download, Users, Rows3, Trash2, Pencil } from 'lucide-react';
import { api } from './api';
import { Board, unassignedNodeId, type BoardMode, type Selection } from './Board';
import { Avatar } from './Avatar';
import { AreaDetails, AreaForm } from './Partners';
import { areasForTeam, saveArea, defaultView, defaultUnassignedPosition, movePerson, regionNames, regionFor, validateState, viewSchema, type Person, type Reference, type SavedView, type PlanState, type Roster, type Scenario, type Snapshot, type SnapshotSummary } from '../shared/model';
import { WorkspaceSetup } from './WorkspaceSetup';
import { PersonForm } from './People';
import { CollaboratorEditor } from './Partners';

type Workspace = { roster: Roster | null; references: Reference[]; scenarios: Scenario[]; snapshots: SnapshotSummary[] };
const errorText = (e: unknown) => e instanceof Error ? e.message : 'The request failed. Try again.';

function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={close} aria-labelledby="dialog-title">
    <header><h2 id="dialog-title">{title}</h2><button aria-label="Close dialog" onClick={close}><X size={18} /></button></header>{children}
  </dialog>;
}
function MetadataForm({ action, initialName = '', initialDescription = '', submit, busy }: {
  action: string; initialName?: string; initialDescription?: string; submit: (name: string, description: string) => void; busy: boolean;
}) {
  return <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(String(f.get('name')).trim(), String(f.get('description')).trim()); }}>
    <label>Name<input name="name" required maxLength={150} defaultValue={initialName} autoFocus /></label>
    <label>Description<textarea name="description" maxLength={2000} defaultValue={initialDescription} rows={3} /></label>
    <button className="primary" disabled={busy}>{busy ? 'Saving...' : action}</button>
  </form>;
}

function PositionControls({ name, position, move }: { name: string; position: { x: number; y: number }; move: (p: { x: number; y: number }) => void }) {
  return <><h3>Position on canvas</h3><div className="position-controls">
    {([[ArrowLeft, -40, 0, 'left'], [ArrowUp, 0, -40, 'up'], [ArrowDown, 0, 40, 'down'], [ArrowRight, 40, 0, 'right']] as const).map(([Icon, x, y, direction]) =>
      <button key={direction} aria-label={`Move ${name} ${direction}`} onClick={() => move({ x: position.x + x, y: position.y + y })}><Icon size={16} /></button>)}
  </div></>;
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Scenario | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [mode, setMode] = useState<BoardMode>('teams');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'scenario' | 'snapshot' | 'team' | 'org' | 'area' | 'person' | 'share' | 'removeSnapshot' | 'removeWorkspace' | 'renameScenario' | null>(null);
  const [page, setPage] = useState(window.location.pathname);
  const [importKind, setImportKind] = useState<'backup' | undefined>(new URLSearchParams(window.location.search).get('kind') === 'backup' ? 'backup' : undefined);
  const tools = page === '/import';
  const newWorkspace = page === '/new';
  const [setupBusy, setSetupBusy] = useState(false);
  const [referenceId, setReferenceId] = useState<string | undefined>();
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [snapshotToRemove, setSnapshotToRemove] = useState<Pick<SnapshotSummary, 'id' | 'name'> | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ past: Scenario[]; future: Scenario[] }>({ past: [], future: [] });
  const [retry, setRetry] = useState(0);
  const draftRef = useRef<Scenario | null>(null);
  const revision = useRef(1);
  const persisted = useRef('');
  const inFlight = useRef(false);
  const viewport = useRef<SavedView['viewport']>(defaultView.viewport);
  const snapshotId = /^\/s\/([a-f0-9-]+)$/.exec(window.location.pathname)?.[1];
  const serialize = (d: Scenario) => JSON.stringify({ name: d.name, description: d.description, state: d.state, roster: d.roster });

  useEffect(() => {
    let active = true;
    (async () => {
      if (snapshotId) {
        const data = await api<Snapshot>(`/snapshots/${snapshotId}`);
        if (active) { setSnapshot(data); setMode(data.view?.mode ?? 'teams'); viewport.current = data.view?.viewport ?? defaultView.viewport; }
      } else {
        const data = await api<Workspace>('/workspace');
        if (active) {
          setWorkspace(data);
          const params = new URLSearchParams(window.location.search);
          const requestedMode = viewSchema.shape.mode.safeParse(params.get('view'));
          if (requestedMode.success) setMode(requestedMode.data);
          const requestedReference = params.get('reference');
          const selected = data.scenarios.find(s => s.id === params.get('scenario')) ?? (requestedReference === null && !data.roster ? data.scenarios.at(-1) : undefined);
          setReferenceId(selected?.referenceId ?? (requestedReference !== null ? data.references.find(r => r.id === requestedReference)?.id : !data.roster ? data.references.at(-1)?.id : undefined));
          if (selected) {
            persisted.current = serialize(selected); revision.current = selected.revision;
            draftRef.current = selected; setDraft(selected);
          }
        }
      }
    })().catch(e => active && setError(errorText(e)));
    return () => { active = false; };
  }, [snapshotId]);

  useEffect(() => {
    if (!workspace || snapshotId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', mode);
    if (draft) url.searchParams.set('scenario', draft.id);
    else url.searchParams.delete('scenario');
    url.searchParams.set('reference', referenceId ?? '');
    window.history.replaceState(null, '', url);
  }, [workspace, snapshotId, draft?.id, referenceId, mode]);

  useEffect(() => {
    const onPopState = () => {
      if (saved !== 'saved' || setupBusy) {
        const url = new URL(window.location.href);
        url.pathname = page;
        window.history.pushState(null, '', url);
        setError('Wait for changes to save or the current import to finish before leaving this page.');
        return;
      }
      setPage(window.location.pathname);
      setImportKind(new URLSearchParams(window.location.search).get('kind') === 'backup' ? 'backup' : undefined);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [page, saved, setupBusy]);

  function navigatePage(path: '/' | '/new' | '/import', kind?: 'backup') {
    const url = new URL(window.location.href);
    url.pathname = path;
    if (kind) url.searchParams.set('kind', kind); else url.searchParams.delete('kind');
    window.history.pushState(null, '', url);
    setPage(path); setImportKind(kind); setError(''); setNotice('');
  }

  // Clear an open application view when its snapshot is removed.
  useEffect(() => {
    if (!snapshotId || !snapshot) return;
    const refresh = () => api<Snapshot>(`/snapshots/${snapshotId}`).catch(e => { setSnapshot(null); setError(errorText(e)); });
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [snapshotId, snapshot]);

  useEffect(() => {
    draftRef.current = draft;
    if (!draft || serialize(draft) === persisted.current) {
      if (!inFlight.current) setSaved('saved');
      return;
    }
    setSaved('pending');
    const timer = setTimeout(async () => {
      if (inFlight.current) return;
      inFlight.current = true; setSaved('saving');
      const submitted = draft;
      try {
        const result = await api<{ revision: number }>(`/scenarios/${draft.id}`, 'PUT', { name: draft.name, description: draft.description, state: draft.state, roster: draft.roster, revision: revision.current });
        revision.current = result.revision;
        persisted.current = serialize(submitted);
        setWorkspace(w => w && ({ ...w, scenarios: w.scenarios.map(s => s.id === submitted.id ? { ...submitted, revision: result.revision } : s) }));
        setSaved(draftRef.current && serialize(draftRef.current) !== persisted.current ? 'pending' : 'saved');
        setRetry(n => n + 1);
      } catch (e) { setSaved('error'); setError(errorText(e)); }
      finally { inFlight.current = false; }
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, retry]);

  useEffect(() => {
    if (saved === 'saved') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saved]);

  const reference = workspace?.references.find(r => r.id === (draft?.referenceId ?? referenceId));
  const baselineRoster = reference?.roster ?? workspace?.roster;
  const roster = snapshot?.roster ?? draft?.roster ?? baselineRoster;
  const state = snapshot?.state ?? draft?.state ?? baselineRoster?.state;
  const regions = state && roster ? regionNames(state, roster.people) : [];
  const readonly = !!snapshotId || !draft;
  const workspaceHasData = !!baselineRoster && (
    baselineRoster.people.length > 0 || baselineRoster.state.teams.length > 0 || (baselineRoster.state.areas?.length ?? 0) > 0 ||
    (workspace?.scenarios.some(s => s.referenceId === referenceId && ((s.roster?.people.length ?? 0) > 0 || s.state.teams.length > 0 || (s.state.areas?.length ?? 0) > 0))) ||
    workspace?.snapshots.some(s => s.referenceId === (referenceId ?? null))
  );
  const avatarBase = snapshotId ? `/api/snapshots/${snapshotId}/avatars` : '/api/avatars';
  const select = useCallback((s: Selection) => setSelection(s), []);
  const mutate = useCallback((fn: (s: PlanState) => PlanState) => {
    if (!draftRef.current || !roster || readonly) return false;
    try {
      const current = draftRef.current;
      const state = validateState(fn(structuredClone(current.state)), roster.people);
      setHistory(h => ({ past: [...h.past.slice(-99), current], future: [] }));
      const next = { ...current, state };
      draftRef.current = next;
      setDraft(next); setError(''); setSaved('pending');
      return true;
    } catch (e) { setError(errorText(e)); return false; }
  }, [roster, readonly]);
  const move = useCallback((person: string, team: string | null) => {
    mutate(s => movePerson(s, person, team));
    setNotice('Team membership updated. Reporting line unchanged. Moving a team lead clears their previous lead assignment.');
  }, [mutate]);
  const reposition = useCallback((id: string, position: { x: number; y: number }) => {
    mutate(s => id === unassignedNodeId ? { ...s, unassignedPosition: position } : { ...s, teams: s.teams.map(t => t.id === id ? { ...t, position } : t) });
  }, [mutate]);
  function choose(s: Scenario | null) {
    if (saved !== 'saved') { setError('Wait for changes to save, or resolve the save error before switching views.'); return; }
    revision.current = s?.revision ?? 1; persisted.current = s ? serialize(s) : '';
    if (s) setReferenceId(s.referenceId);
    draftRef.current = s; setDraft(s); setSelection(null); setHistory({ past: [], future: [] });
  }
  async function refresh(next?: Scenario) {
    const data = await api<Workspace>('/workspace'); setWorkspace(data);
    const selected = next ?? data.scenarios.at(-1);
    if (selected) {
      revision.current = selected.revision; persisted.current = serialize(selected);
      draftRef.current = selected; setDraft(selected); setReferenceId(selected.referenceId);
    } else {
      revision.current = 1; persisted.current = ''; draftRef.current = null; setDraft(null);
      setReferenceId(data.references.at(-1)?.id);
    }
    setSaved('saved'); setSelection(null); setHistory({ past: [], future: [] }); navigatePage('/');
    setPeopleOpen(false); setSearch('');
  }
  function startWorkspace() {
    if (saved !== 'saved' || busy || setupBusy) return;
    navigatePage('/new');
  }
  async function removeWorkspace() {
    if (saved !== 'saved' || !baselineRoster) return;
    await run(async () => {
      await api('/workspaces', 'DELETE', { referenceId: referenceId ?? null, confirmed: true });
      setDialog(null); setShareId(null); setSnapshotToRemove(null);
      await refresh();
      setNotice('Workspace deleted.');
    });
  }
  function editPerson(person: Person) {
    const current = draftRef.current;
    if (!current || !roster) return false;
    try {
      const exists = roster.people.some(p => p.id === person.id);
      if (!exists && current.state.assignments.some(a => a.personId === person.id)) throw new Error('Duplicate person ID.');
      const people = exists ? roster.people.map(p => p.id === person.id ? person : p) : [...roster.people, person];
      const state = validateState({ ...current.state, assignments: exists ? current.state.assignments : [...current.state.assignments, { personId: person.id, teamId: null, managerId: null, regionOverride: null }] }, people);
      const next = { ...current, state, roster: { importedAt: roster.importedAt, scope: roster.scope, complete: roster.complete, notes: roster.notes, people } };
      setHistory(h => ({ past: [...h.past.slice(-99), current], future: [] }));
      draftRef.current = next; setDraft(next); setSaved('pending'); setError('');
      setSelection({ kind: 'person', id: person.id }); return true;
    } catch (e) { setError(errorText(e)); return false; }
  }
  function undo() {
    if (!draft || !history.past.length) return;
    const previous = history.past.at(-1)!;
    setHistory({ past: history.past.slice(0, -1), future: [draft, ...history.future] });
    draftRef.current = previous; setDraft(previous); setSaved('pending');
  }
  function redo() {
    if (!draft || !history.future.length) return;
    const next = history.future[0];
    setHistory({ past: [...history.past, draft], future: history.future.slice(1) });
    draftRef.current = next; setDraft(next); setSaved('pending');
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function createScenario(name: string, description: string) {
    if (!state) return;
    await run(async () => {
      const details = roster && { importedAt: roster.importedAt, scope: roster.scope, complete: roster.complete, notes: roster.notes, people: roster.people };
      const next = await api<Scenario>('/scenarios', 'POST', { name, description, state, roster: details, referenceId: draft?.referenceId ?? referenceId });
      setWorkspace(w => w && ({ ...w, scenarios: [...w.scenarios, next] }));
      persisted.current = serialize(next); revision.current = next.revision;
      draftRef.current = next; setDraft(next); setSaved('saved'); setHistory({ past: [], future: [] }); setDialog(null);
    });
  }
  function updateScenarioDetails(name: string, description: string) {
    const current = draftRef.current;
    if (!current || readonly) return;
    setHistory(h => ({ past: [...h.past.slice(-99), current], future: [] }));
    const next = { ...current, name, description };
    draftRef.current = next; setDraft(next); setSaved('pending'); setError('');
  }
  async function publish(name: string, description: string) {
    if (!draft || saved !== 'saved') return;
    await run(async () => {
      const snap = await api<Snapshot>('/snapshots', 'POST', { name, description, scenarioId: draft.id, revision: revision.current, view: { mode, viewport: viewport.current } });
      setWorkspace(w => w && ({ ...w, snapshots: [snap, ...w.snapshots] }));
      setShareId(snap.id); setDialog('share');
    });
  }
  function sharing(id: string) {
    setShareId(id); setDialog('share');
  }
  function openPage(event: MouseEvent<HTMLAnchorElement>, destination = 'a snapshot') {
    if (saved !== 'saved' || setupBusy) {
      event.preventDefault();
      setError(setupBusy ? 'Wait for the current import or setup to finish before leaving this page.' : `Wait for changes to save, or resolve the save error before opening ${destination}.`);
    }
  }
  async function downloadSnapshot(id: string, format: 'html' | 'pdf') {
    await run(async () => {
      const response = await fetch(`/api/snapshots/${id}/${format}`, { cache: 'no-store' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Snapshot export failed. Try again.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = `snapshot-${id}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`${format.toUpperCase()} exported.`);
    });
  }
  async function downloadCsv(format: 'roster' | 'areas') {
    if (saved !== 'saved' || busy) return;
    await run(async () => {
      const params = new URLSearchParams({ referenceId: referenceId ?? '', format });
      if (draft) { params.set('scenarioId', draft.id); params.set('revision', String(revision.current)); }
      const response = await fetch(`/api/workspaces/export?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Export failed. Try again.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = `${format}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`${format === 'roster' ? 'Roster' : 'Areas'} exported.`);
    });
  }
  function confirmSnapshotRemoval(s: Pick<SnapshotSummary, 'id' | 'name'>) {
    setSnapshotToRemove(s); setError(''); setDialog('removeSnapshot');
  }
  async function removeSnapshot() {
    if (!snapshotToRemove) return;
    const id = snapshotToRemove.id;
    await run(async () => {
      await api(`/snapshots/${id}`, 'DELETE');
      setWorkspace(w => w && ({ ...w, snapshots: w.snapshots.filter(s => s.id !== id) }));
      setSnapshotToRemove(null); setShareId(null); setDialog(null);
      setNotice('Snapshot removed from the app. Exported files remain available.');
      if (snapshotId === id) window.location.assign('/');
    });
  }
  const person = roster?.people.find(p => selection?.kind === 'person' && p.id === selection.id);
  const assignment = state?.assignments.find(a => a.personId === person?.id);
  const team = state?.teams.find(t => selection?.kind === 'team' && t.id === selection.id);
  const unassigned = selection?.kind === 'unassigned';
  const area = state?.areas?.find(a => selection?.kind === 'area' && a.id === selection.id);
  const matches = search && roster?.people.filter(p => `${p.name} ${p.title}`.toLowerCase().includes(search.toLowerCase()));

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><a className="brand-home" href="/" aria-label="Org planner home" onClick={e => openPage(e, 'the planner homepage')}><span className="brand-mark"><Network size={20} /></span><strong>Org planner</strong></a></div>
      {!snapshotId && workspace && <div className="header-actions">
        <button disabled={saved !== 'saved' || busy || setupBusy} onClick={() => navigatePage('/import')}>Import</button>
        <button disabled={saved !== 'saved' || busy || setupBusy || newWorkspace || !roster && !tools} onClick={startWorkspace}><Plus size={16} />New Workspace</button>
      </div>}
    </header>
    {reference?.demo && !newWorkspace && !tools && <div className="demo-notice">Fictional example. Changes are saved separately from your own organization. <button disabled={saved !== 'saved'} onClick={startWorkspace}>Create your own workspace</button></div>}
    {error && <div className="error-banner" role="alert"><span>{error}</span>{saved === 'error' && <><button onClick={() => { setError(''); setRetry(n => n + 1); }}>Retry save</button><button onClick={() => setDialog('scenario')}>Save separate scenario</button></>}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
    {!snapshotId && workspace && (tools || newWorkspace || !roster) ? <WorkspaceSetup key={`${page}-${importKind ?? ''}`} page={tools ? 'import' : 'welcome'} initialKind={tools ? importKind : undefined} openImport={kind => navigatePage('/import', kind)} ready={refresh} onBusyChange={setSetupBusy} cancel={roster || tools ? () => navigatePage('/') : undefined} referenceId={referenceId} roster={roster ?? undefined} scenarioId={draft?.id} revision={revision.current} /> : !state || !roster ? <main className="empty-page">
      <Layers size={32} /><h1>{error ? 'Workspace unavailable' : 'Loading workspace'}</h1>
      <p>{error ? 'Reload to try again.' : 'Retrieving local planning data...'}</p>
      <button onClick={() => window.location.reload()}>Reload</button>
    </main> : <div className="workspace">
      <aside className="sidebar" aria-label="Planning views">
        {!snapshotId && workspace && workspace.references.length + Number(!!workspace.roster) > 1 && <label>My Workspaces<select aria-label="My Workspaces" value={referenceId ?? ''} disabled={saved !== 'saved' || busy} onChange={e => {
          const id = e.target.value || undefined;
          choose(workspace.scenarios.findLast(s => s.referenceId === id) ?? null); setReferenceId(id);
          setPeopleOpen(false); setSearch(''); setNotice(''); setError('');
        }}>
          {workspace.roster && <option value="">Original reference</option>}
          {workspace.references.map(r => <option key={r.id} value={r.id}>{r.demo ? 'Example: ' : ''}{r.roster.scope} · {new Date(r.roster.importedAt).toLocaleString()}</option>)}
        </select></label>}
        <div className="sidebar-heading"><h2>Planning views</h2>{!snapshotId && <button aria-label="New scenario" onClick={() => setDialog('scenario')}><Plus size={17} /></button>}</div>
        {snapshotId ? <><div className="view-link active"><LockKeyhole size={16} /><span>{snapshot?.name}</span></div><p className="small">Read-only snapshot<br />{snapshot && new Date(snapshot.createdAt).toLocaleString()}</p><button className="danger" disabled={busy || !snapshot} onClick={() => snapshot && confirmSnapshotRemoval(snapshot)}><Trash2 size={14} />Remove snapshot</button></> : <>
          <button className={`view-link ${!draft ? 'active' : ''}`} onClick={() => choose(null)}><LockKeyhole size={16} /><span>Current baseline</span></button>
          <h3>Scenarios</h3>
          {workspace?.scenarios.filter(s => s.referenceId === referenceId).map(s => <button key={s.id} className={`view-link ${draft?.id === s.id ? 'active' : ''}`} onClick={() => choose(s)}><Layers size={16} /><span>{s.name}</span></button>)}
          {!workspace?.scenarios.length && <p className="small">Create a scenario to try changes without editing the baseline.</p>}
          <button className="subtle" onClick={() => setDialog('scenario')}><Plus size={15} /> New scenario</button>
          <h3>Saved snapshots</h3>
          {workspace?.snapshots.filter(s => s.referenceId === (referenceId ?? null) || s.referenceId === undefined).map(s => <div className="snapshot-link" key={s.id}><a href={`/s/${s.id}`} onClick={openPage}><Camera size={15} /><span>{s.name}{s.referenceId === undefined && <small>Unassigned workspace</small>}</span></a><button aria-label={`Export ${s.name}`} onClick={() => sharing(s.id)}><Download size={14} /></button><button className="danger" aria-label={`Remove snapshot ${s.name}`} disabled={busy} onClick={() => confirmSnapshotRemoval(s)}><Trash2 size={14} /></button></div>)}
          {!workspace?.snapshots.some(s => s.referenceId === (referenceId ?? null) || s.referenceId === undefined) && <p className="small">Read-only views with standalone HTML copies saved in your local data directory.</p>}
          <button className="danger workspace-delete" disabled={saved !== 'saved' || busy} onClick={() => { setError(''); setDialog('removeWorkspace'); }}><Trash2 size={14} />Delete workspace</button>
        </>}
        <div className="source-info"><strong>{roster.scope}</strong><span>{roster.people.length} people · {state.teams.length} teams</span><span>Imported {new Date(roster.importedAt).toLocaleDateString()}</span><span className={roster.complete ? '' : 'warning'}>{roster.complete ? 'Reference retained' : 'Partial import · review source notes'}</span></div>
      </aside>
      <main className="main-workspace">
        <div className="workspace-title"><div>{snapshotId && <a href="/" className="planner-back-link" onClick={e => openPage(e, 'the planner homepage')}><span aria-hidden="true">←</span>Back to Org planner</a>}<div className="scenario-heading"><h1>{snapshot?.name ?? draft?.name ?? 'Current baseline'}{readonly && <LockKeyhole size={16} aria-label="Read only" />}</h1>{!readonly && draft && <button aria-label="Rename scenario" title="Rename scenario" disabled={busy} onClick={() => setDialog('renameScenario')}><Pencil size={15} /></button>}</div><p>{snapshot?.description ?? draft?.description ?? 'Reference organization. Create a scenario to explore changes.'}</p></div>
          {!snapshotId && <div className="title-actions"><span className={`save-status ${saved}`} role="status">{saved === 'saved' ? <Check size={14} /> : null}{draft ? ({ saved: 'Saved', pending: 'Unsaved changes', saving: 'Saving...', error: 'Save failed' }[saved]) : 'Read only'}</span>
            {draft ? <button className="primary" disabled={saved !== 'saved' || busy} onClick={() => setDialog('snapshot')}><Camera size={16} /> Save snapshot</button> : <button className="primary" onClick={() => setDialog('scenario')}><Plus size={16} /> Create scenario</button>}</div>}
          {snapshotId && snapshot && <div className="title-actions"><button disabled={busy} onClick={() => downloadSnapshot(snapshotId, 'html')}><Download size={16} />Download HTML</button><button disabled={busy} onClick={() => downloadSnapshot(snapshotId, 'pdf')}><Download size={16} />{busy ? 'Preparing export...' : 'Export PDF'}</button></div>}
        </div>
        <div className="toolbar">
          <button aria-pressed={peopleOpen} onClick={() => setPeopleOpen(!peopleOpen)}>People</button>
          <div className="segmented" aria-label="Canvas view">{([['teams', Users, 'Teams'], ['timezones', Globe2, 'Timezones'], ['reporting', Network, 'Reporting lines'], ['areas', Rows3, 'Areas']] as const).map(([value, Icon, label]) =>
            <button key={value} aria-pressed={!peopleOpen && mode === value} onClick={() => { setPeopleOpen(false); setMode(value); }}><Icon size={15} />{label}</button>)}</div>
          <div className="search-field"><Search size={15} /><input aria-label="Search people" placeholder="Find a person..." value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="toolbar-end"><button aria-label="Undo" disabled={readonly || !history.past.length} onClick={undo}><Undo2 size={17} /></button><button aria-label="Redo" disabled={readonly || !history.future.length} onClick={redo}><Redo2 size={17} /></button><button disabled={readonly} onClick={() => setDialog('person')}><Plus size={16} />Person</button>{mode === 'areas' && <button disabled={readonly} onClick={() => setDialog('area')}><Plus size={16} />New area</button>}<button disabled={readonly} onClick={() => setDialog('team')}><Plus size={16} />Team</button><button disabled={readonly} onClick={() => setDialog('org')}><Plus size={16} />Org</button></div>
        </div>
        {!roster.people.length && <div className="empty-roster"><p>No people yet. Add a person, then choose their team and manager in Details.</p><button disabled={readonly} onClick={() => setDialog('person')}>Add first person</button></div>}
        {matches && <div className="search-results" role="region" aria-label="Search results">{matches.length ? matches.map(p => <button key={p.id} onClick={() => select({ kind: 'person', id: p.id })}>{p.name}</button>) : <span>No people match this search.</span>}</div>}
        {peopleOpen ? <section className="people-view"><div className="section-heading"><h2>People</h2>{!snapshotId && <button disabled={saved !== 'saved' || busy} onClick={() => downloadCsv('roster')}><Download size={16} aria-hidden="true" />Export roster</button>}</div><p className="small">Select a person to edit their profile, membership or manager. People added to a scenario leave its reference and previous snapshots unchanged.</p>{roster.people.length ? roster.people.filter(p => !search || `${p.name} ${p.title}`.toLowerCase().includes(search.toLowerCase())).map(p => <button key={p.id} onClick={() => select({ kind: 'person', id: p.id })}><Avatar person={p} base={avatarBase} /><span>{p.name}<small>{p.title || 'Role not set'}</small></span></button>) : <p>No people yet. Use + Person or import a roster.</p>}</section> : <Board state={state} people={roster.people} readonly={readonly} selection={selection} select={select} move={move} reposition={reposition} mode={mode} search={search} avatarBase={avatarBase} initialView={snapshot?.view} onViewport={v => { viewport.current = v; }} exportAreas={snapshotId ? undefined : () => downloadCsv('areas')} exportDisabled={saved !== 'saved' || busy} />}
        <div className="sr-only" aria-live="polite">{notice}</div>
      </main>
      <aside className="inspector" aria-label="Details">
        <div className="sidebar-heading"><h2>{person ? 'Person details' : team ? 'Team details' : area ? 'Area details' : unassigned ? 'Unassigned' : 'Overview'}</h2>{selection && <button aria-label="Close details" onClick={() => setSelection(null)}><X size={16} /></button>}</div>
        {area ? <>
          {!readonly ? <>
            <p className="small">Changes apply to this area in every assigned team. Source and partner profiles are retained.</p>
            <AreaForm key={JSON.stringify([area, state.teams.map(t => [t.id, t.areaIds])])} area={area} state={state} action="Apply area details" submit={(details, teamIds) => {
              if (mutate(s => saveArea(s, area.id, details, teamIds))) setNotice('Area details and team assignments updated.');
            }} />
          </> : <><h3>Assigned teams</h3><p className="small">{state.teams.filter(t => t.areaIds?.includes(area.id)).map(t => t.name).join(', ') || 'Unassigned'}</p></>}
          <AreaDetails area={area} base={avatarBase} />
          {!readonly && <CollaboratorEditor area={area} save={partners => mutate(s => ({ ...s, areas: s.areas?.map(a => a.id === area.id ? { ...a, partners } : a) }))} />}
        </> : person && assignment ? <>
          <div className="profile"><Avatar person={person} base={avatarBase} /><h3>{person.name}</h3><p>{person.title}</p></div>
          {!readonly && <details><summary>Edit person profile</summary><PersonForm key={JSON.stringify(person)} person={person} action="Apply person details" submit={editPerson} /></details>}
          <label>Move to team<select aria-label="Move to team" disabled={readonly} value={assignment.teamId ?? ''} onChange={e => move(person.id, e.target.value || null)}><option value="">Unassigned</option>{state.teams.map(t => <option key={t.id} value={t.id}>{t.name} · {state.orgs.find(o => o.id === t.orgId)?.name}</option>)}</select></label>
          <label>Reports to<select disabled={readonly} value={assignment.managerId ?? ''} onChange={e => mutate(s => ({ ...s, assignments: s.assignments.map(a => a.personId === person.id ? { ...a, managerId: e.target.value || null } : a) }))}><option value="">No manager in scope</option>{roster.people.filter(p => p.id !== person.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <p className="small">Moving teams does not change reporting. Team leadership is a separate assignment.</p>
          <h3>Timezone</h3><p className="timezone">{person.timezone ?? 'Not verified'}</p>
          <label>Regional category<select disabled={readonly} value={assignment.regionOverride ?? ''} onChange={e => mutate(s => ({ ...s, assignments: s.assignments.map(a => a.personId === person.id ? { ...a, regionOverride: (e.target.value || null) as typeof a.regionOverride } : a) }))}><option value="">From timezone ({regionFor(person.timezone)})</option>{regions.map(r => <option key={r}>{r}</option>)}</select></label>
          <p className="small">Categories use the profile timezone, not nationality or inferred location.</p>
          {!readonly && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const group = String(f.get('group')).trim(); if (group) mutate(s => ({ ...s, regionGroups: [...new Set([...(s.regionGroups ?? []), group])], assignments: s.assignments.map(a => a.personId === person.id ? { ...a, regionOverride: group } : a) })); }}><label>New regional group<input name="group" maxLength={150} required placeholder="For example, Service hours A" /></label><button>Create group and assign</button></form>}
          <details><summary>Source</summary><p className="small">{person.source}</p></details>
        </> : unassigned ? <>
          <p className="small">People without a team stay here. Select a person and use Move to team, or drag them onto a team.</p>
          {!readonly && <PositionControls name="Unassigned pod" position={state.unassignedPosition ?? defaultUnassignedPosition} move={p => reposition(unassignedNodeId, p)} />}
        </> : team ? <>
          <form key={team.id + draft?.id} onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            mutate(s => ({ ...s, teams: s.teams.map(t => t.id === team.id ? { ...t, name: String(f.get('name')), description: String(f.get('description')) } : t) }));
          }}>
            <label>Team name<input name="name" required maxLength={150} defaultValue={team.name} disabled={readonly} key={team.name} /></label>
            <label>Area of responsibility<textarea name="description" maxLength={2000} defaultValue={team.description} disabled={readonly} key={team.description} rows={4} /></label>
            {!readonly && <button type="submit">Apply team details</button>}
          </form>
          <label>Organization<select disabled={readonly} value={team.orgId} onChange={e => mutate(s => ({ ...s, teams: s.teams.map(t => t.id === team.id ? { ...t, orgId: e.target.value } : t) }))}>{state.orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Team leader<select disabled={readonly} value={team.leaderId ?? ''} onChange={e => mutate(s => ({ ...s, teams: s.teams.map(t => t.id === team.id ? { ...t, leaderId: e.target.value || null } : t) }))}><option value="">No leader designated</option>{roster.people.filter(p => state.assignments.some(a => a.personId === p.id && a.teamId === team.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {team.source && <p className="small">{team.source}</p>}
          <h3>Areas and partners</h3><p className="small">Partnerships are separate from team membership and reporting.</p>
          <button onClick={() => { setPeopleOpen(false); setMode('areas'); setSelection(null); }}>Manage areas</button>
          {areasForTeam(state, team).map(area => <div key={area.id}><AreaDetails area={area} base={avatarBase} /><button onClick={() => setSelection({ kind: 'area', id: area.id })}>{readonly ? 'View' : 'Edit'} area {area.name}</button></div>)}
          {!readonly && <><PositionControls name="team" position={team.position} move={p => reposition(team.id, p)} />
            <details className="danger-zone"><summary>Remove team</summary><p className="small">Choose where all members go. No person or reporting relationship will be deleted.</p><form onSubmit={e => {
              e.preventDefault(); const destination = String(new FormData(e.currentTarget).get('destination'));
              if (!window.confirm(`Remove ${team.name} and move all members to ${destination ? state.teams.find(t => t.id === destination)?.name : 'Unassigned'}?`)) return;
              mutate(s => ({ ...s, teams: s.teams.filter(t => t.id !== team.id), assignments: s.assignments.map(a => a.teamId === team.id ? { ...a, teamId: destination || null } : a) }));
              setSelection(null); setNotice('Team removed. All people and reporting lines retained.');
            }}><label>Move all members to<select name="destination"><option value="">Unassigned</option>{state.teams.filter(t => t.id !== team.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button className="danger">Remove team and move members</button></form></details></>}
        </> : <>
          {!snapshotId && !draft && workspaceHasData && <details className="workspace-export">
            <summary><Download size={14} aria-hidden="true" /> Export</summary>
            <div className="workspace-export-options">
              <a href={`/api/workspaces/export?${new URLSearchParams({ referenceId: referenceId ?? '', format: 'workspace' })}`} download="planner.json"
                onClick={e => { if (saved !== 'saved' || busy) e.preventDefault(); }}>All Workspace</a>
            </div>
            <p className="small">All Workspace includes this reference, its scenarios, associated snapshots and photos. Export CSVs from People or Areas in the workspace.</p>
          </details>}
          <p className="small">Select a person or team to inspect details{readonly ? '.' : ', move members, or edit responsibilities.'}</p>
          <h3>Regional distribution</h3>
          <div className="region-list">{regions.map(r => <div key={r}><span>{r}</span><strong>{roster.people.filter(p => (state.assignments.find(a => a.personId === p.id)?.regionOverride ?? regionFor(p.timezone)) === r).length}</strong></div>)}</div>
          <h3>Organizations</h3>{state.orgs.map(o => <div className="org-row" key={o.id}><span>{o.name}</span><span>{state.teams.filter(t => t.orgId === o.id).length} teams</span></div>)}
          <details open={!roster.complete}><summary>Import notes</summary>{roster.notes.map((note, i) => <p className="small" key={i}>{note}</p>)}</details>
          {!readonly && draft && <details><summary>Scenario details</summary><MetadataForm key={draft.name + draft.description} action="Apply scenario details" initialName={draft.name} initialDescription={draft.description} busy={false} submit={updateScenarioDetails} /></details>}
        </>}
      </aside>
    </div>}
    {dialog && <Dialog title={{ scenario: 'Create scenario', snapshot: 'Save immutable snapshot', team: 'Create team', org: 'Create organization', area: 'Create area', person: 'Add person', share: 'Snapshot exports', removeSnapshot: 'Remove snapshot', removeWorkspace: 'Delete workspace', renameScenario: 'Rename scenario' }[dialog]} close={() => !busy && setDialog(null)}>
      {dialog === 'removeWorkspace' && baselineRoster && <>
        <p>Permanently delete <strong>{baselineRoster.scope}</strong>, its scenarios and its saved snapshots? This cannot be undone.</p>
        <p className="small">Their snapshot links and app-generated HTML files will be removed. Other workspaces and unassigned snapshots stay unchanged. Copies you downloaded or shared cannot be deleted by the app.</p>
        <div className="snapshot-removal-actions"><button disabled={busy} onClick={() => setDialog(null)} autoFocus>Cancel</button><button className="danger" disabled={busy || saved !== 'saved'} onClick={removeWorkspace}>{busy ? 'Deleting...' : 'Delete workspace'}</button></div>
      </>}
      {dialog === 'person' && !readonly && <PersonForm action="Add person" submit={person => {
        if (roster?.people.some(p => p.id === person.id)) { setError('Duplicate person ID. Use a unique ID.'); return false; }
        if (editPerson(person)) { setDialog(null); return true; } return false;
      }} />}
      {dialog === 'renameScenario' && draft && !readonly && <MetadataForm action="Rename scenario" initialName={draft.name} initialDescription={draft.description} busy={busy} submit={(name, description) => {
        updateScenarioDetails(name, description); setDialog(null);
      }} />}
      {dialog === 'removeSnapshot' && snapshotToRemove && <>
        <p>Permanently remove <strong>{snapshotToRemove.name}</strong>? Its link will stop working for everyone. This cannot be undone.</p>
        <p className="small">Your scenarios, reference and other snapshots stay unchanged. Exported HTML and PDF copies remain readable.</p>
        <div className="snapshot-removal-actions"><button disabled={busy} onClick={() => setDialog(null)} autoFocus>Cancel</button><button className="danger" disabled={busy} onClick={removeSnapshot}>{busy ? 'Removing...' : 'Remove snapshot'}</button></div>
      </>}
      {dialog === 'area' && state && !readonly && <AreaForm state={state} action="Create area" submit={(details, teamIds) => {
        const id = crypto.randomUUID();
        if (mutate(s => saveArea(s, id, details, teamIds))) { setDialog(null); setSelection({ kind: 'area', id }); setNotice('Area created.'); }
      }} />}
      {dialog === 'scenario' && <><p>Start from the view currently on your canvas. The baseline stays unchanged.</p><MetadataForm action="Create scenario" busy={busy || saved === 'pending' || saved === 'saving'} submit={createScenario} /></>}
      {dialog === 'snapshot' && <><p>This freezes the saved scenario, roster and photos, and saves a standalone HTML file in your local data directory. Anyone with the file can open it without signing in.</p><MetadataForm action="Save snapshot" initialName={draft?.name} busy={busy} submit={publish} /></>}
      {dialog === 'team' && <MetadataForm action="Create team" busy={false} submit={(name, description) => {
        const id = crypto.randomUUID(); mutate(s => ({ ...s, teams: [...s.teams, { id, name, description, leaderId: null, orgId: s.orgs[0].id, position: { x: 80 + s.teams.length % 3 * 340, y: 100 + Math.floor(s.teams.length / 3) * 420 } }] }));
        setDialog(null); setSelection({ kind: 'team', id });
      }} />}
      {dialog === 'org' && <form onSubmit={e => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name')); mutate(s => ({ ...s, orgs: [...s.orgs, { id: crypto.randomUUID(), name }] })); setDialog(null); }}><label>Organization name<input name="name" required maxLength={150} autoFocus /></label><p className="small">Use a team's Organization control to move it here.</p><button className="primary">Create organization</button></form>}
      {dialog === 'share' && shareId && <>
        <p>A standalone HTML copy is saved in your local data directory's exports folder. It includes photos and works offline without signing in.</p>
        <label>Snapshot URL<input readOnly value={`${window.location.origin}/s/${shareId}`} onFocus={e => e.target.select()} /></label>
        <p className="warning">This URL works only on this computer. Share the exported HTML or PDF file instead.</p>
        <a href={`/s/${shareId}`} onClick={openPage}>Open read-only snapshot</a>
        <div className="export-downloads"><button disabled={busy} onClick={() => downloadSnapshot(shareId, 'html')}><Download size={16} />Download HTML</button><button disabled={busy} onClick={() => downloadSnapshot(shareId, 'pdf')}><Download size={16} />{busy ? 'Preparing export...' : 'Export PDF'}</button></div>
        <p className="small">These files contain names, photos and reporting lines. Anyone with a copy can read it. Removing the snapshot does not revoke exported copies. Keep exports out of source control.</p>
      </>}
      {error && <p role="alert" className="dialog-error">{error}</p>}
    </Dialog>}
  </div>;
}
