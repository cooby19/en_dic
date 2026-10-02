import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_MODEL, RETENTION_MS, type Entry, type QueryInput } from '@en-dic/shared';

async function queryPage(page: Page, failure?: 'network' | 'server' | 'invalid-json') {
  const inputs: QueryInput[] = [], saved = new Map<string, Entry>();
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') return route.fulfill({ json: { signedIn: true } });
    if (path === '/api/connection') return route.fulfill({ json: {
      connected: true, model: DEFAULT_MODEL, version: 1,
      testedAt: new Date().toISOString(), status: 'connected',
    } });
    if (path !== '/api/query') throw new Error(`Unexpected API request: ${path}`);
    const input = route.request().postDataJSON() as QueryInput;
    inputs.push(input);
    if (!saved.has(input.requestId)) saved.set(input.requestId, {
      id: randomUUID(), original: input.original, context: input.context ?? '',
      analysis: { kind: 'word', translation: '你好', ambiguity: '', partOfSpeech: '感嘆詞', usage: '打招呼', meanings: ['你好'] },
      provider: 'google', model: DEFAULT_MODEL, source: '', notes: '', favorite: false,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + RETENTION_MS).toISOString(),
      favoritedAt: null, review: null, reviewedAt: null, analysisVersion: 1,
    });
    // Saving may succeed even if the client never receives a usable response.
    if (inputs.length === 1 && failure === 'network') return route.abort('failed');
    if (inputs.length === 1 && failure === 'server') return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: '請重試' } } });
    if (inputs.length === 1 && failure === 'invalid-json') return route.fulfill({ contentType: 'application/json', body: '{' });
    return route.fulfill({ json: { entry: saved.get(input.requestId), existingFavorites: [] } });
  });
  await page.goto('/');
  await page.getByLabel('貼上英文').fill('hello');
  const submit = page.getByRole('button', { name: '翻譯與解析' });
  await expect(submit).toBeEnabled();
  return { inputs, saved, submit };
}

test('a new identical query after success receives a new request ID and entry', async ({ page }) => {
  const f = await queryPage(page);
  await f.submit.click();
  await expect(page.getByRole('button', { name: '收藏這次理解' })).toBeVisible();
  await f.submit.click();
  await expect(page.getByRole('button', { name: '收藏這次理解' })).toBeVisible();
  expect(f.inputs).toHaveLength(2);
  expect(f.inputs[1].requestId).not.toBe(f.inputs[0].requestId);
  expect(f.saved.size).toBe(2);
});

for (const failure of ['network', 'server', 'invalid-json'] as const) {
  test(`retry retains the request ID after an unknown save result (${failure})`, async ({ page }) => {
    const f = await queryPage(page, failure);
    await f.submit.click();
    await expect(page.getByRole('alert')).toBeVisible();
    await f.submit.click();
    await expect(page.getByRole('button', { name: '收藏這次理解' })).toBeVisible();
    expect(f.inputs[1].requestId).toBe(f.inputs[0].requestId);
    expect(f.saved.size).toBe(1);
    // Once the retry succeeds, the next deliberate submission is a new query.
    await f.submit.click();
    await expect(page.getByRole('button', { name: '收藏這次理解' })).toBeVisible();
    expect(f.inputs[2].requestId).not.toBe(f.inputs[1].requestId);
    expect(f.saved.size).toBe(2);
  });
}

for (const field of ['original', 'context'] as const) {
  test(`changing ${field} after a failed response starts a new request`, async ({ page }) => {
    const f = await queryPage(page, 'network');
    await f.submit.click();
    await expect(page.getByRole('alert')).toBeVisible();
    if (field === 'context') await page.locator('summary').click();
    await page.locator(`#${field}`).fill('different input');
    await f.submit.click();
    await expect(page.getByRole('button', { name: '收藏這次理解' })).toBeVisible();
    expect(f.inputs[1].requestId).not.toBe(f.inputs[0].requestId);
    expect(f.inputs[1][field]).toBe('different input');
  });
}
