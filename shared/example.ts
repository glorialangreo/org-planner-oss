import { emptyRoster } from './import.js';
import { validateState, type Partner, type Roster } from './model.js';

const source = 'Fictional example. Not based on a real organization.';
const timezones = ['Europe/Madrid', 'Asia/Tokyo', 'Africa/Nairobi', 'America/Mexico_City', 'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland', 'Europe/Helsinki'];

export function exampleRoster(): Roster {
  const roster = emptyRoster('Example cooperative');
  roster.notes = [
    'All names, teams, responsibilities and reporting relationships are fictional.',
    'Explore several reporting levels, shared responsibilities, distributed teams and unassigned people.',
    'Moving a person between teams keeps their reporting manager. Areas can be shared across teams.',
  ];
  roster.state.orgs = [{ id: 'products', name: 'Products' }, { id: 'services', name: 'Services' }, { id: 'operations', name: 'Operations' }];
  const addPerson = (id: string, name: string, title: string, timezone: string | null, teamId: string | null, managerId: string | null) => {
    roster.people.push({ id, name, title, timezone, avatarId: null, source });
    roster.state.assignments.push({ personId: id, teamId, managerId, regionOverride: null });
  };
  addPerson('cedar', 'Cedar Finch', 'Cooperative coordinator', 'Europe/Madrid', 'coordination', null);
  addPerson('briar', 'Briar Sol', 'Products director', 'America/Mexico_City', 'coordination', 'cedar');
  addPerson('aster', 'Aster Dawn', 'Services director', 'Africa/Nairobi', 'coordination', 'cedar');
  addPerson('linden', 'Linden Clay', 'Operations director', 'Asia/Tokyo', 'coordination', 'cedar');
  roster.state.teams.push({
    id: 'coordination', name: 'Coordination', description: 'Set priorities and coordinate the cooperative across products, services and operations.',
    orgId: 'operations', leaderId: 'cedar', position: { x: 0, y: 0 }, areaIds: ['funding'], source,
  });
  const groups = [
    { id: 'workshop', name: 'Workshop', orgId: 'products', managerId: 'briar',
      description: 'Build and improve the tools members use every day.',
      names: ['Nova Vale', 'Juniper Cove', 'Alder Reed', 'Fern Grove'],
      roles: ['Team lead', 'Software engineer', 'Product designer', 'Software engineer'], areas: ['access', 'support'] },
    { id: 'research', name: 'Research', orgId: 'products', managerId: 'briar',
      description: 'Study member needs and test ideas before the cooperative invests in them.',
      names: ['Lumen Brook', 'Sage Hollow', 'Clover Wren', 'Ember Frost'],
      roles: ['Research lead', 'Researcher', 'Researcher', 'Data analyst'], areas: ['access', 'learning'] },
    { id: 'platform', name: 'Platform', orgId: 'products', managerId: 'briar',
      description: 'Maintain shared infrastructure and dependable services.',
      names: ['Aspen Lake', 'Indigo Marsh', 'Hazel Comet', 'Orion Willow'],
      roles: ['Platform lead', 'Infrastructure engineer', 'Software engineer', 'Reliability engineer'], areas: ['reliability', 'access'] },
    { id: 'support', name: 'Member support', orgId: 'services', managerId: 'aster',
      description: 'Help members solve problems and share recurring needs with the product teams.',
      names: ['Maple Star', 'Finch Meadow', 'Willow Bay', 'Laurel Pine'],
      roles: ['Support lead', 'Support specialist', 'Support specialist', 'Community coordinator'], areas: ['support', 'learning'] },
    { id: 'learning', name: 'Learning', orgId: 'services', managerId: 'aster',
      description: 'Create learning materials and help members develop their skills.',
      names: ['Marigold Vale', 'Cypress Moon', 'Dahlia Stone', 'Robin Glen'],
      roles: ['Learning lead', 'Learning designer', 'Technical writer', 'Workshop facilitator'], areas: ['learning'] },
    { id: 'field', name: 'Field services', orgId: 'services', managerId: 'aster',
      description: 'Coordinate local service launches and gather feedback from member communities.',
      names: ['Sorrel Peak', 'Birch Tide', 'Iris Ember', 'Flint Moss'],
      roles: ['Field lead', 'Service coordinator', 'Community organizer', 'Operations analyst'], areas: ['rollout', 'support'] },
    { id: 'finance', name: 'Finance', orgId: 'operations', managerId: 'linden',
      description: 'Plan budgets, manage purchasing and support transparent funding decisions.',
      names: ['Olive Dawn', 'Reed Harbor', 'Poppy Flint', 'Ash Rain'],
      roles: ['Finance lead', 'Finance analyst', 'Purchasing specialist', 'Accountant'], areas: ['funding', 'rollout'] },
    { id: 'people', name: 'People operations', orgId: 'operations', managerId: 'linden',
      description: 'Support hiring, onboarding and the working practices of the cooperative.',
      names: ['Acacia Bloom', 'Rowan Mist', 'Violet Shore', 'Hawthorn Sky'],
      roles: ['People lead', 'People coordinator', 'Recruiter', 'Workplace specialist'], areas: ['learning', 'rollout'] },
  ];
  groups.forEach((group, index) => {
    const leaderId = `${group.id}-1`;
    roster.state.teams.push({
      id: group.id, name: group.name, description: group.description, orgId: group.orgId, leaderId,
      position: { x: (index + 1) % 3 * 380, y: Math.floor((index + 1) / 3) * 670 },
      areaIds: group.areas, source,
    });
    group.names.forEach((name, member) => addPerson(`${group.id}-${member + 1}`, name, group.roles[member],
      timezones[(index + member) % timezones.length], group.id, member === 0 ? group.managerId : leaderId));
  });
  addPerson('unassigned-1', 'Kestrel Fern', 'Rotating researcher', 'Atlantic/Reykjavik', null, 'research-1');
  addPerson('unassigned-2', 'Basil Dune', 'New member', null, null, null);
  roster.state.unassignedPosition = { x: -380, y: 0 };
  const collaborator = (id: string, name: string, discipline: string, context: string, timezone: string): Partner =>
    ({ id, name, title: `${discipline} coordinator`, discipline, context, timezone, avatarId: null, source });
  const operations = collaborator('partner-operations', 'River Moss', 'Operations', 'Service planning', 'Africa/Nairobi');
  const accessibility = collaborator('partner-access', 'Lyra Field', 'Accessibility', 'Inclusive service design', 'Europe/London');
  const finance = collaborator('partner-finance', 'Wren Amber', 'Finance', 'Cost and funding review', 'America/Bogota');
  const community = collaborator('partner-community', 'Fable Reed', 'Community', 'Member feedback and local needs', 'Asia/Kolkata');
  const legal = collaborator('partner-legal', 'Solstice Cove', 'Legal', 'Policy and agreements', 'Australia/Sydney');
  const areas = [
    { id: 'access', name: 'Service access', description: 'Help members discover services and complete their first useful task.', owner: 'Nova Vale', partners: [accessibility, community] },
    { id: 'support', name: 'Customer support', description: 'Help members resolve problems across tools, resources and local services.', owner: 'Maple Star', partners: [operations, community] },
    { id: 'reliability', name: 'Platform reliability', description: 'Keep shared systems available and recover from incidents.', owner: 'Aspen Lake', partners: [operations] },
    { id: 'learning', name: 'Learning resources', description: 'Create clear guides, workshops and onboarding materials.', owner: 'Marigold Vale', partners: [accessibility, community] },
    { id: 'funding', name: 'Funding planning', description: 'Compare investment needs and plan sustainable budgets.', owner: 'Olive Dawn', partners: [finance, legal] },
    { id: 'rollout', name: 'Field rollout', description: 'Prepare and coordinate launches with local member communities.', owner: 'Sorrel Peak', partners: [operations, finance] },
    { id: 'future', name: 'Future initiatives', description: 'An unassigned area for exploring new member services.', owner: '', partners: [] },
  ];
  roster.state.areas = areas.map(area => ({ ...area, notes: '', source }));
  roster.state = validateState(roster.state, roster.people);
  return roster;
}
