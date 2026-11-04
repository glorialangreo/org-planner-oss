import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { defaultView, validateState, type Snapshot } from '../shared/model.js';
import type { Config } from './config.js';
import type { DB } from './db.js';

function exportPath(config: Config, id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid snapshot filename.');
  return join(config.snapshotPath, `${id}.html`);
}
export function renderSnapshotHtml(db: DB, config: Config, input: Snapshot) {
  const snapshot = { ...input, view: input.view ?? defaultView, state: validateState(input.state, input.roster.people) };
  const avatars: Record<string, string> = {};
  const ids = new Set([...snapshot.roster.people, ...(snapshot.state.areas ?? []).flatMap(a => a.partners)].flatMap(p => p.avatarId ? [p.avatarId] : []));
  for (const id of ids) {
    const row = db.getAvatar(id);
    if (!row || !['image/webp', 'image/png', 'image/jpeg'].includes(String(row.mime))) {
      throw new Error('Snapshot export requires every referenced photo to be available.');
    }
    avatars[id] = `data:${row.mime};base64,${Buffer.from(row.bytes as Uint8Array).toString('base64')}`;
  }
  const script = readFileSync(join(config.distPath, 'export/snapshot.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const css = readFileSync(join(config.distPath, 'export/snapshot.css'), 'utf8').replace(/<\/style/gi, '<\\/style');
  const data = JSON.stringify({ snapshot, avatars }).replace(/</g, '\\u003c');
  const digest = createHash('sha256').update(script).digest('base64');
  const title = snapshot.name.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${title}</title><style>${css}</style></head><body><div id="root"></div><noscript>Enable JavaScript to view this self-contained snapshot. No internet connection or sign-in is required.</noscript><script id="snapshot-data" type="application/json">${data}</script><script>${script}</script></body></html>`;
}
export function ensureSnapshotExport(db: DB, config: Config, snapshot: Snapshot) {
  const path = exportPath(config, snapshot.id);
  if (existsSync(path)) return false;
  const html = renderSnapshotHtml(db, config, snapshot);
  mkdirSync(config.snapshotPath, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, html, { flag: 'wx', mode: 0o600, flush: true });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return true;
}
export function removeFailedExport(config: Config, id: string) {
  rmSync(exportPath(config, id), { force: true });
}
export function readSnapshotExport(config: Config, id: string) {
  return readFileSync(exportPath(config, id), 'utf8');
}
export function exportExistingSnapshots(db: DB, config: Config) {
  for (const snapshot of db.listSnapshots()) {
    ensureSnapshotExport(db, config, { ...snapshot, view: snapshot.view ?? defaultView });
  }
}
export async function snapshotPdf(html: string) {
  const browser = await chromium.launch({ headless: true, timeout: 20000 });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(() => {
      const root = document.querySelector<HTMLElement>('.snapshot-export');
      if (!root) return false;
      if (root.dataset.mode === 'areas') return !!root.querySelector('.areas-view');
      const nodes = [...root.querySelectorAll<HTMLElement>('.react-flow__node')];
      return nodes.length === Number(root.dataset.nodeCount) && nodes.every(n => n.offsetWidth > 0 && n.offsetHeight > 0 && getComputedStyle(n).visibility !== 'hidden');
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
    });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    const size = await page.locator('.snapshot-export').evaluate(element => ({
      width: Number((element as HTMLElement).dataset.printWidth),
      height: Number((element as HTMLElement).dataset.printHeight),
    }));
    if (!size.width || !size.height || size.width > 18000 || size.height > 18000) throw new Error('Snapshot exceeds the supported PDF page size.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        page.pdf({ printBackground: true, width: `${size.width}px`, height: `${size.height}px`, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('PDF rendering timed out.')), 20000); }),
      ]);
    } finally { clearTimeout(timer); }
  } finally { await browser.close(); }
}
