import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { basic } from '../helpers/classroom.js';

let child: ChildProcess | undefined, folder: string | undefined;
async function removeFixture() {
  if (!folder) return;
  const root = resolve(process.cwd()), target = resolve(folder);
  if (!target.startsWith(`${root}${sep}.tmp-classroom-dev-`)) throw new Error('拒絕移除專案目錄外的測試資料。');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); return; }
    catch (error) { if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt === 9) throw error; await new Promise(resolveDelay => setTimeout(resolveDelay, 100)); }
  }
}
async function stopChild(signal: NodeJS.Signals = 'SIGTERM') { const processToStop = child; if (!processToStop || processToStop.exitCode !== null || processToStop.signalCode !== null) return; const exited = new Promise<void>(resolveExit => processToStop.once('exit', () => resolveExit())); processToStop.kill(signal); await exited; }
afterEach(async () => { await stopChild(); await removeFixture(); child = undefined; folder = undefined; });
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await new Promise<void>(r => s.once('listening', r)); const port = (s.address() as { port: number }).port; await new Promise<void>(r => s.close(() => r())); return port; }
async function launch(filePassword?: string, externalPassword?: string, occupied?: {api?:number;vite?:number}) {
  folder = await mkdtemp(join(process.cwd(), '.tmp-classroom-dev-'));
  for (const item of ['backend','shared','frontend','scripts','package.json','vite.config.ts']) await cp(join(process.cwd(), item), join(folder, item), { recursive: true });
  const apiPort = occupied?.api ?? await freePort(), port = occupied?.vite ?? await freePort();
  if (filePassword) await writeFile(join(folder, '.env'), `TEACHER_PASSWORD=${filePassword}\nPORT=${apiPort}\n`);
  const env = { ...process.env, PORT: String(apiPort), GROUP_CODES_JSON: '舊錯誤值' }; delete env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (externalPassword) env.TEACHER_PASSWORD = externalPassword; else delete env.TEACHER_PASSWORD;
  child = spawn(process.execPath, ['scripts/dev.mjs','--port',String(port)], { cwd: folder, env, stdio: ['ignore','pipe','pipe'] });
  let output = ''; child.stdout!.on('data', b => { output += String(b); }); child.stderr!.on('data', b => { output += String(b); });
  const ready = async () => { const deadline = Date.now() + 20000; while (!output.includes('課堂活動已啟動') && child!.exitCode === null && Date.now() < deadline) await new Promise(r => setTimeout(r, 30)); };
  await ready(); return { url: `http://127.0.0.1:${port}`, output: () => output, apiPort };
}
describe('單指令開發啟動', () => {
  it('根 .env 可登入，代理非預設 API；外部密碼優先且停止清埠', async () => {
    const original = randomUUID(), override = randomUUID(); const run = await launch(original, override);
    expect(run.output().includes('課堂活動已啟動')).toBe(true);
    expect((await fetch(run.url)).status).toBe(200);
    const auth = { Authorization: basic('teacher', override) };
    const response = await fetch(run.url + '/api/sessions', { method:'POST', headers:auth }); expect(response.status).toBe(200);
    expect((await fetch(run.url + '/api/sessions', {method:'POST',headers:{Authorization:basic('teacher',original)}})).status).toBe(401);
    expect(run.output().includes(original) || run.output().includes(override)).toBe(false);
    const firstRoom = await (await fetch(run.url + '/api/classrooms', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '啟動測試教室' }) })).json();
    await writeFile(join(folder!,'frontend/src/App.tsx'), await (await import('node:fs/promises')).readFile(join(folder!,'frontend/src/App.tsx'),'utf8')+'\n');
    const same=await(await fetch(run.url+'/api/classrooms/'+firstRoom.id,{headers:auth})).json();expect(same.activityId).toBe(firstRoom.activityId);
    child!.kill('SIGTERM'); await new Promise(r => child!.once('exit', r));
    await expect(fetch(`http://127.0.0.1:${run.apiPort}/api/sessions`)).rejects.toThrow();
  },30000);
  it('僅 .env 密碼也可登入，不需要環境組碼', async () => { const password=randomUUID(); const run=await launch(password); expect(run.output().includes('課堂活動已啟動')).toBe(true); expect((await fetch(run.url+'/api/sessions',{method:'POST',headers:{Authorization:basic('teacher',password)}})).status).toBe(200); },30000);
  it('沒有 .env 但外部設定完整可啟動', async () => { const run=await launch(undefined,randomUUID()); expect(run.output().includes('課堂活動已啟動')).toBe(true); },30000);
  it('缺必要設定退出，且不留下半啟動服務', async () => { const run=await launch(); expect(child!.exitCode).not.toBeNull(); expect(run.output()).toContain('TEACHER_PASSWORD'); expect(run.output().includes('課堂活動已啟動')).toBe(false); },30000);
});

it('API或Vite連接埠衝突會非零退出並清理已開服務',async()=>{
 for(const kind of ['api','vite'] as const){
 const blocker=createServer();blocker.listen(0,'127.0.0.1');await new Promise<void>(r=>blocker.once('listening',r));const port=(blocker.address() as {port:number}).port;
 try{const run=await launch(undefined,randomUUID(),{[kind]:port});expect(child!.exitCode).not.toBeNull();expect(child!.exitCode).not.toBe(0);expect(run.output()).not.toContain('課堂活動已啟動');if(kind==='vite')await expect(fetch(`http://127.0.0.1:${run.apiPort}`)).rejects.toThrow();}finally{await new Promise<void>(r=>blocker.close(()=>r()));await removeFixture();folder=undefined;child=undefined;}
 }
},30000);
it('SIGINT清埠且再次啟動產生不同活動ID',async()=>{const password=randomUUID();const one=await launch(undefined,password);const headers={Authorization:basic('teacher',password)};const first=await(await fetch(one.url+'/api/classrooms',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name:'第一間'})})).json();child!.kill('SIGINT');await new Promise(r=>child!.once('exit',r));await expect(fetch(`http://127.0.0.1:${one.apiPort}`)).rejects.toThrow();await removeFixture();folder=undefined;child=undefined;const two=await launch(undefined,password);const second=await(await fetch(two.url+'/api/classrooms',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name:'第二間'})})).json();expect(second.activityId).not.toBe(first.activityId);},30000);
