import { test, expect, type Page } from '@playwright/test';
import { areaTemplate, rosterTemplate } from '../shared/import';
import { backupFixture } from './fixture';

const backName = 'Back to Org planner';

async function mockWorkspace(page: Page, empty = false) {
  const data = backupFixture();
  await page.route('**/api/workspace', route => route.fulfill({
    json: empty
      ? { roster: null, references: [], scenarios: [], snapshots: [] }
      : { roster: data.baseline, references: [], scenarios: data.scenarios, snapshots: [] },
  }));
  await page.goto(empty ? '/' : '/?scenario=fixture-plan');
  await expect(page.getByRole('heading', { name: empty ? 'New Workspace' : 'Fictional plan', exact: true })).toBeVisible();
}

async function expectBackAboveTitle(page: Page) {
  const link = page.getByRole('link', { name: backName, exact: true });
  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();
  const linkBox = await link.boundingBox();
  const titleBox = await page.getByRole('heading', { level: 1 }).boundingBox();
  expect(linkBox!.y + linkBox!.height).toBeLessThanOrEqual(titleBox!.y);
  await expect(page.getByRole('button', { name: /^Back/ })).toHaveCount(0);
}

test('first-time back links return to welcome without reloading or creating data', async ({ page }) => {
  const mutations: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/') && request.method() !== 'GET') mutations.push(request.url());
  });
  await mockWorkspace(page, true);
  await expect(page.getByRole('link', { name: backName })).toHaveCount(0);
  for (const action of ['Start empty', 'Import your organization']) {
    await page.getByRole('button', { name: action, exact: true }).click();
    if (action === 'Import your organization') await page.getByRole('button', { name: 'Import Roster', exact: true }).click();
    await page.getByLabel('Organization name').fill('Unsaved fictional organization');
    await expectBackAboveTitle(page);
    await page.getByRole('link', { name: backName }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.setup-options')).toBeVisible();
    await page.getByRole('button', { name: action, exact: true }).click();
    if (action === 'Import your organization') await page.getByRole('button', { name: 'Import Roster', exact: true }).click();
    await expect(page.getByLabel('Organization name')).toHaveValue(action === 'Start empty' ? 'Unsaved fictional organization' : '');
    await page.getByRole('link', { name: backName }).click();
  }
  expect(mutations).toEqual([]);
});

test('every setup back link returns to the selected planner without a reload', async ({ page }) => {
  await mockWorkspace(page);
  let documentLoads = 0;
  page.on('request', request => { if (request.isNavigationRequest()) documentLoads++; });
  await expect(page.locator('.app-header .privacy')).toHaveCount(0);
  await expect(page.getByText('Local workspace · No sign-in', { exact: true })).toHaveCount(0);
  for (const action of [null, 'Start empty', 'Import your organization', 'Restore a backup']) {
    await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
    if (action) await page.getByRole('button', { name: action, exact: true }).click();
    await expectBackAboveTitle(page);
    await expect(page.getByRole('link', { name: backName })).toHaveAttribute('href', '/');
    await page.getByRole('link', { name: backName }).click();
    await expect(page.getByRole('heading', { name: 'Fictional plan', exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('scenario')).toBe('fixture-plan');
  }
  await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Start empty', exact: true }).click();
  await expectBackAboveTitle(page);
  await page.getByRole('link', { name: backName }).click();
  await expect(page.getByRole('heading', { name: 'Fictional plan', exact: true })).toBeVisible();
  expect(documentLoads).toBe(0);
});

test('roster and area links download same-origin CSV attachments without leaving setup', async ({ page }) => {
  await mockWorkspace(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  for (const [label, path, filename, contents] of [
    ['Download roster template', '/api/templates/roster.csv', 'roster-template.csv', rosterTemplate],
    ['Download area template', '/api/templates/areas.csv', 'areas-template.csv', areaTemplate],
  ]) {
    const link = page.getByRole('link', { name: label, exact: true });
    await expect(link).toHaveAttribute('href', path);
    const downloadEvent = page.waitForEvent('download');
    await link.click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(filename);
    expect(await download.failure()).toBeNull();
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString('utf8')).toBe(contents);
    await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
  }
});

test('setup back link cannot interrupt a pending import preview', async ({ page }) => {
  await mockWorkspace(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/imports/preview', async route => {
    await waiting;
    await route.fulfill({ json: { previewId: 'fictional-preview', backup: { references: 0, scenarios: 1, snapshots: 1 } } });
  });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('button', { name: 'Import Workspace', exact: true }).click();
  await page.getByLabel('Upload JSON backup').setInputFiles({
    name: 'fictional-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backupFixture())),
  });
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  const link = page.getByRole('link', { name: backName });
  try {
    await expect(link).toHaveAttribute('aria-disabled', 'true');
    await link.dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Import', exact: true })).toBeVisible();
  } finally { release(); }
  await expect(link).not.toHaveAttribute('aria-disabled', 'true');
  await link.click();
  await expect(page.getByRole('heading', { name: 'Fictional plan', exact: true })).toBeVisible();
});

test('save errors continue to block leaving the planner', async ({ page }) => {
  await mockWorkspace(page);
  await page.route('**/api/scenarios/fixture-plan', route => route.fulfill({ status: 500, json: { error: 'Synthetic save failure' } }));
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('Fictional new team');
  await dialog.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Save failed');
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'New Workspace', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Org planner home' }).click();
  await expect(page.getByRole('alert')).toContainText('Wait for changes to save');
  await expect(page.getByRole('heading', { name: 'Fictional plan', exact: true })).toBeVisible();
});

test('snapshot back navigation sits above its title on desktop and mobile', async ({ page }) => {
  const id = '11111111-1111-4111-a111-111111111111';
  const snapshot = { ...backupFixture().snapshots[0], id };
  // The document route also checks storage, so serve the app shell for this API-only fixture.
  await page.route(`**/s/${id}`, async route => {
    const response = await route.fetch({ url: new URL('/', route.request().url()).href });
    await route.fulfill({ response });
  });
  await page.route(`**/api/snapshots/${id}`, route => route.fulfill({ json: snapshot }));
  await page.route('**/api/workspace', route => route.fulfill({
    json: { roster: backupFixture().baseline, references: [], scenarios: [], snapshots: [] },
  }));
  await page.goto(`/s/${id}`);
  await expect(page.getByRole('heading', { name: 'Fictional snapshot Read only', exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await expectBackAboveTitle(page);
    await expect(page.locator('.sidebar').getByRole('link', { name: /Back/ })).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: backName })).toHaveAttribute('href', '/');
  await page.getByRole('link', { name: backName }).click();
  await expect(page.getByRole('heading', { name: 'Current baseline Read only', exact: true })).toBeVisible();
});
