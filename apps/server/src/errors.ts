export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const missing = () => new AppError(404, 'NOT_FOUND', '找不到紀錄或紀錄已到期。');
export const unauthorized = () => new AppError(401, 'UNAUTHORIZED', '請重新登入，並確認帳號仍在邀請名單。');
