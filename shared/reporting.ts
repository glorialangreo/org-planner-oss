import { type PlanState } from './model.js';

export function reportingLayout(assignments: PlanState['assignments']) {
  const children = new Map<string | null, string[]>();
  for (const a of assignments) {
    children.set(a.managerId, [...(children.get(a.managerId) ?? []), a.personId]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  let column = 0;
  function place(id: string, depth: number): number {
    const reports = children.get(id) ?? [];
    const centers = reports.map(child => place(child, depth + 1));
    const center = centers.length ? (centers[0] + centers.at(-1)!) / 2 : column++;
    positions.set(id, { x: center * 296, y: depth * 250 });
    return center;
  }
  for (const root of children.get(null) ?? []) {
    place(root, 0);
    column++;
  }
  return positions;
}
