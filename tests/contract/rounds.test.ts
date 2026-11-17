import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app.js';
import type { AppConfig } from '../../backend/src/config.js';
import type { Worksheet } from '../../shared/api.js';

const config: AppConfig = { teacherPassword: 'teacher-round-secret', groupCodes: new Map([['a', 'alpha-round-secret'], ['b', 'beta-round-secret'], ['c', 'gamma-round-secret']]), port: 0 };
const worksheet: Worksheet = { source: { documentId: 'local-test', sheetId: 2, sheetTitle: '題組樣本', importedAt: 10 }, fills: [
  { id: 'f1', questionId: '1（1）', mainQuestionId: '1', subQuestionId: '1', unitId: 'u', row: 2, column: 2, originalValue: '', originalType: 'string', identitySource: 'header' },
  { id: 'f2', questionId: '1（2）', mainQuestionId: '1', subQuestionId: '2', unitId: 'u', row: 3, column: 2, originalValue: '', originalType: 'string', identitySource: 'header' },
], units: [{ id: 'u', name: '第一題', questionIds: ['1（1）', '1（2）'], fillBlankIds: ['f1', 'f2'] }] };
let writebackCalls = 0;
const { app } = createApp(config, {
  importWorksheet: async () => ({ worksheet }),
  writeback: async rounds => { writebackCalls += 1; expect(rounds).toHaveLength(1); return { written: ['1（1）', '1（2）'], alreadyMatched: [], noWinner: [] }; },
});
let server: ReturnType<typeof app.listen>; let base = '';
const token = (role: string, secret: string) => `Basic ${Buffer.from(`${role}:${secret}`).toString('base64')}`;
beforeAll(async () => { server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function session(role: string, secret: string) {
  const response = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: token(role, secret) } });
  return (await response.json()) as { activityId: string; role: string; groupId?: string };
}
function headers(auth: string, activityId: string): Record<string, string> { return { Authorization: auth, 'X-Activity-Id': activityId }; }

describe('完整課堂回合 HTTP 流程', () => {
  it('教師與兩組獨立登入、整組收件、結束後公布結果並鎖定名單', async () => {
    const teacher = await session('teacher', config.teacherPassword);
    const roster = await fetch(`${base}/api/roster`, { method: 'PUT', headers: { ...headers(token('teacher', config.teacherPassword), teacher.activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }] }) });
    expect(roster.status).toBe(200);
    const studentA = await session('student', 'alpha-round-secret');
    const studentB = await session('student', 'beta-round-secret');
    expect(studentA.groupId).toBe('a'); expect(studentB.groupId).toBe('b');
    const update = await fetch(`${base}/api/roster`, { method: 'PUT', headers: { ...headers(token('teacher', config.teacherPassword), teacher.activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }, { id: 'c', name: '丙組' }] }) });
    expect(update.status).toBe(200);
    const studentC = await session('student', 'gamma-round-secret'); expect(studentC.groupId).toBe('c');
    const imported = await fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { ...headers(token('teacher', config.teacherPassword), teacher.activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'local' }) });
    expect(imported.status).toBe(200);
    const prepared = await fetch(`${base}/api/rounds`, { method: 'POST', headers: { ...headers(token('teacher', config.teacherPassword), teacher.activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ unitId: 'u' }) });
    const round = await prepared.json() as { id: string };
    const started = await fetch(`${base}/api/rounds/${round.id}/start`, { method: 'POST', headers: headers(token('teacher', config.teacherPassword), teacher.activityId) });
    expect(started.status).toBe(200);
    const hidden = await fetch(`${base}/api/view`, { headers: headers(token('student', 'beta-round-secret'), studentB.activityId) });
    const studentView = await hidden.json() as { version: number; phase: string }; expect(studentView).not.toHaveProperty('availableUnits'); expect(studentView).not.toHaveProperty('groups');
    const pendingB = fetch(`${base}/api/view?after=${studentView.version}`, { headers: headers(token('student', 'beta-round-secret'), studentB.activityId) });
    const partial = await fetch(`${base}/api/rounds/${round.id}/submissions`, { method: 'POST', headers: { ...headers(token('student', 'alpha-round-secret'), studentA.activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: [{ questionId: '1（1）', text: 'CPU' }] }) });
    expect(partial.status).toBe(422); expect((await partial.json()).message).toContain('1（2）');
    const accepted = await fetch(`${base}/api/rounds/${round.id}/submissions`, { method: 'POST', headers: { ...headers(token('student', 'alpha-round-secret'), studentA.activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: [{ questionId: '1（1）', text: 'CPU' }, { questionId: '1（2）', text: '中央處理器' }] }) });
    expect(accepted.status).toBe(201); expect(await accepted.json()).toEqual({ roundId: round.id, received: true });
    const hiddenUpdate = await Promise.race([pendingB.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 150))]);
    expect(hiddenUpdate).toBe(false);
    const duplicate = await fetch(`${base}/api/rounds/${round.id}/submissions`, { method: 'POST', headers: { ...headers(token('student', 'alpha-round-secret'), studentA.activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: [{ questionId: '1（1）', text: '改寫' }, { questionId: '1（2）', text: '改寫' }] }) });
    expect(duplicate.status).toBe(409);
    const locked = await fetch(`${base}/api/roster`, { method: 'PUT', headers: { ...headers(token('teacher', config.teacherPassword), teacher.activityId), 'Content-Type': 'application/json' }, body: JSON.stringify({ groups: [] }) });
    expect(locked.status).toBe(409);
    const beforeEnd = performance.now();
    const ended = await fetch(`${base}/api/rounds/${round.id}/end`, { method: 'POST', headers: headers(token('teacher', config.teacherPassword), teacher.activityId) });
    expect(ended.status).toBe(200);
    const published = await pendingB; expect(published.status).toBe(200); expect((await published.json()).phase).toBe('idle');
    expect(performance.now() - beforeEnd).toBeLessThan(1_000);
    const results = await fetch(`${base}/api/rounds/${round.id}/results`, { headers: headers(token('student', 'beta-round-secret'), studentB.activityId) });
    expect(await results.json()).toEqual([
      { questionId: '1（1）', groups: [{ groupId: 'a', groupName: '甲組', answer: 'CPU', rank: 1, status: '已送出' }, { groupId: 'b', groupName: '乙組', answer: '', rank: null, status: '未送出' }, { groupId: 'c', groupName: '丙組', answer: '', rank: null, status: '未送出' }] },
      { questionId: '1（2）', groups: [{ groupId: 'a', groupName: '甲組', answer: '中央處理器', rank: 1, status: '已送出' }, { groupId: 'b', groupName: '乙組', answer: '', rank: null, status: '未送出' }, { groupId: 'c', groupName: '丙組', answer: '', rank: null, status: '未送出' }] },
    ]);
    const csv = await fetch(`${base}/api/results.csv`, { headers: headers(token('teacher', config.teacherPassword), teacher.activityId) });
    expect(csv.status).toBe(200); expect(csv.headers.get('content-disposition')).toContain('classroom-results.csv'); expect(await csv.text()).toContain('中央處理器');
    const studentWriteback = await fetch(`${base}/api/worksheet/writeback`, { method: 'POST', headers: headers(token('student', 'alpha-round-secret'), studentA.activityId) });
    expect(studentWriteback.status).toBe(403);
    const writeback = await fetch(`${base}/api/worksheet/writeback`, { method: 'POST', headers: headers(token('teacher', config.teacherPassword), teacher.activityId) });
    expect(writeback.status).toBe(200); expect(await writeback.json()).toMatchObject({ written: ['1（1）', '1（2）'] }); expect(writebackCalls).toBe(1);
  });
});
