import { randomUUID } from 'node:crypto';
import { expect, type Page, type Route } from '@playwright/test';
import { DEFAULT_MODEL, RETENTION_MS, type Entry } from '@en-dic/shared';
export function sampleEntry(original = 'A little understanding.'): Entry {
  return { id: randomUUID(), original, context: 'A synthetic learning example.', analysis: { kind: 'sentence', translation: '一點理解。', ambiguity: '', structure: '名詞片語作為獨立句。', vocabulary: [{ english: 'understanding', meaning: '理解' }] }, provider: 'google', model: DEFAULT_MODEL, source: 'Synthetic source', notes: 'Synthetic note', favorite: false, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+RETENTION_MS).toISOString(), favoritedAt: null, review: null, reviewedAt: null, analysisVersion: 1 };
}
export function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
export async function browserFixture(page: Page, intercept?: (route: Route, path: string) => Promise<boolean>) {
  const entries = new Map<string, Entry>(); let connected = true;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (await intercept?.(route, path)) return;
    const connection = { connected, model: DEFAULT_MODEL, version: 1, testedAt: null, status: connected ? 'connected' : 'disconnected' };
    if (path === '/api/me') return route.fulfill({ json: { signedIn: true } });
    if (path === '/api/logout') return route.fulfill({ json: { signedIn: false } });
    if (path === '/api/connection') { if (request.method() === 'DELETE') connected = false; else if (request.method() === 'PUT') connected = true; return route.fulfill({ json: { ...connection, connected } }); }
    if (path === '/api/models') return route.fulfill({ json: { models: [DEFAULT_MODEL] } });
    if (path === '/api/query') { const data = request.postDataJSON(); const entry = { ...sampleEntry(data.original), context: data.context ?? '' }; entries.set(entry.id, entry); return route.fulfill({ json: { entry, existingFavorites: [] } }); }
    if (path === '/api/entries') {
      const favorites = url.searchParams.get('kind') === 'favorites', search = url.searchParams.get('search')?.toLowerCase() ?? '';
      return route.fulfill({ json: { entries: [...entries.values()].filter(x => x.favorite === favorites && `${x.original} ${x.analysis.translation}`.toLowerCase().includes(search)), nextCursor: null } });
    }
    if (path === '/api/review') return route.fulfill({ json: { entries: [...entries.values()].filter(x => x.favorite) } });
    if (path === '/api/export') return route.fulfill({ json: { formatVersion: 1, exportedAt: new Date().toISOString(), entries: [...entries.values()].filter(x => x.favorite) } });
    const id = path.split('/')[3], entry = entries.get(id);
    if (!entry) return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: '找不到紀錄。' } } });
    if (request.method() === 'DELETE') { entries.delete(id); return route.fulfill({ json: { deleted: true } }); }
    if (request.method() === 'PATCH') { const data = request.postDataJSON(); Object.assign(entry, data); if (data.favorite === true) { entry.expiresAt = null; entry.favoritedAt = new Date().toISOString(); } if (data.favorite === false) entry.expiresAt = new Date(Date.now()+RETENTION_MS).toISOString(); }
    if (path.endsWith('/review')) entry.review = request.postDataJSON().review;
    return route.fulfill({ json: entry });
  });
  await page.goto('/'); await expect(page.getByLabel('貼上英文')).toBeVisible();
  return { entries };
}
export async function navigate(page: Page, name: string) { const nav = await page.locator('.bottom-nav').isVisible() ? page.locator('.bottom-nav') : page.locator('.sidebar nav'); await nav.getByRole('button', { name, exact: true }).click(); }
