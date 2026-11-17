export interface AppConfig { teacherPassword: string; googleServiceAccount?: Record<string, unknown>; port: number }

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少環境變數 ${name}，請設定後重新啟動。`);
  return value;
}

export function loadConfig(): AppConfig {
  const teacherPassword = required('TEACHER_PASSWORD');
  let googleServiceAccount: Record<string, unknown> | undefined;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    try { googleServiceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) as Record<string, unknown>; }
    catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 格式錯誤，請設定有效的服務帳戶 JSON。'); }
    if (!googleServiceAccount || typeof googleServiceAccount !== 'object' || typeof googleServiceAccount.client_email !== 'string' || typeof googleServiceAccount.private_key !== 'string') throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 缺少必要欄位，請確認服務帳戶設定。');
  }
  const rawPort = process.env.PORT?.trim();
  const port = rawPort ? Number(rawPort) : 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必須為 1 至 65535 的整數，請修正環境設定。');
  return { teacherPassword, googleServiceAccount, port };
}
