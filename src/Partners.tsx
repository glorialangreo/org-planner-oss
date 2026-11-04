import { Avatar } from './Avatar';
import { useState } from 'react';
import { partnerSchema, regionFor, type Partner, type Area, type AreaDetailsInput, type PlanState } from '../shared/model';
import { PersonForm } from './People';
import { Download } from 'lucide-react';

export function AreaForm({ area, state, action, submit }: {
  area?: Area; state: PlanState; action: string; submit: (details: AreaDetailsInput, teamIds: string[]) => void;
}) {
  return <form onSubmit={e => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    submit({
      name: String(data.get('name')).trim(), description: String(data.get('description')),
      owner: String(data.get('owner')), notes: String(data.get('notes')),
    }, data.getAll('teamIds').map(String));
  }}>
    <label>Area name<input name="name" required maxLength={150} defaultValue={area?.name ?? ''} autoFocus={!area} /></label>
    <label>Area of responsibility<textarea aria-label="Area of responsibility" name="description" maxLength={2000} rows={4} defaultValue={area?.description ?? ''} /></label>
    <label>Area owner<input name="owner" maxLength={1000} defaultValue={area?.owner ?? ''} /></label>
    <label>Area notes<textarea aria-label="Area notes" name="notes" maxLength={2000} rows={3} defaultValue={area?.notes ?? ''} /></label>
    <fieldset className="area-assignments"><legend>Assigned teams</legend>
      <p id="area-assignment-help" className="small">Select any teams. With none selected, the area stays in the catalog as unassigned.</p>
      <div className="area-team-options">{state.teams.map(t => <label key={t.id}>
        <input type="checkbox" name="teamIds" value={t.id} defaultChecked={!!area && !!t.areaIds?.includes(area.id)} aria-describedby="area-assignment-help" />
        <span>{t.name}<small>{state.orgs.find(o => o.id === t.orgId)?.name}</small></span>
      </label>)}</div>
      {!state.teams.length && <p className="small">No teams yet. Create a team to assign this area.</p>}
    </fieldset>
    <button className="primary" type="submit">{action}</button>
  </form>;
}

export function PartnerList({ partners, base }: { partners: Partner[]; base: string }) {
  if (!partners.length) return <p className="small">No collaborators</p>;
  return <div className="partner-list">{partners.map(p => <div className="partner" key={p.id}>
    <Avatar person={p} base={base} />
    <div><strong>{p.name}</strong><span>{p.discipline}</span><span>{p.context}</span><span>{regionFor(p.timezone)} · {p.timezone ?? 'Timezone not verified'}</span>
      <details><summary>Profile source</summary><p className="small">{p.title}</p><p className="small">{p.source}</p></details></div>
  </div>)}</div>;
}

export function PartnerAvatars({ partners, base, inspect }: { partners: Partner[]; base: string; inspect: () => void }) {
  return <div className="pod-partners" role="group" aria-label="Area collaborators">
    {[...new Set(partners.map(p => p.discipline))].map(discipline => {
      const group = partners.filter(p => p.discipline === discipline);
      return group.length > 0 && <div className="pod-partner-row" key={discipline}>
        <span className="pod-partner-label">{discipline}</span>
        <div className="pod-partner-avatars">{group.map(p => {
          const label = `${p.name}, ${discipline} partner, ${regionFor(p.timezone)}, ${p.timezone ?? 'timezone not verified'}. ${p.context}`;
          return <button key={p.id} className="pod-partner-avatar nodrag" title={label} aria-label={label}
            onClick={inspect} onDragStart={e => e.preventDefault()}>
            <Avatar person={p} base={base} />
          </button>;
        })}</div>
      </div>;
    })}
  </div>;
}

export function AreaDetails({ area, base }: { area: Area; base: string }) {
  return <section className="area-detail">
    <h3>{area.name}</h3><p>{area.description}</p>
    <p className="small">Area owner: {area.owner || 'Not specified'}</p>
    <h4>Collaborators</h4><PartnerList partners={area.partners} base={base} />
    {area.notes && <p className="area-note">{area.notes}</p>}
    <details><summary>Area source</summary><p className="small">{area.source}</p></details>
  </section>;
}

export function AreasTable({ state, base, selectTeam, selectArea, readonly, exportAreas, exportDisabled }: {
  state: PlanState; base: string; selectTeam: (id: string) => void; selectArea: (id: string) => void; readonly: boolean;
  exportAreas?: () => void; exportDisabled?: boolean;
}) {
  const rows = (state.areas ?? []).map(area => ({ area, teams: state.teams.filter(t => t.areaIds?.includes(area.id)) }));
  return <div className="areas-view">
    {exportAreas && <div className="section-heading"><h2>Areas</h2><button disabled={exportDisabled} onClick={exportAreas}><Download size={16} aria-hidden="true" />Export areas</button></div>}
    <p className="small">Areas describe responsibilities, teams describe membership, and managers define reporting. Collaborators are separate from the people roster.</p>
    {rows.length ? <table><caption>Areas and responsibilities</caption>
      <thead><tr><th>Area and teams</th><th>Area of responsibility</th><th>Collaborators</th></tr></thead>
      <tbody>{rows.map(({ area, teams }) => <tr key={area.id}>
        <th scope="row"><strong>{area.name}</strong><p>{area.owner || 'Area owner not specified'}</p>
          <div aria-label="Assigned teams">{teams.length ? teams.map(t => <button key={t.id} onClick={() => selectTeam(t.id)}>{t.name}</button>) : <span className="small">Unassigned</span>}</div>
          <button aria-label={`${readonly ? 'View' : 'Edit'} area ${area.name}`} onClick={() => selectArea(area.id)}>{readonly ? 'View area' : 'Edit area'}</button>
        </th>
        <td><p>{area.description}</p>{area.notes && <p className="area-note">{area.notes}</p>}<details><summary>Area source</summary><p className="small">{area.source}</p></details></td>
        <td><PartnerList partners={area.partners} base={base} /></td>
      </tr>)}</tbody>
    </table> : <div className="empty-page"><h2>No areas yet</h2><p>{readonly ? 'No areas were saved in this view.' : 'Use New area to add responsibilities and assign teams. Areas can also stay unassigned.'}</p></div>}
  </div>;
}

export function CollaboratorEditor({ area, save }: { area: Area; save: (partners: Partner[]) => boolean }) {
  const [selected, setSelected] = useState<Partner | 'new' | null>(null);
  const [role, setRole] = useState('');
  const [context, setContext] = useState('');
  const [error, setError] = useState('');
  function choose(partner: Partner | 'new') {
    setSelected(partner); setRole(partner === 'new' ? '' : partner.discipline); setContext(partner === 'new' ? '' : partner.context); setError('');
  }
  return <section><h3>Edit collaborators</h3>
    {area.partners.map(p => <div className="form-actions" key={p.id}><button onClick={() => choose(p)}>Edit {p.name}</button><button className="danger" onClick={() => {
      if (window.confirm(`Remove ${p.name} from this area? The roster and snapshots stay unchanged.`)) save(area.partners.filter(other => other.id !== p.id));
    }}>Remove {p.name}</button></div>)}
    <button onClick={() => choose('new')}>Add collaborator</button>
    {selected && <div>
      <label>Collaborator role<input value={role} maxLength={150} onChange={e => setRole(e.target.value)} placeholder="Operations, research, finance..." /></label>
      <label>Collaboration context<textarea value={context} maxLength={1000} onChange={e => setContext(e.target.value)} /></label>
      {error && <p role="alert" className="form-error">{error}</p>}
      <PersonForm key={selected === 'new' ? 'new' : selected.id} person={selected === 'new' ? undefined : selected} action="Save collaborator" submit={person => {
        const result = partnerSchema.safeParse({ ...person, discipline: role, context });
        if (!result.success) { setError('Enter a collaborator role and check the profile fields.'); return false; }
        if (selected === 'new' && area.partners.some(p => p.id === person.id)) { setError('Collaborator ID already exists.'); return false; }
        const partners = selected === 'new' ? [...area.partners, result.data] : area.partners.map(p => p.id === person.id ? result.data : p);
        if (save(partners)) { setSelected(null); return true; } return false;
      }} />
      <button onClick={() => setSelected(null)}>Cancel collaborator edit</button>
    </div>}
  </section>;
}
