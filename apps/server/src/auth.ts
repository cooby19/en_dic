import { createHash, randomBytes } from 'node:crypto';
import type { Config } from './config.js';
import { AppError } from './errors.js';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export interface Identity { id: string; email: string; }
export interface AuthProvider { authorize(verifier: string, callback: string): string; exchange(code: string, verifier: string): Promise<Identity>; }
export function supabaseAuth(config: Config, fetcher = fetch): AuthProvider {
  const base = config.supabaseUrl.replace(/\/$/, '');
  const headers = { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' };
  return {
    authorize(verifier, callback) {
      const url = new URL(`${base}/auth/v1/authorize`);
      url.search = new URLSearchParams({ provider: 'google', redirect_to: callback, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 's256', scopes: 'email' }).toString();
      return url.toString();
    },
    async exchange(code, verifier) {
      const response = await fetcher(`${base}/auth/v1/token?grant_type=pkce`, { method: 'POST', headers, body: JSON.stringify({ auth_code: code, code_verifier: verifier }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new AppError(401, 'LOGIN_FAILED', '登入未完成或已逾時，請再試一次。');
      const result = await response.json() as { access_token?: string };
      if (!result.access_token) throw new AppError(401, 'LOGIN_FAILED', '登入驗證失敗。');
      // Ask the auth server for the verified identity; do not trust user_metadata or browser claims.
      const verified = await fetcher(`${base}/auth/v1/user`, { headers: { ...headers, Authorization: `Bearer ${result.access_token}` }, signal: AbortSignal.timeout(15000) });
      if (!verified.ok) throw new AppError(401, 'LOGIN_FAILED', '登入驗證失敗。');
      const user = await verified.json() as { id: string; email?: string; email_confirmed_at?: string; identities?: { provider: string }[] };
      if (!user.email || !user.email_confirmed_at || !user.identities?.some(x => x.provider === 'google')) throw new AppError(403, 'INVITE_REQUIRED', '請使用受邀的 Google 帳號。');
      return { id: user.id, email: user.email.toLowerCase() };
    },
  };
}
