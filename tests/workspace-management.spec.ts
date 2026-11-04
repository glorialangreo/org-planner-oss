import { test, expect, type Page } from '@playwright/test';

async function isolate(page: Page, prefix: string) {
  await page.route('**/api/workspace', async route => {
    const data = await (await route.fetch()).json();
    const references = data.references.filter((r: { roster: { scope: string } }) => r.roster.scope.startsWith(prefix));
    const ids = new Set(references.map((r: { id: string }) => r.id));
    await route.fulfill({ json: { roster: null, references,
      scenarios: data.scenarios.filter((s: { referenceId: string }) => ids.has(s.referenceId)),
      snapshots: data.snapshots.filter((s: { referenceId: string }) => ids.has(s.referenceId)),
    } });
  });
  await page.goto('/');
}
async function empty(page: Page, name: string) {
  await page.getByRole('button', { name: 'Start empty', exact: true }).click();
  await page.getByLabel('Organization name').fill(name);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${name} plan`, exact: true })).toBeVisible();
}

test('new workspace opens the cards; switching and confirmed deletion preserve other workspaces', async ({ page }, testInfo) => {
  await isolate(page, 'Workspace controls');
  await empty(page, 'Workspace controls A');
  await expect(page.getByRole('combobox', { name: 'My Workspaces' })).toHaveCount(0);
  await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
  await expect(page.locator('.setup-options > section')).toHaveCount(3);
  await page.getByRole('link', { name: 'Back to Org planner', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace controls A plan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New Workspace', exact: true }).click();
  await empty(page, 'Workspace controls B');
  const dropdown = page.getByRole('combobox', { name: 'My Workspaces' });
  await expect(dropdown.locator('option')).toHaveCount(2);
  const data = await (await page.request.get('/api/workspace')).json();
  const a = data.references.find((r: { roster: { scope: string } }) => r.roster.scope === 'Workspace controls A');
  await dropdown.selectOption(a.id);
  await expect(page.getByRole('heading', { name: 'Workspace controls A plan', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add first person' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('workspace-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Delete workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete workspace' });
  await expect(dialog).toContainText('Workspace controls A');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dropdown.locator('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete workspace', exact: true }).click();
  await page.route('**/api/workspaces', route => route.fulfill({ status: 503, json: { error: 'Synthetic deletion failure. Retry.' } }), { times: 1 });
  await dialog.getByRole('button', { name: 'Delete workspace', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Synthetic deletion failure');
  await expect(dropdown.locator('option')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Delete workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace controls B plan', exact: true })).toBeVisible();
  await expect(dropdown).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete workspace', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New Workspace' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.setup-options > section')).toHaveCount(3);
});

test('person photos support local upload and URL with errors, offline storage, and save guards', async ({ page }, testInfo) => {
  await isolate(page, 'Photo choices');
  await empty(page, 'Photo choices');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.getByRole('button', { name: 'Add first person' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add person', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Fictional Uploaded Photo');
  await expect(dialog.getByRole('radio', { name: 'Upload image' })).toBeChecked();
  await dialog.getByLabel('Local photo', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const stored = await (await page.request.get('/api/backup')).json();
  const avatarId = stored.avatars.at(-1).id;
  await page.getByRole('button', { name: 'Person', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Add person', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Fictional URL Photo');
  await dialog.getByRole('radio', { name: 'Image URL', exact: true }).check();
  await dialog.getByRole('textbox', { name: 'Image URL', exact: true }).fill('https://images.example.test/photo.png');
  await expect(dialog).toContainText('image host receives a request');
  await page.screenshot({ path: testInfo.outputPath('photo-url-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('photo-url-mobile.png'), fullPage: true });
  await page.route('**/api/avatars', route => route.fulfill({ status: 400, json: { error: 'The image could not be downloaded.' } }), { times: 1 });
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('could not be downloaded');
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Fictional URL Photo');
  await page.route('**/api/avatars', async route => {
    expect(route.request().postDataJSON()).toEqual({ url: 'https://images.example.test/photo.png' });
    await route.fulfill({ status: 201, json: { id: avatarId } });
  }, { times: 1 });
  await page.route('**/api/scenarios/*', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, json: { error: 'Synthetic save failure.' } }) : route.continue());
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic save failure');
  await expect(page.getByRole('button', { name: 'New Workspace', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete workspace', exact: true })).toBeDisabled();
  await page.unroute('**/api/scenarios/*');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Photo choices plan', exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/backup')).json();
  const plan = saved.scenarios.find((s: { name: string }) => s.name === 'Photo choices plan');
  expect(plan.roster.people.find((p: { name: string }) => p.name === 'Fictional URL Photo').avatarId).toBe(avatarId);
  expect(JSON.stringify(saved)).not.toContain('images.example.test');
});
