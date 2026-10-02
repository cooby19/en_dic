import { test, expect } from '@playwright/test';
import { browserFixture, deferred, navigate, sampleEntry } from './browser-fixture.js';

test('failed logout clears immediately, notifies another tab, and cannot auto-reopen on lifecycle events or reload', async ({ page, context }) => {
  await browserFixture(page, async (route,path) => { if (path !== '/api/logout') return false; await route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: '重試' } } }); return true; });
  const second = await context.newPage(); await browserFixture(second); await second.bringToFront();
  await second.getByLabel('貼上英文').fill('private second-tab input');
  await page.bringToFront(); await navigate(page, '設定');
  await page.getByRole('button', { name: '登出並清除畫面' }).click();
  await expect(page.getByRole('link', { name: '使用 Google 登入' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('伺服器登出尚未完成');
  await expect(second.getByRole('link', { name: '使用 Google 登入' })).toBeVisible();
  await expect(second.getByLabel('貼上英文')).toHaveCount(0);
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); });
  await expect(page.getByRole('link', { name: '使用 Google 登入' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('link', { name: '使用 Google 登入' })).toBeVisible();
  await page.getByRole('button', { name: '重試登出' }).click(); await expect(page.getByRole('alert')).toContainText('伺服器登出尚未完成');
});

test('a pending me response cannot sign the user back in after cross-tab logout', async ({ page }) => {
  const started = deferred(), response = deferred();
  await page.route('**/api/me', async route => { started.resolve(); await response.promise; await route.fulfill({ json: { signedIn: true } }); });
  await page.goto('/'); await started.promise;
  await page.evaluate(() => { const channel = new BroadcastChannel('en-dic-session'); channel.postMessage('logout'); channel.close(); });
  await expect(page.getByRole('link', { name: '使用 Google 登入' })).toBeVisible();
  const arrived = page.waitForResponse('**/api/me'); response.resolve(); await arrived;
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await expect(page.getByLabel('貼上英文')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('link', { name: '使用 Google 登入' })).toBeVisible();
});

for (const status of [200,401,500]) test(`late private query response (${status}) cannot restore content or errors after logout`, async ({ page }) => {
  const started = deferred(), response = deferred();
  await browserFixture(page, async (route,path) => {
    if (path !== '/api/query') return false;
    started.resolve(); await response.promise;
    await route.fulfill({ status, json: status === 200 ? { entry: sampleEntry('late-private-marker'), existingFavorites: [] } : { error: { code: 'FAILED', message: 'late-private-marker' } } }); return true;
  });
  await page.getByLabel('貼上英文').fill('private-query-marker'); await page.getByRole('button', { name: '翻譯與解析' }).click(); await started.promise;
  await navigate(page,'設定'); await page.getByRole('button', { name: '登出並清除畫面' }).click();
  const arrived = page.waitForResponse('**/api/query'); response.resolve(); await arrived;
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await expect(page.getByRole('link', { name: '使用 Google 登入' })).toBeVisible();
  await expect(page.getByText('late-private-marker')).toHaveCount(0); await expect(page.getByRole('alert')).toHaveCount(0);
});

test('bfcache restoration clears private input before rechecking auth; revoked auth stays cleared', async ({ page }) => {
  let reject = false; const started = deferred(), response = deferred();
  await browserFixture(page, async (route,path) => {
    if (path !== '/api/me' || !reject) return false;
    started.resolve(); await response.promise; await route.fulfill({ status:401, json:{ error:{ code:'UNAUTHORIZED', message:'請重新登入' } } }); return true;
  });
  await page.getByLabel('貼上英文').fill('bfcache-private-marker'); reject = true;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted:true })));
  await started.promise; await expect(page.getByLabel('貼上英文')).toHaveCount(0);
  response.resolve(); await expect(page.getByRole('link', { name:'使用 Google 登入' })).toBeVisible();
  await expect(page.getByText('bfcache-private-marker')).toHaveCount(0);
});

test('storage event clears other tabs when BroadcastChannel is unavailable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'BroadcastChannel', { value: undefined }); });
  await browserFixture(page);
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key:'en-dic-logout', newValue:'synthetic-event' })));
  await expect(page.getByRole('link', { name:'使用 Google 登入' })).toBeVisible();
});

test('late export response cannot download private data after logout', async ({ page }) => {
  const started = deferred(), response = deferred(); let downloads = 0;
  page.on('download', () => downloads++);
  await browserFixture(page, async (route,path) => {
    if (path !== '/api/export') return false; started.resolve(); await response.promise;
    await route.fulfill({ json:{ entries:[sampleEntry('private-export-marker')] } }); return true;
  });
  await navigate(page,'設定'); await page.getByRole('button', { name:'匯出完整收藏 JSON' }).click(); await started.promise;
  await page.getByRole('button', { name:'登出並清除畫面' }).click();
  const arrived = page.waitForResponse('**/api/export'); response.resolve(); await arrived;
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(downloads).toBe(0); await expect(page.getByRole('link', { name:'使用 Google 登入' })).toBeVisible();
});

test('late entry detail response cannot reopen private detail after logout', async ({ page }) => {
  const started = deferred(), response = deferred();
  const f = await browserFixture(page, async (route,path) => {
    if (!path.startsWith('/api/entries/')) return false; started.resolve(); await response.promise;
    await route.fulfill({ json:sampleEntry('private-detail-marker') }); return true;
  });
  const entry = sampleEntry(); f.entries.set(entry.id,entry);
  await navigate(page,'歷史'); await page.locator('.entry-row').click(); await started.promise;
  await navigate(page,'設定'); await page.getByRole('button', { name:'登出並清除畫面' }).click();
  const arrived = page.waitForResponse('**/api/entries/*'); response.resolve(); await arrived;
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await expect(page.getByText('private-detail-marker')).toHaveCount(0); await expect(page.getByRole('link', { name:'使用 Google 登入' })).toBeVisible();
});

test('a newly opened tab also stays locked after failed logout until explicit login', async ({ page,context }) => {
  await browserFixture(page, async (route,path) => { if (path !== '/api/logout') return false; await route.abort('failed'); return true; });
  await navigate(page,'設定'); await page.getByRole('button', { name:'登出並清除畫面' }).click(); await expect(page.getByRole('alert')).toContainText('伺服器登出尚未完成');
  const second = await context.newPage(); let me = 0;
  await second.route('**/api/**', async route => { if (new URL(route.request().url()).pathname === '/api/me') me++; await route.fulfill({ json:{ signedIn:true } }); });
  await second.goto('/'); await expect(second.getByRole('link', { name:'使用 Google 登入' })).toBeVisible(); expect(me).toBe(0);
});
