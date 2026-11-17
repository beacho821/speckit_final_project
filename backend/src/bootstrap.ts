import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

export function loadEnvironment(root = process.cwd()) {
  try { process.loadEnvFile(resolve(root, '.env')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('無法讀取專案根目錄 .env，請確認檔案與權限。');
  }
}

export async function startServer(root = process.cwd()) {
  loadEnvironment(root);
  const config = loadConfig();
  const { app, activity } = createApp(config);
  const server = app.listen(config.port, '127.0.0.1');
  await new Promise<void>((resolveReady, reject) => { server.once('listening', resolveReady); server.once('error', () => reject(new Error('API 連接埠無法使用，請檢查 PORT 或停止占用的服務。'))); });
  return { server, activity, config, close: async () => { server.closeAllConnections(); await new Promise<void>(resolveDone => server.close(() => resolveDone())); } };
}
