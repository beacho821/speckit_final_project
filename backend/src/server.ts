import { startServer } from './bootstrap.js';

try {
  const service = await startServer();
  console.info(`本機課堂服務已啟動：http://127.0.0.1:${service.config.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void service.close().finally(() => process.exit(0)); });
} catch (error) {
  console.error(error instanceof Error ? error.message : '服務設定錯誤，請檢查環境變數。');
  process.exitCode = 1;
}
