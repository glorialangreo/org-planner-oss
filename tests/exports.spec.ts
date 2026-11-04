import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { regionNames } from '../shared/model';

for (const mode of ['teams', 'timezones', 'reporting', 'areas']) {
  test(`snapshot ${mode} HTML works offline and PDF contains the complete frozen view`, async ({ page, browser }, testInfo) => {
    test.setTimeout(90000);
    await page.goto('/');
    const headers = { Origin: new URL(page.url()).origin, 'X-Org-Planner': 'local' };
    const workspace = await (await page.request.get('/api/workspace')).json();
    const state = workspace.roster.state;
    state.teams[0].leaderId = 'sam';
    state.teams[0].description = 'Complete description\nSecond paragraph retained.';
    state.areas[0].partners[0].avatarId = 'a'.repeat(64);
    const created = await page.request.post('/api/scenarios', { headers, data: { name: 'Export source', description: '', state } });
    expect(created.status()).toBe(201);
    const scenario = await created.json();
    const frozen = await page.request.post('/api/snapshots', { headers, data: {
      name: `Offline ${mode}`, description: 'Frozen <text> & accents: Zoë',
      scenarioId: scenario.id, revision: 1, view: { mode, viewport: { x: -9999, y: -9999, zoom: 0.2 } },
    } });
    expect(frozen.status()).toBe(201);
    const snapshot = await frozen.json();
    await page.goto(`/s/${snapshot.id}`);
    await page.getByRole('heading', { name: `Offline ${mode} Read only`, exact: true }).waitFor();
    const htmlDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download HTML', exact: true }).click();
    const file = testInfo.outputPath('snapshot.html');
    await (await htmlDownload).saveAs(file);
    const html = readFileSync(file, 'utf8');
    expect(html).toContain('data:image/png;base64,');
    const offline = await browser.newContext({ offline: true, viewport: { width: 1440, height: 960 } });
    const copy = await offline.newPage();
    const failures: string[] = [];
    const external: string[] = [];
    copy.on('pageerror', error => failures.push(error.message));
    copy.on('request', req => { if (/^https?:/.test(req.url())) external.push(req.url()); });
    await copy.goto(pathToFileURL(file).href);
    await expect(copy.getByRole('heading', { name: `Offline ${mode}`, exact: true })).toBeVisible();
    await expect(copy.getByText('Frozen <text> & accents: Zoë', { exact: true })).toBeVisible();
    if (mode !== 'areas') {
      await expect(copy.locator('.react-flow__node')).toHaveCount(mode === 'teams' ? state.teams.length + 1 : mode === 'timezones' ? regionNames(state, workspace.roster.people).length : workspace.roster.people.length);
      await copy.getByRole('button', { name: /fit view/i }).click();
    }
    if (mode === 'teams') {
      const pod = copy.getByRole('region', { name: 'Core experience', exact: true });
      await expect(pod.locator('.member-copy strong').first()).toHaveText('Sam Chen');
      await expect(pod.locator('.card-description')).toHaveText('Complete description\nSecond paragraph retained.');
      await expect(pod.locator('.member[draggable=true]')).toHaveCount(0);
      await expect.poll(() => pod.locator('.pod-partner-avatar img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(28);
      await copy.screenshot({ path: testInfo.outputPath('offline-desktop.png') });
      await copy.setViewportSize({ width: 390, height: 844 });
      await copy.getByRole('button', { name: /fit view/i }).click();
      expect(await copy.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await copy.screenshot({ path: testInfo.outputPath('offline-mobile.png') });
      await copy.setViewportSize({ width: 1440, height: 960 });
    }
    await copy.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    if (mode !== 'areas') {
      const clipped = await copy.locator('.board').evaluate(board => {
        const bounds = board.getBoundingClientRect();
        return [...board.querySelectorAll('.react-flow__node')].some(node => {
          const b = node.getBoundingClientRect();
          return b.left < bounds.left || b.top < bounds.top || b.right > bounds.right + 1 || b.bottom > bounds.bottom + 1;
        });
      });
      expect(clipped).toBe(false);
    }
    expect(external).toEqual([]);
    expect(failures).toEqual([]);
    const download = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
    const pdfFile = testInfo.outputPath('snapshot.pdf');
    await (await download).saveAs(pdfFile);
    const pdf = readFileSync(pdfFile);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBe(1);
    await offline.close();
  });
}

test('PDF export errors remain visible and can be retried', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create scenario', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Export retry');
  await page.getByRole('dialog').getByRole('button', { name: 'Create scenario', exact: true }).click();
  await page.getByRole('button', { name: 'Save snapshot', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save snapshot', exact: true }).click();
  await page.route('**/api/snapshots/*/pdf', route => route.fulfill({ status: 503, json: { error: 'PDF export unavailable. Retry.' } }));
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('PDF export unavailable');
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled();
});
