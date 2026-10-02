import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { test, expect } from '@playwright/test';
import { DEFAULT_MODEL } from '@en-dic/shared';
import { sampleEntry } from './browser-fixture.js';

test.use({ serviceWorkers: 'allow' });
let server: Server, origin: string;
test.beforeAll(async () => {
  const root = resolve('apps/web/dist');
  server = createServer((req,res) => {
    const url = new URL(req.url!, 'http://localhost');
    res.setHeader('Cache-Control','private, no-store');
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      res.setHeader('Content-Type','application/json');
      if (url.pathname === '/api/me') return res.end(JSON.stringify({ signedIn:true }));
      if (url.pathname === '/api/connection') return res.end(JSON.stringify({ connected:true,model:DEFAULT_MODEL,version:1,testedAt:null,status:'connected' }));
      if (url.pathname === '/api/export') return res.end(JSON.stringify({ private:'private-export-marker' }));
      if (url.pathname.startsWith('/auth/')) return res.end(JSON.stringify({ private:'private-oauth-marker' }));
      if (url.pathname === '/api/query') {
        let body=''; req.on('data',chunk => body+=chunk); req.on('end',() => { res.end(JSON.stringify({ entry:sampleEntry(JSON.parse(body).original),existingFavorites:[] })); }); return;
      }
      res.statusCode=404; return res.end('{}');
    }
    const file = resolve(root, '.'+ (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root+'/')) { res.statusCode=404; return res.end(); }
    try { res.setHeader('Content-Type', ({ '.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png' } as Record<string,string>)[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file)); }
    catch { res.statusCode=404; res.end(); }
  });
  await new Promise<void>(done => server.listen(0,'127.0.0.1',done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture server unavailable'); origin=`http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((done,reject) => server.close(error => error ? reject(error) : done())); });

test('real service worker caches public shell/assets, excludes API/OAuth/export and shows cleared shell offline', async ({ page,context }) => {
  await page.goto(origin); await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload(); await expect(page.getByLabel('貼上英文')).toBeVisible();
  await page.getByLabel('貼上英文').fill('private-query-marker'); await page.getByRole('button', { name:'翻譯與解析' }).click(); await expect(page.locator('.result-card .original')).toHaveText('private-query-marker');
  await page.evaluate(async () => { await fetch('/api/export').then(x => x.json()); await fetch('/auth/callback?code=synthetic-code').then(x => x.json()); });
  const keys = await page.evaluate(async () => { const keys:string[]=[]; for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) keys.push(request.url); return keys; });
  expect(keys.some(x => new URL(x).pathname.startsWith('/assets/'))).toBe(true);
  expect(keys.some(x => /\/api\/|\/auth\/|export|synthetic-code/.test(x))).toBe(false);
  const bodies = await page.evaluate(async () => { const bodies:string[]=[]; for (const name of await caches.keys()) for (const response of await (await caches.open(name)).matchAll()) if (response.headers.get('Content-Type')?.includes('text/')) bodies.push(await response.text()); return bodies; });
  expect(bodies.join('')).not.toMatch(/private-query-marker|private-export-marker|private-oauth-marker/);
  await context.setOffline(true); await expect(page.getByLabel('貼上英文')).toHaveCount(0); await expect(page.locator('.result-card')).toHaveCount(0);
  // Chromium's network emulation does not reliably preserve navigator.onLine
  // across SW reloads. The actual failed API and cached shell prove offline use.
  await page.reload(); await expect(page.getByRole('alert')).toContainText('無法連線');
  await expect(page.getByRole('link', { name:'使用 Google 登入' })).toBeVisible(); await expect(page.getByText('private-query-marker')).toHaveCount(0);
  await context.setOffline(false); await page.reload(); await expect(page.getByLabel('貼上英文')).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
