export class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }
export class StaleResponse extends Error {}
let generation = 0;
export function invalidateResponses() { generation++; }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const version = generation;
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...options.headers } }); }
  catch { if (version !== generation) throw new StaleResponse(); throw new ApiError('NETWORK', '無法連線。服務可能正在啟動，請稍候再試。', 0); }
  let result;
  try { result = await response.json(); } catch { if (version !== generation) throw new StaleResponse(); throw new ApiError('INVALID_RESPONSE', '服務回應不完整，請重試。', response.status); }
  if (version !== generation) throw new StaleResponse();
  if (!response.ok) throw new ApiError(result?.error?.code ?? 'FAILED', result?.error?.message ?? '操作失敗，請重試。', response.status);
  return result;
}
export const body = (value: unknown) => JSON.stringify(value);
