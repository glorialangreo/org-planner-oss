import { test, expect, type Download } from '@playwright/test';

const headers = { Origin: 'http://127.0.0.1:4184', 'X-Org-Planner': 'local' };
async function downloadedText(download: Download) {
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test('New Workspace keeps onboarding and backups; Import is a separate reloadable route', async ({ page }, testInfo) => {
  const response = await page.request.post('/api/setup', { headers, data: { mode: 'example', name: 'Example' } });
  expect(response.ok()).toBe(true);
  const scenario = await response.json();
  await page.goto(`/?scenario=${scenario.id}`);
  await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New Workspace', exact: true })).toBeVisible();
    await expect(page.locator('.setup-options > section')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'Backup and restore', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download JSON backup', exact: true })).toHaveAttribute('href', '/api/backup');
    await expect(page.getByRole('button', { name: 'Restore a backup', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('new-workspace-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('new-workspace-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'Import your organization', exact: true }).click();
  expect(new URL(page.url()).pathname).toBe('/import');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
  await expect(page.locator('.import-options button')).toHaveText(['Import Roster', 'Import Areas', 'Import Workspace']);
  await expect(page.locator('.import-options a')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('import-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('import-mobile.png'), fullPage: true });
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'New Workspace', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
  for (const entry of ['Import Roster', 'Import Areas', 'Import Workspace']) {
    await page.getByRole('button', { name: entry, exact: true }).click();
    await expect(page.getByRole('region', { name: entry, exact: true })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Backup and restore', exact: true })).toHaveCount(0);
  }
  await expect(page.getByLabel('Upload JSON backup')).toBeVisible();
  const templateEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download workspace template' }).click();
  const template = await downloadedText(await templateEvent);
  expect(JSON.parse(template).baseline.scope).toBe('Example workspace');
  await page.getByLabel('Upload JSON backup').setInputFiles({ name: 'planner.json', mimeType: 'application/json', buffer: Buffer.from(template) });
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Import preview' })).toContainText('Restore copies of 1 references');
  await page.getByRole('link', { name: 'Back to Org planner', exact: true }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  expect(new URL(page.url()).pathname).toBe('/import');
  await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import / export', exact: true })).toHaveCount(0);
});

test('Overview exports workspace JSON; People and Areas export the selected view CSVs', async ({ page }, testInfo) => {
  const scenario = await (await page.request.post('/api/setup', { headers, data: { mode: 'example', name: 'Example' } })).json();
  await page.request.post('/api/setup', { headers, data: { mode: 'empty', name: 'Separate export fixture' } });
  await page.goto(`/?scenario=${scenario.id}`);
  await expect(page.locator('.workspace-export')).toHaveCount(0);
  await page.getByRole('button', { name: 'Current baseline', exact: true }).click();
  const menu = page.locator('.inspector .workspace-export');
  await menu.locator('summary').click();
  await expect(menu.getByRole('link')).toHaveText(['All Workspace']);
  const downloadEvent = page.waitForEvent('download');
  await menu.getByRole('link', { name: 'All Workspace', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('planner.json');
  const backup = JSON.parse(await downloadedText(download));
  expect(backup.baseline).toBeNull();
  expect(backup.references.map((r: { id: string }) => r.id)).toEqual([scenario.referenceId]);
  expect(backup.scenarios.map((s: { id: string }) => s.id)).toEqual([scenario.id]);
  for (const [view, label, filename, header] of [
    ['People', 'Export roster', 'roster.csv', '"person_id","name","team","manager","role","timezone"'],
    ['Areas', 'Export areas', 'areas.csv', '"name","description","owner","teams"'],
  ]) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    const file = await event;
    expect(file.suggestedFilename()).toBe(filename);
    expect(await downloadedText(file)).toContain(header);
    await page.screenshot({ path: testInfo.outputPath(`${view.toLowerCase()}-export-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: label, exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${view.toLowerCase()}-export-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 960 });
  }
  await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
  const fullEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download JSON backup', exact: true }).click();
  const full = JSON.parse(await downloadedText(await fullEvent));
  expect(full.references.length).toBeGreaterThan(backup.references.length);
});

test('area upload from Current baseline previews a new scenario without changing the reference', async ({ page }) => {
  const scenario = await (await page.request.post('/api/setup', { headers, data: { mode: 'example', name: 'Example' } })).json();
  const before = await (await page.request.get('/api/workspace')).json();
  const original = before.references.find((r: { id: string }) => r.id === scenario.referenceId);
  await page.goto(`/?scenario=${scenario.id}`);
  await page.getByRole('button', { name: 'Current baseline', exact: true }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('button', { name: 'Import Areas', exact: true }).click();
  await expect(page.getByText('Areas will be added to a new scenario', { exact: false })).toBeVisible();
  await page.getByLabel('Upload CSV or TSV').setInputFiles({
    name: 'areas.csv', mimeType: 'text/csv',
    buffer: Buffer.from('name,description,owner,teams\nFictional imported area,Local test,Cedar Finch,Workshop'),
  });
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Import preview' })).toContainText('Fictional imported area');
  const previewed = await (await page.request.get('/api/workspace')).json();
  expect(previewed.scenarios.length).toBe(before.scenarios.length);
  await page.getByRole('button', { name: 'Confirm new scenario with areas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Example cooperative areas', exact: true })).toBeVisible();
  const after = await (await page.request.get('/api/workspace')).json();
  expect(after.references.find((r: { id: string }) => r.id === scenario.referenceId)).toEqual(original);
  expect(after.scenarios.find((s: { id: string }) => s.id === scenario.id)).toEqual(before.scenarios.find((s: { id: string }) => s.id === scenario.id));
});

test('a completely empty organization explains the prerequisite for area imports', async ({ page }) => {
  await page.route('**/api/workspace', route => route.fulfill({ json: { roster: null, references: [], scenarios: [], snapshots: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Import your organization', exact: true }).click();
  await page.getByRole('button', { name: 'Import Areas', exact: true }).click();
  await expect(page.getByText('Create an empty workspace or import a roster first', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Upload CSV or TSV')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Preview import', exact: true })).toBeDisabled();
});

test('scenario CSV exports include saved edits and surface export failures', async ({ page }) => {
  const scenario = await (await page.request.post('/api/setup', { headers, data: { mode: 'empty', name: 'Export scenario fixture' } })).json();
  await page.goto(`/?scenario=${scenario.id}`);
  await page.getByRole('button', { name: 'Add first person' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Fictional New Person');
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export roster' }).click();
  expect(await downloadedText(await event)).toContain('Fictional New Person');
  await page.route('**/api/workspaces/export?**', route => route.fulfill({ status: 409, json: { error: 'This scenario changed. Reload before exporting its current data.' } }));
  await page.getByRole('button', { name: 'Export roster' }).click();
  await expect(page.getByRole('alert')).toContainText('This scenario changed');
});
