import { z } from 'zod';
import { validateDocument } from './db.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parsePlannerBackup(text: string) {
  let input: unknown;
  try { input = JSON.parse(text); }
  catch { throw new Error('This file is not valid JSON. Choose a file from Download JSON backup. Nothing has been restored.'); }
  if (!record(input) || input.formatVersion !== 1) {
    throw new Error('This is not a supported planner backup. Use Download JSON backup in this edition. CSV rosters belong in the spreadsheet import.');
  }
  try {
    return validateDocument(input);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const locations = [...new Set(e.issues.slice(0, 3).map(issue => issue.path.join('.') || 'backup'))];
      throw new Error(`This backup has missing or unsupported data in ${locations.join(', ')}${e.issues.length > 3 ? ' and other fields' : ''}. Choose a complete planner backup. Nothing has been restored.`);
    }
    throw e;
  }
}
