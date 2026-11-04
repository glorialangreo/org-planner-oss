import { useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, useNodesState, useNodesInitialized, useReactFlow, useStore,
  type Node, type NodeProps, type Edge,
} from '@xyflow/react';
import { GripVertical, Users, Crown } from 'lucide-react';
import { AreasTable, PartnerAvatars } from './Partners';
import { Avatar } from './Avatar';
import { areasForTeam, defaultView, defaultUnassignedPosition, regionNames, regionFor, type Partner, type Person, type PlanState, type Region, type SavedView } from '../shared/model';
import { reportingLayout } from '../shared/reporting';

export const unassignedNodeId = '__unassigned';
export type Selection = { kind: 'person' | 'team' | 'area' | 'unassigned'; id: string } | null;
type Member = Person & { region: Region; leader: boolean; managerName: string | null; teamName: string };
type CardData = {
  title: string; subtitle: string; members: Member[]; readonly: boolean;
  selectedPerson: string | null; avatarBase: string; select: (s: Selection) => void;
  move: (person: string, team: string | null) => void; teamId: string | null;
  search: string; group: boolean;
  description?: string; areaCount?: number; partners?: Partner[];
};
type CardNode = Node<CardData, 'team'>;

function TeamCard({ data, selected }: NodeProps<CardNode>) {
  return <section className={`team-card ${selected ? 'selected' : ''}`} aria-label={data.title}
    onDragOver={e => { if (!data.readonly && !data.group) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
    onDrop={e => {
      if (data.readonly || data.group) return;
      e.preventDefault();
      const id = e.dataTransfer.getData('application/org-person');
      if (id) data.move(id, data.teamId);
    }}>
    <header className="card-drag">
      <GripVertical size={15} className="grip" />
      <button className="team-title nodrag" onClick={() => {
        if (!data.group) data.select(data.teamId ? { kind: 'team', id: data.teamId } : { kind: 'unassigned', id: unassignedNodeId });
      }}>{data.title}</button>
      <span className="count">{data.members.length}</span>
    </header>
    <p className="card-subtitle">{data.subtitle}</p>
    {!!data.areaCount && <button className="area-shortcut nodrag" onClick={() => data.teamId && data.select({ kind: 'team', id: data.teamId })}>{data.areaCount} areas · {new Set(data.partners?.map(p => p.id)).size} partners</button>}
    <div className="members">
      {data.members.map(p => <button key={p.id}
        className={`member nodrag ${data.selectedPerson === p.id ? 'active' : ''} ${data.search && !`${p.name} ${p.title}`.toLowerCase().includes(data.search.toLowerCase()) ? 'dimmed' : ''}`}
        draggable={!data.readonly}
        onDragStart={e => { e.dataTransfer.setData('application/org-person', p.id); e.dataTransfer.effectAllowed = 'move'; }}
        onClick={() => data.select({ kind: 'person', id: p.id })}>
        <Avatar person={p} base={data.avatarBase} />
        <span className="member-copy"><strong>{p.name}</strong><span>{p.region}{p.leader && <><Crown size={12} /> Team lead</>}</span></span>
      </button>)}
      {!data.members.length && <div className="empty-team"><Users size={20} /><span>{data.readonly ? 'No members' : 'Drop people here or use Move to team'}</span></div>}
    </div>
    {!!data.partners?.length && <PartnerAvatars partners={data.partners} base={data.avatarBase}
      inspect={() => data.teamId && data.select({ kind: 'team', id: data.teamId })} />}
    {data.description?.trim() && <footer className="card-description"><p>{data.description}</p></footer>}
  </section>;
}
type PersonData = { person: Member; avatarBase: string; select: (s: Selection) => void; dimmed: boolean };
function PersonCard({ data, selected }: NodeProps<Node<PersonData, 'person'>>) {
  return <><Handle type="target" position={Position.Top} /><button className={`report-person ${selected ? 'active' : ''} ${data.dimmed ? 'dimmed' : ''}`} onClick={() => data.select({ kind: 'person', id: data.person.id })}>
    <Avatar person={data.person} base={data.avatarBase} /><span><strong>{data.person.name}</strong>
      <small>{data.person.region}</small><span className="report-team" title={data.person.teamName}>{data.person.teamName}</span>
      <small className="report-manager">{data.person.managerName ? `Reports to ${data.person.managerName}` : 'No manager in scope'}</small>
    </span>
  </button><Handle type="source" position={Position.Bottom} /></>;
}
function ReportingFocus({ selection, rootId, restoreViewport }: { selection: Selection; rootId?: string; restoreViewport: boolean }) {
  const ready = useNodesInitialized();
  const { getNode, setCenter, setViewport } = useReactFlow();
  const width = useStore(s => s.width);
  const focused = useRef<string | null>(null);
  useEffect(() => {
    const target = selection?.kind === 'person' ? selection.id : !restoreViewport && !focused.current ? rootId : null;
    if (!ready || !width || !target || focused.current === target) return;
    const node = getNode(target);
    if (!node || node.type !== 'person') return;
    focused.current = target;
    if (selection?.kind === 'person') void setCenter(node.position.x + 130, node.position.y + 92, { zoom: 1 });
    else void setViewport({ x: width / 2 - node.position.x - 130, y: 28 - node.position.y, zoom: 1 });
  }, [ready, selection, rootId, restoreViewport, getNode, setCenter, setViewport, width]);
  return null;
}
const nodeTypes = { team: TeamCard, person: PersonCard };
export type BoardMode = 'teams' | 'timezones' | 'reporting' | 'areas';

export function Board({ state, people, readonly, selection, select, move, reposition, mode, search, avatarBase, initialView, onViewport, exportAreas, exportDisabled }: {
  state: PlanState; people: Person[]; readonly: boolean; selection: Selection; select: (s: Selection) => void;
  move: (person: string, team: string | null) => void; reposition: (id: string, p: { x: number; y: number }) => void;
  mode: BoardMode; search: string; avatarBase: string;
  initialView?: SavedView; onViewport: (viewport: SavedView['viewport']) => void;
  exportAreas?: () => void; exportDisabled?: boolean;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const assignments = useMemo(() => new Map(state.assignments.map(a => [a.personId, a])), [state]);
  const names = useMemo(() => new Map(people.map(p => [p.id, p.name])), [people]);
  const members = useMemo(() => people.map(p => ({
    ...p, region: assignments.get(p.id)?.regionOverride ?? regionFor(p.timezone),
    leader: state.teams.some(t => t.leaderId === p.id),
    managerName: names.get(assignments.get(p.id)?.managerId ?? '') ?? null,
    teamName: state.teams.find(t => t.id === assignments.get(p.id)?.teamId)?.name ?? 'Unassigned',
  })), [people, assignments, state, names]);
  const edges: Edge[] = mode === 'reporting' ? state.assignments.flatMap(a => a.managerId ? [{
    id: a.personId, source: a.managerId, target: a.personId, type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#59636e' }, style: { stroke: '#59636e', strokeWidth: 1.5 },
    ariaLabel: `${names.get(a.personId)} reports to ${names.get(a.managerId)}`,
  }] : []) : [];
  useEffect(() => {
    const common = { members, readonly, selectedPerson: selection?.kind === 'person' ? selection.id : null,
      avatarBase, select, move, search };
    if (mode === 'reporting') {
      const positions = reportingLayout(state.assignments);
      setNodes(members.map(p => ({
        id: p.id, type: 'person', position: positions.get(p.id)!, draggable: false,
        selected: selection?.kind === 'person' && selection.id === p.id,
        data: { person: p, avatarBase, select, dimmed: !!search && !`${p.name} ${p.title}`.toLowerCase().includes(search.toLowerCase()) },
      })));
    } else if (mode === 'timezones') {
      setNodes(regionNames(state, people).map((region, i) => ({
        id: region, type: 'team', position: { x: i * 340, y: 0 }, draggable: false,
        data: { ...common, title: region, subtitle: region === 'Unknown' ? 'Timezone needs verification' : 'Grouped by IANA timezone or explicit override',
          members: members.filter(p => p.region === region), teamId: null, group: true },
      })));
    } else {
      setNodes([
        ...state.teams.map(t => {
          const areas = areasForTeam(state, t);
          const partners = [...new Map(areas.flatMap(a => a.partners).map(p => [`${p.discipline}:${p.id}`, p])).values()];
          return {
          id: t.id, type: 'team', dragHandle: '.card-drag', position: t.position, draggable: !readonly,
          selected: selection?.kind === 'team' && selection.id === t.id,
          data: { ...common, title: t.name, subtitle: state.orgs.find(o => o.id === t.orgId)?.name ?? '',
            description: t.description, areaCount: areas.length, partners,
            members: members.filter(p => assignments.get(p.id)?.teamId === t.id)
              .sort((a, b) => Number(b.id === t.leaderId) - Number(a.id === t.leaderId)),
            teamId: t.id, group: false },
          };
        }),
        { id: unassignedNodeId, type: 'team', position: state.unassignedPosition ?? defaultUnassignedPosition,
          dragHandle: '.card-drag', draggable: !readonly, selected: selection?.kind === 'unassigned',
          data: { ...common, title: 'Unassigned', subtitle: 'People without a team remain here',
            members: members.filter(p => !assignments.get(p.id)?.teamId), teamId: null, group: false } },
      ]);
    }
  }, [state, people, members, assignments, readonly, selection, select, move, avatarBase, mode, search, setNodes]);
  if (mode === 'areas') return <AreasTable state={state} base={avatarBase} readonly={readonly} selectTeam={id => select({ kind: 'team', id })} selectArea={id => select({ kind: 'area', id })} exportAreas={exportAreas} exportDisabled={exportDisabled} />;
  return <div className="board" aria-label={`${mode} canvas`}>
    <ReactFlow key={mode} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
      onNodeDragStop={(_event, node) => reposition(node.id, node.position)}
      onPaneClick={() => select(null)} nodesConnectable={false} edgesReconnectable={false} nodesFocusable={false} edgesFocusable={false}
      onMoveEnd={(_event, viewport) => onViewport(viewport)}
      deleteKeyCode={null} minZoom={0.2} maxZoom={1.5} defaultViewport={(initialView ?? defaultView).viewport}
      fitView={false} proOptions={{ hideAttribution: true }}>
      {mode === 'reporting' && <ReportingFocus selection={selection} rootId={state.assignments.find(a => a.managerId === null)?.personId} restoreViewport={initialView?.mode === mode} />}
      <Background gap={20} size={1} color="#d8dee4" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable ariaLabel="Canvas overview" />
    </ReactFlow>
    <div className="canvas-hint">{mode === 'teams' && !readonly ? 'Drag a team header to arrange. Drag a person to move them.' : mode === 'reporting' ? 'Arrows run from manager to direct report. Search to focus a person; edit Reports to in their details.' : 'Select a person to inspect their details.'}</div>
  </div>;
}
