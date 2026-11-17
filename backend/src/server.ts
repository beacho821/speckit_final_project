import { createApp } from './app.js';
import { loadConfig } from './config.js';

try {
  process.loadEnvFile();
  const config = loadConfig();
  const { app } = createApp(config);
  app.listen(config.port, '127.0.0.1', () => console.info(`本機搶答服務已啟動：http://127.0.0.1:${config.port}`));
} catch (error) {
  console.error(error instanceof Error ? error.message : '服務設定錯誤，請檢查環境變數。');
  process.exitCode = 1;
}
