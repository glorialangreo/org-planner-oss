import { useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Board, type BoardMode, type Selection } from './Board';
import { EmbeddedAvatars } from './Avatar';
import { AreaDetails } from './Partners';
import { areasForTeam, regionNames, type Snapshot } from '../shared/model';
import '@xyflow/react/dist/style.css';
import './style.css';
import './snapshot-export.css';

const ignore = () => {};
function Export({ snapshot, avatars }: { snapshot: Snapshot; avatars: Record<string, string> }) {
  const [mode, setMode] = useState<BoardMode>(snapshot.view.mode);
  const [selection, select] = useState<Selection>(null);
  const person = snapshot.roster.people.find(p => selection?.kind === 'person' && p.id === selection.id);
  const assignment = snapshot.state.assignments.find(a => a.personId === person?.id);
  const team = snapshot.state.teams.find(t => selection?.kind === 'team' && t.id === selection.id);
  const area = snapshot.state.areas?.find(a => selection?.kind === 'area' && a.id === selection.id);
  let details: ReactNode = null;
  if (person) details = <><h2>{person.name}</h2><p>{person.title}</p><p>{person.timezone ?? 'Timezone not verified'}</p><p>Reports to: {snapshot.roster.people.find(p => p.id === assignment?.managerId)?.name ?? 'No manager in scope'}</p></>;
  if (team) details = <><h2>{team.name}</h2><p>{team.description}</p>{areasForTeam(snapshot.state, team).map(a => <AreaDetails key={a.id} area={a} base="" />)}</>;
  if (area) details = <AreaDetails area={area} base="" />;
  const nodeCount = mode === 'areas' ? 0 : mode === 'reporting' ? snapshot.roster.people.length : mode === 'timezones' ? regionNames(snapshot.state, snapshot.roster.people).length : snapshot.state.teams.length + 1;
  return <EmbeddedAvatars.Provider value={avatars}><div className="snapshot-export" data-node-count={nodeCount} data-mode={mode}>
    <header className="export-heading"><h1>{snapshot.name}</h1><p>{snapshot.description}</p><p className="small">Read-only snapshot · {new Date(snapshot.createdAt).toLocaleString()} · {snapshot.roster.scope}</p></header>
    <nav className="export-actions" aria-label="Snapshot views">
      {(['teams', 'timezones', 'reporting', 'areas'] as const).map(value => <button key={value} aria-pressed={mode === value} onClick={() => { select(null); setMode(value); }}>{({ teams: 'Teams', timezones: 'Timezones', reporting: 'Reporting lines', areas: 'Areas' })[value]}</button>)}
      <button onClick={() => window.print()}>Print / Save as PDF</button><span className="small">Offline copy. No sign-in required.</span>
    </nav>
    <Board state={snapshot.state} people={snapshot.roster.people} readonly selection={selection} select={select}
      move={ignore} reposition={ignore} mode={mode} search="" avatarBase="" initialView={snapshot.view} onViewport={ignore} />
    {details && <aside className="export-details"><button aria-label="Close details" onClick={() => select(null)}>Close</button>{details}</aside>}
  </div></EmbeddedAvatars.Provider>;
}

// Print the complete board, including nodes outside the saved viewport.
function preparePrint() {
  const root = document.querySelector<HTMLElement>('.snapshot-export');
  if (!root) return;
  document.body.classList.add('printing');
  const nodes = [...document.querySelectorAll<HTMLElement>('.react-flow__node')];
  let width = 1280;
  let height: number;
  if (nodes.length) {
    const bounds = nodes.map(node => {
      const transform = new DOMMatrix(getComputedStyle(node).transform);
      return { x: transform.m41, y: transform.m42, width: node.offsetWidth, height: node.offsetHeight };
    });
    const left = Math.min(...bounds.map(b => b.x)), top = Math.min(...bounds.map(b => b.y));
    width = Math.max(800, Math.ceil(Math.max(...bounds.map(b => b.x + b.width)) - left + 64));
    const boardHeight = Math.ceil(Math.max(...bounds.map(b => b.y + b.height)) - top + 64);
    root.style.setProperty('--print-transform', `translate(${32 - left}px, ${32 - top}px) scale(1)`);
    root.style.setProperty('--print-board-height', `${boardHeight}px`);
    root.style.width = `${width}px`;
    height = boardHeight + Math.ceil(document.querySelector<HTMLElement>('.export-heading')!.getBoundingClientRect().height) + 2;
  } else {
    root.style.width = `${width}px`;
    height = Math.ceil(root.getBoundingClientRect().height) + 2;
  }
  const pageStyle = document.getElementById('print-page') ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: 'print-page' }));
  pageStyle.textContent = `@page{size:${width}px ${height}px;margin:0}`;
  root.dataset.printWidth = String(width);
  root.dataset.printHeight = String(height);
}
window.addEventListener('beforeprint', preparePrint);
window.addEventListener('afterprint', () => {
  document.body.classList.remove('printing');
  document.querySelector<HTMLElement>('.snapshot-export')?.removeAttribute('style');
});
try {
  const data = JSON.parse(document.getElementById('snapshot-data')!.textContent!) as { snapshot: Snapshot; avatars: Record<string, string> };
  createRoot(document.getElementById('root')!).render(<Export {...data} />);
} catch {
  document.getElementById('root')!.textContent = 'This snapshot could not be opened. Export it again from the planner.';
}
