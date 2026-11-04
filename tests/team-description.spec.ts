import { test, expect, type Page } from '@playwright/test';
import { fixture } from './fixture';
import { normalizeAreas } from '../shared/model';

const description = [
  'Own the fictional workflow from initial exploration through delivery. Keep the responsibility boundaries, research questions and follow-up decisions available while reviewing this team.',
  'Partner with Product and Engineering on planning, validation and quality. Preserve this second paragraph and its authored line break.\nReview accessibility and document unresolved questions.',
  `Reference: https://example.invalid/${'synthetic-responsibility-'.repeat(12)}`,
  'Final responsibility: share outcomes with the fictional team.',
].join('\n\n');

async function expectCompleteFooter(page: Page) {
  const pod = page.getByRole('region', { name: 'Core experience', exact: true });
  const footer = pod.locator('footer.card-description');
  await expect(footer).toBeVisible();
  expect(await footer.textContent()).toBe(description);
  await expect(footer).toHaveCSS('white-space', 'pre-wrap');
  await expect(footer).toHaveCSS('overflow-wrap', 'anywhere');
  await expect(footer).toHaveCSS('-webkit-line-clamp', 'none');
  await expect(footer).toHaveCSS('overflow', 'visible');
  await expect(pod.locator('.members')).toBeVisible();
  await expect(pod.getByRole('group', { name: 'Area collaborators' })).toBeVisible();
  await expect(pod.getByRole('button', { name: /Robin Example, Product partner/ })).toBeVisible();
  await expect(pod.getByRole('button', { name: /Drew Example, Engineering partner/ })).toBeVisible();
  const layout = await pod.evaluate(card => {
    const footer = card.querySelector<HTMLElement>('.card-description')!;
    const paragraph = footer.querySelector('p')!;
    const bounds = card.getBoundingClientRect();
    const footerBounds = footer.getBoundingClientRect();
    const members = card.querySelector('.members')!;
    const partners = card.querySelector('.pod-partners')!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const lines = [...range.getClientRects()];
    return {
      lastChild: card.lastElementChild === footer,
      followsMembers: !!(members.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING),
      followsPartners: !!(partners.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING),
      belowPeople: footerBounds.top >= Math.max(members.getBoundingClientRect().bottom, partners.getBoundingClientRect().bottom) - 1,
      unclipped: footer.scrollHeight <= footer.clientHeight && footer.scrollWidth <= footer.clientWidth,
      linesInsidePod: lines.every(line => line.left >= bounds.left && line.right <= bounds.right + 1 && line.bottom <= bounds.bottom),
      lineCount: lines.length,
      paragraphHeight: paragraph.clientHeight,
      lineHeight: parseFloat(getComputedStyle(paragraph).lineHeight),
    };
  });
  expect(layout).toMatchObject({
    lastChild: true, followsMembers: true, followsPartners: true,
    belowPeople: true, unclipped: true, linesInsidePod: true,
  });
  expect(layout.lineCount).toBeGreaterThan(3);
  expect(layout.paragraphHeight).toBeGreaterThan(layout.lineHeight * 3);
  for (const name of ['Design systems', 'Research', 'Unassigned']) {
    await expect(page.getByRole('region', { name, exact: true }).locator('.card-description')).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`complete team descriptions remain below people in baseline, scenario and snapshot at ${viewport.width}px`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    const roster = fixture();
    roster.state = normalizeAreas(roster.state);
    roster.state.teams[0].description = description;
    roster.state.teams[1].description = '';
    roster.state.teams[2].description = ' \n ';
    await page.route('**/api/workspace', async route => {
      const response = await route.fetch();
      const workspace = await response.json();
      await route.fulfill({ response, json: { ...workspace, roster } });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Current baseline Read only', exact: true })).toBeVisible();
    await expectCompleteFooter(page);

    await page.getByRole('button', { name: 'Create scenario', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`Description layout ${viewport.width}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Create scenario', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved');
    await expectCompleteFooter(page);
    await page.getByRole('button', { name: 'Save snapshot', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`Frozen description ${viewport.width}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Save snapshot', exact: true }).click();
    const url = await page.getByLabel('Snapshot URL').inputValue();

    const frozen = await context.newPage();
    await frozen.setViewportSize(viewport);
    await frozen.goto(url);
    await expect(frozen.getByRole('heading', { name: `Frozen description ${viewport.width} Read only`, exact: true })).toBeVisible();
    await expectCompleteFooter(frozen);
    await frozen.getByRole('button', { name: 'Core experience', exact: true }).click();
    await expect(frozen.getByRole('textbox', { name: 'Area of responsibility', exact: true })).toHaveValue(description);
    await expect(frozen.getByRole('textbox', { name: 'Area of responsibility', exact: true })).toBeDisabled();
    await expect(frozen.getByRole('region', { name: 'Core experience', exact: true }).locator('.member[draggable="true"]')).toHaveCount(0);
    await frozen.getByRole('button', { name: /fit view/i }).click();
    await expect(frozen.getByRole('region', { name: 'Core experience', exact: true }).locator('.card-description')).toBeInViewport();
    await frozen.screenshot({ path: `test-results/team-description-${viewport.width === 1440 ? 'desktop' : 'mobile'}.png`, fullPage: true });
    await frozen.close();
  });
}
