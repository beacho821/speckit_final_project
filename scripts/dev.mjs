import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const typescriptPackage = dirname(fileURLToPath(import.meta.resolve('typescript')));
const tsc = resolve(typescriptPackage, '../bin/tsc');
process.chdir(root);
let api, vite, compiler;
let stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  compiler?.kill();
  await vite?.close();
  await api?.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().finally(() => process.exit(0)); });
try {
  await new Promise((resolve, reject) => {
    compiler = spawn(process.execPath, [tsc, '-p', 'backend/tsconfig.json'], { cwd: root, stdio: 'inherit' });
    compiler.once('error', reject);
    compiler.once('exit', code => code === 0 ? resolve() : reject(new Error('後端編譯失敗，請修正型別錯誤後再啟動。')));
  });
  if (stopping) process.exit(0);
  const { startServer } = await import('../dist/backend/src/bootstrap.js');
  api = await startServer(root);
  const index = process.argv.indexOf('--port');
  const port = index >= 0 ? Number(process.argv[index + 1]) : 5173;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('前端 --port 必須為 1 至 65535 的整數。');
  vite = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), server: { port, strictPort: true, proxy: { '/api': `http://127.0.0.1:${api.config.port}` } } });
  await vite.listen();
  console.info(`課堂活動已啟動：http://127.0.0.1:${port}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : '啟動失敗，請確認本機設定。');
  await close(); process.exitCode = 1;
}
