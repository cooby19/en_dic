export class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...options.headers } }); }
  catch { throw new ApiError('NETWORK', '無法連線。服務可能正在啟動，請稍候再試。', 0); }
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error?.code ?? 'FAILED', result.error?.message ?? '操作失敗，請重試。', response.status);
  return result;
}
export const body = (value: unknown) => JSON.stringify(value);
