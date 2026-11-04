import { Router } from 'express';
import { areaTemplate, rosterTemplate } from '../shared/import.js';
import { workspaceTemplate } from '../shared/templates.js';
import { validateDocument } from './db.js';

export const templateRouter = Router();

for (const [path, filename, contents] of [
  ['/roster.csv', 'roster-template.csv', rosterTemplate],
  ['/areas.csv', 'areas-template.csv', areaTemplate],
]) {
  templateRouter.get(path, (_req, res) => {
    res.attachment(filename).type('text/csv').send(contents);
  });
}
templateRouter.get('/planner.json', (_req, res) => {
  res.attachment('planner.json').json(validateDocument(workspaceTemplate()));
});
templateRouter.use((_req, res) => {
  res.status(404).json({ error: 'Template unavailable. Choose a roster, area or workspace template.' });
});
