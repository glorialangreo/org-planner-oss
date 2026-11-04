import { useEffect, useRef, useState } from 'react';
import { Users, Rows3, FolderInput } from 'lucide-react';
import { api } from './api';
import { readTable, suggestMapping, type Columns, type Mapping } from '../shared/import';
import { type PlanState, type Roster, type Scenario } from '../shared/model';

type Preview = {
  previewId: string; roster?: Roster;
  comparison?: { added: string[]; changed: string[]; absent: string[]; relationships: string[] };
  backup?: { references: number; scenarios: number; snapshots: number };
  areas?: { state: PlanState; previousAreaIds: string[]; scenarioName: string; createsScenario: boolean };
};
const labels: Record<Columns, string> = { name: 'Name (required)', id: 'Person ID', team: 'Team', manager: 'Manager ID or exact name', title: 'Role', timezone: 'IANA timezone' };
export function WorkspaceSetup({ ready, cancel, referenceId, roster, scenarioId, revision, onBusyChange, page, openImport, initialKind }: {
  ready: (scenario?: Scenario) => Promise<void>; cancel?: () => void; referenceId?: string;
  roster?: Omit<Roster, 'state'>; scenarioId?: string; revision?: number;
  onBusyChange?: (busy: boolean) => void;
  page: 'welcome' | 'import'; openImport: (kind?: 'backup') => void; initialKind?: 'backup';
}) {
  const [mode, setMode] = useState<'welcome' | 'empty' | 'import'>(page);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'roster' | 'backup' | 'areas' | null>(initialKind ?? null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileInputKey, setFileInputKey] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>({ name: '', id: '', team: '', manager: '', title: '', timezone: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pageRef = useRef<HTMLElement>(null);
  const importRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const mountedRef = useRef(true);
  const busyChangeRef = useRef(onBusyChange);
  busyChangeRef.current = onBusyChange;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; busyChangeRef.current?.(false); };
  }, []);
  useEffect(() => { pageRef.current?.scrollTo({ top: 0 }); }, [mode]);
  useEffect(() => {
    if (kind) { importRef.current?.scrollIntoView({ block: 'start' }); importRef.current?.focus({ preventScroll: true }); }
  }, [kind]);
  useEffect(() => {
    if (preview) { previewRef.current?.scrollIntoView({ block: 'start' }); previewRef.current?.focus({ preventScroll: true }); }
  }, [preview]);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'center' }); }, [error]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); busyChangeRef.current?.(true);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'The operation failed. Try again.'); }
    finally { if (mountedRef.current) { setBusy(false); busyChangeRef.current?.(false); } }
  }
  const invalidate = () => setPreview(null);
  function resetImport(nextKind: typeof kind) {
    setKind(nextKind); setText(''); setFileName(''); setHeaders([]); setError(''); invalidate();
    setFileInputKey(key => key + 1);
  }
  function parseColumns() {
    setError(''); invalidate();
    try { const table = readTable(text); setHeaders(table.headers); setMapping(suggestMapping(table.headers)); }
    catch (e) { setHeaders([]); setError(e instanceof Error ? e.message : 'Invalid spreadsheet.'); }
  }
  return <main className="setup-page" ref={pageRef}>
    {(cancel || mode !== 'welcome') && <a className="planner-back-link" href="/" aria-disabled={busy || undefined} tabIndex={busy ? -1 : undefined} onClick={e => {
      e.preventDefault();
      if (busy) return;
      if (cancel) cancel(); else { setMode('welcome'); setError(''); }
    }}><span aria-hidden="true">←</span>Back to Org planner</a>}
    <header><h1>{mode === 'import' ? 'Import' : mode === 'empty' ? 'Start empty' : 'New Workspace'}</h1></header>
    <p>{mode === 'import' ? 'Choose what to import. Download a template or upload your own file, then review it before confirming.' : 'Keep a reference roster, then try changes in a scenario. Your records stay on this computer.'}</p>
    {error && <p className="form-error" role="alert" ref={errorRef}>{error}</p>}
    {mode === 'welcome' && <div className="setup-options">
      <section><h2>Try an example</h2><p>Explore fictional people, teams and responsibilities. Your own workspace will be separate.</p><button disabled={busy} onClick={() => run(async () => ready(await api<Scenario>('/setup', 'POST', { mode: 'example', name: 'Example cooperative' })))}>Try an example</button></section>
      <section><h2>Import your organization</h2><p>Upload planner.json, a roster or areas. Review a preview before confirming.</p><button className="primary" disabled={busy} onClick={() => openImport()}>Import your organization</button></section>
      <section><h2>Start empty</h2><p>Name your organization and add people and teams in the planner.</p><button disabled={busy} onClick={() => setMode('empty')}>Start empty</button></section>
    </div>}
    {mode === 'empty' && <form onSubmit={e => { e.preventDefault(); void run(async () => ready(await api<Scenario>('/setup', 'POST', { mode: 'empty', name }))); }}>
      <label>Organization name<input value={name} onChange={e => setName(e.target.value)} disabled={busy} required maxLength={150} autoFocus /></label>
      <p className="small">This creates an empty reference and an editable plan. Existing workspaces stay unchanged.</p>
      <div className="form-actions"><button className="primary" disabled={busy}>{busy ? 'Creating...' : 'Create workspace'}</button></div>
    </form>}
    {mode === 'import' && <>
      <div className="setup-options import-options">
        {([
          ['roster', Users, 'Roster', 'People, team membership and reporting lines from a CSV or spreadsheet.', 'roster.csv', 'roster-template.csv', 'Download roster template'],
          ['areas', Rows3, 'Areas', 'Responsibilities, owners and team assignments from a CSV or spreadsheet.', 'areas.csv', 'areas-template.csv', 'Download area template'],
          ['backup', FolderInput, 'Workspace', 'A planner.json file containing saved planning data from another session.', 'planner.json', 'planner.json', 'Download workspace template'],
        ] as const).map(([value, Icon, title, description, path, filename, downloadLabel]) => <section key={value} className={kind === value ? 'selected' : undefined}>
          <h2><Icon size={20} aria-hidden="true" />{title}</h2><p>{description}</p>
          <button disabled={busy} aria-pressed={kind === value} onClick={() => resetImport(value)}>Import {title}</button>
          <a className="download-link" href={`/api/templates/${path}`} download={filename}>{downloadLabel}</a>
        </section>)}
      </div>
      {kind && <section className="import-form" ref={importRef} tabIndex={-1} aria-label={`Import ${kind === 'backup' ? 'Workspace' : kind === 'roster' ? 'Roster' : 'Areas'}`}>
      {kind === 'backup' && <section className="restore-help"><h2>Restore a planner backup</h2><p>Upload planner.json from another session, an All Workspace export, or a full JSON backup from this edition. Review its contents, then confirm the restore.</p><p className="small">The file is read by this app on your computer, with no external upload. Existing work stays unchanged.</p></section>}
      {kind === 'roster' && <label>Organization name<input value={name} disabled={busy} maxLength={150} onChange={e => { setName(e.target.value); invalidate(); }} /></label>}
      {kind === 'areas' && <>
        <p>Areas describe responsibilities and can belong to several teams. Separate team names or IDs with semicolons.</p>
        <p className="small">{!roster ? 'Create an empty workspace or import a roster first, then use Import to add areas. Team assignments require existing teams.' :
          scenarioId ? 'Areas will be added to the current saved scenario. Existing areas stay unchanged.' :
          'Areas will be added to a new scenario based on Current baseline. The baseline stays unchanged.'}</p>
      </>}
      <label>Upload {kind === 'backup' ? 'JSON backup' : 'CSV or TSV'}<input key={fileInputKey} type="file" disabled={busy || kind === 'areas' && !roster} accept={kind === 'backup' ? '.json,application/json' : '.csv,.tsv,text/csv,text/tab-separated-values'} onChange={e => {
        const file = e.target.files?.[0]; if (!file) return;
        setText(''); setFileName(''); setHeaders([]); invalidate();
        void run(async () => {
          if (file.size > (kind === 'backup' ? 10_000_000 : 2_000_000)) throw new Error('File is too large. Spreadsheet limit: 2 MB. Backup limit: 10 MB.');
          const contents = await file.text();
          if (!contents.trim()) throw new Error('This file is empty. Choose a complete planner backup or spreadsheet.');
          setText(contents); setFileName(file.name);
        });
      }} /></label>
      {fileName && <p className="file-summary" role="status"><strong>{fileName}</strong> is ready to preview. Nothing has been imported yet.</p>}
      {kind !== 'backup' ? <label>Or paste spreadsheet cells, including headers<textarea rows={7} value={text} disabled={busy || kind === 'areas' && !roster} onChange={e => { setText(e.target.value); setFileName(''); setHeaders([]); invalidate(); }} /></label> :
        <details className="backup-paste"><summary>Paste backup JSON instead (advanced)</summary><label>Backup JSON<textarea rows={7} value={text} disabled={busy} onChange={e => { setText(e.target.value); setFileName(''); invalidate(); }} /></label></details>}
      {kind === 'roster' && <>
        <p className="small">Teams describe membership. Managers define reporting lines. Blank manager cells stay unset. IDs are recommended for reliable comparisons. Photos can be uploaded later.</p>
        <button onClick={parseColumns} disabled={!text || busy}>Map columns</button>
        {!!headers.length && <fieldset className="column-mapping" disabled={busy}><legend>Column mapping</legend>{(Object.keys(labels) as Columns[]).map(field => <label key={field}>{labels[field]}<select value={mapping[field]} onChange={e => { setMapping({ ...mapping, [field]: e.target.value }); invalidate(); }}><option value="">Not included</option>{headers.map(h => <option key={h}>{h}</option>)}</select></label>)}</fieldset>}
      </>}
      <button className="primary" disabled={busy || !text || kind === 'roster' && (!name.trim() || !headers.length) || kind === 'areas' && !roster} onClick={() => run(async () => {
        invalidate();
        setPreview(await api<Preview>('/imports/preview', 'POST', { kind, text, organization: name.trim() || roster?.scope || 'Restored backup', referenceId,
          ...(kind === 'roster' ? { mapping } : kind === 'areas' ? { scenarioId, revision } : {}) }));
      })}>{busy ? 'Checking...' : 'Preview import'}</button>
      {preview && <section className="import-preview" aria-label="Import preview" ref={previewRef} tabIndex={-1}><h2>Review before importing</h2>
        {preview.roster && <>
          <p>{preview.roster.people.length} people and {preview.roster.state.teams.length} teams will be added to a new reference.</p>
          {preview.roster.notes.map(note => <p className="small" key={note}>{note}</p>)}
          <div className="table-scroll"><table><caption>Roster preview</caption><thead><tr><th>Name / ID</th><th>Team</th><th>Manager</th><th>Role</th><th>Timezone</th></tr></thead><tbody>{preview.roster.people.map(p => {
            const a = preview.roster!.state.assignments.find(a => a.personId === p.id)!;
            return <tr key={p.id}><td>{p.name}<small>{p.id}</small></td><td>{preview.roster!.state.teams.find(t => t.id === a.teamId)?.name ?? 'Unassigned'}</td><td>{preview.roster!.people.find(p => p.id === a.managerId)?.name ?? 'No manager'}</td><td>{p.title || 'Unset'}</td><td>{p.timezone ?? 'Unset'}</td></tr>;
          })}</tbody></table></div>
          {roster && preview.comparison && <div><h3>Compared with the selected reference, by person ID</h3><p>Added: {preview.comparison.added.join(', ') || 'None'}</p><p>Profile changes: {preview.comparison.changed.join(', ') || 'None'}</p><p>Absent from this import: {preview.comparison.absent.join(', ') || 'None'}</p><h3>Team and reporting changes</h3>{preview.comparison.relationships.length ? preview.comparison.relationships.map((change, i) => <p key={i}>{change}</p>) : <p>None for matching person IDs.</p>}</div>}
          <p className="warning">This creates a separate reference and editable scenario. No existing people, scenarios or snapshots will be changed or deleted. Compare reporting and team membership in the preview.</p>
        </>}
        {preview.backup && <><p>Restore copies of {preview.backup.references} references, {preview.backup.scenarios} scenarios and {preview.backup.snapshots} snapshots.</p><p className="warning">Copies receive new IDs and snapshot links. Existing work remains unchanged. This restores planner data, including any photos in the backup.</p></>}
        {preview.areas && <>
          <h3>New areas</h3>
          {preview.areas.state.areas?.filter(a => !preview.areas!.previousAreaIds.includes(a.id)).map(a => <p key={a.id}>{a.name}: {a.description} · Owner: {a.owner || 'Unset'} · Teams: {preview.areas!.state.teams.filter(t => t.areaIds?.includes(a.id)).map(t => t.name).join(', ') || 'Unassigned'}</p>)}
          <p className="warning">{preview.areas.createsScenario ? `Create "${preview.areas.scenarioName}" with these areas. Current baseline stays unchanged.` : `Add these areas to "${preview.areas.scenarioName}". Existing areas and snapshots stay unchanged.`}</p>
        </>}
        <button className="primary" disabled={busy} onClick={() => run(async () => {
          const result = await api<{ scenario?: Scenario }>('/imports/confirm', 'POST', { previewId: preview.previewId, confirmed: true });
          await ready(result.scenario);
        })}>{preview.backup ? 'Confirm restore copies' : preview.areas ? preview.areas.createsScenario ? 'Confirm new scenario with areas' : 'Confirm areas' : 'Confirm new reference'}</button>
      </section>}
      </section>}
    </>}
    {mode === 'welcome' && <section className="workspace-backups"><h2>Backup and restore</h2><p>A full backup contains all workspaces, including every reference, scenario, snapshot and photo. Store it securely. Restoring adds copies without overwriting existing work.</p><p className="small">To export only the selected workspace, use Export in Current baseline's Overview panel.</p><a className="download-link" href="/api/backup" download>Download JSON backup</a>
      <button disabled={busy} onClick={() => openImport('backup')}>Restore a backup</button>
    </section>}
  </main>;
}
