import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect } from '@playwright/test';
import { browserFixture, navigate, sampleEntry } from './browser-fixture.js';

for (const width of [375,390,1440]) test(`query, favorites, notes, review and export at ${width}px without overflow`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width < 760 ? 844 : 1000 });
  const f = await browserFixture(page);
  const original = 'A'.repeat(2800)+'\nA little understanding.尾端';
  await page.getByLabel('貼上英文').fill(original); await page.locator('summary').click(); await page.getByLabel('上下文', { exact:true }).fill('Synthetic context');
  await page.getByRole('button', { name:'翻譯與解析' }).click(); await expect(page.locator('.result-card .original')).toHaveText(original);
  await page.getByRole('button', { name:'收藏這次理解' }).click(); await expect(page.getByRole('button', { name:'已收藏 · 取消收藏' })).toBeVisible();
  const directory = join(tmpdir(),'en-dic-visual'); mkdirSync(directory,{ recursive:true });
  const image = join(directory,`query-${width}.png`); await page.screenshot({ path:image,fullPage:true }); await info.attach(`query-${width}`,{ path:image,contentType:'image/png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await navigate(page,'收藏'); await page.getByLabel('搜尋英文或中文').fill('理解'); await expect(page.locator('.entry-row')).toHaveCount(1);
  await page.locator('.entry-row').click(); await expect(page.locator('.result-card .original')).toHaveText(original);
  await page.getByLabel('來源', { exact:true }).fill('Synthetic article'); await page.getByLabel('我的備註').fill('Synthetic reminder'); await page.getByRole('button', { name:'儲存備註' }).click(); await expect(page.getByRole('status')).toHaveText('已同步');
  await navigate(page,'複習'); await expect(page.getByText('一點理解。', { exact:true })).toHaveCount(0); await page.getByRole('button', { name:'想好了，揭示答案' }).click(); await expect(page.getByText('一點理解。', { exact:true })).toBeVisible(); await page.getByRole('button', { name:'還不熟', exact:true }).click(); await expect(page.getByText('這一輪，完成了。')).toBeVisible();
  await navigate(page,'設定'); const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name:'匯出完整收藏 JSON' }).click(); const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('english-collection.json'); const file = await download.path(); const exported = JSON.parse(readFileSync(file!,'utf8'));
  expect(exported.entries[0]).toMatchObject({ original, context:'Synthetic context', source:'Synthetic article', notes:'Synthetic reminder', review:'learning' });
  expect(JSON.stringify(exported)).not.toMatch(/apiKey|credential|session|synthetic-test-key/i);
  const settings = join(directory,`settings-${width}.png`); await page.screenshot({ path:settings,fullPage:true }); await info.attach(`settings-${width}`,{ path:settings,contentType:'image/png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(f.entries.size).toBe(1);
});

test('history, unfavorite, search empty state, and confirmed deletion', async ({ page }) => {
  await browserFixture(page); await page.getByLabel('貼上英文').fill('A little understanding.'); await page.getByRole('button', { name:'翻譯與解析' }).click();
  await navigate(page,'歷史'); await expect(page.locator('.entry-row')).toHaveCount(1); await page.locator('.entry-row').click();
  await page.getByRole('button', { name:'加入收藏',exact:true }).click(); await page.getByRole('button', { name:'已收藏 · 取消收藏' }).click(); await expect(page.getByText(/到期/).first()).toBeVisible();
  await page.getByRole('button', { name:'刪除這筆紀錄' }).click(); await page.getByRole('button', { name:'取消',exact:true }).click(); await expect(page.locator('.result-card .original')).toBeVisible();
  await page.getByRole('button', { name:'刪除這筆紀錄' }).click(); await page.getByRole('button', { name:'確認刪除' }).click(); await expect(page.locator('.entry-row')).toHaveCount(0);
  await page.getByLabel('搜尋英文或中文').fill('missing'); await expect(page.getByText('還沒有符合的內容')).toBeVisible();
});

test('disconnected model still permits saved favorites, and API network failure offers retry', async ({ page }) => {
  let network = false;
  const f = await browserFixture(page, async (route,path) => { if (path !== '/api/entries' || !network) return false; await route.abort('failed'); return true; });
  const favorite = { ...sampleEntry(),favorite:true,expiresAt:null,favoritedAt:new Date().toISOString() }; f.entries.set(favorite.id,favorite);
  await navigate(page,'設定'); await page.getByRole('button', { name:'解除連接' }).click(); await expect(page.getByRole('status')).toContainText('收藏仍可查看');
  await navigate(page,'收藏'); await expect(page.locator('.entry-row')).toHaveCount(1);
  network = true; await page.getByLabel('搜尋英文或中文').fill('retry'); await expect(page.getByRole('alert')).toContainText('無法連線');
  network = false; await page.getByLabel('搜尋英文或中文').fill('understanding'); await expect(page.locator('.entry-row')).toHaveCount(1);
});

for (const speech of ['unsupported','no-english','english']) test(`speech fallback: ${speech}`, async ({ page }) => {
  await page.addInitScript(mode => {
    if (mode === 'unsupported') { delete (window as unknown as Record<string,unknown>).speechSynthesis; return; }
    Object.defineProperty(window,'speechSynthesis',{ value:{ getVoices:() => mode === 'english' ? [{ lang:'en-US' }] : [{ lang:'zh-TW' }], cancel:() => {}, speak:() => { (window as unknown as Record<string,unknown>).spoken = true; } } });
    Object.defineProperty(window,'SpeechSynthesisUtterance',{ value:class { constructor(public text:string) {} } });
  },speech);
  await browserFixture(page); await page.getByLabel('貼上英文').fill('hello'); await page.getByRole('button', { name:'翻譯與解析' }).click(); await page.getByRole('button', { name:'播放英文發音' }).click();
  if (speech === 'english') expect(await page.evaluate(() => (window as unknown as Record<string,unknown>).spoken)).toBe(true);
  else await expect(page.getByRole('status')).toContainText(speech === 'unsupported' ? '不支援英文發音' : '沒有可用英文語音');
});

test('query form works with desktop keyboard focus and Enter', async ({ page }) => {
  await browserFixture(page); const original = page.getByLabel('貼上英文'); await original.fill('hello'); await original.focus(); await page.keyboard.press('Tab'); await expect(page.locator('summary')).toBeFocused();
  await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await expect(page.getByLabel('上下文', { exact:true })).toBeFocused(); await page.keyboard.type('A greeting.'); await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name:'翻譯與解析' })).toBeFocused(); await page.keyboard.press('Enter'); await expect(page.getByRole('button', { name:'收藏這次理解' })).toBeVisible();
});
