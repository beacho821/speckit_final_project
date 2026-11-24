import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { ActivityView } from '../../shared/api.js';
import type { Classrooms } from '../../backend/src/classrooms.js';
import { createApp, type AppServices } from '../../backend/src/app.js';

export const basic = (role: string, value: string) => `Basic ${Buffer.from(`${role}:${value}`).toString('base64')}`;
export function worksheetHeaders(activity: { catalogRevision: number; worksheet: unknown }) {
  return { 'X-Catalog-Revision': String(activity.catalogRevision),
    ...(activity.worksheet ? { 'X-Confirm-Worksheet-Replacement': 'true' } : {}) };
}

export async function classroom(services: AppServices = {}, directory?: Classrooms, teacherPassword = randomUUID()) {
  const config = { teacherPassword, port: 0 };
  const { app, classrooms } = createApp(config, services, directory);
  const room = await classrooms.create('測試教室');
  const activity = room.activity;
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const scope = { 'X-Classroom-Id': room.id, 'X-Activity-Id': activity.id, 'X-Activity-Epoch': classrooms.runtime };
  const teacher = { ...scope, Authorization: basic('teacher', config.teacherPassword) };
  async function rawRequest(path: string, headers: Record<string, string> = teacher, body?: unknown, method = 'GET') {
    return fetch(base + '/api' + path, { method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function request(path: string, headers: Record<string, string> = teacher, body?: unknown, method = 'GET') {
    // 共用測試夾具取得目前版本。契約邊界測試可使用 rawRequest 原樣送出。
    const scopedRoom = headers['X-Classroom-Id'];
    if (headers.Authorization !== teacher.Authorization || !scopedRoom) return rawRequest(path, headers, body, method);
    const target = classrooms.list().some(room => room.id === scopedRoom && !room.unavailable)
      ? classrooms.get(scopedRoom).activity : undefined;
    if (!target) return rawRequest(path, headers, body, method);
    if (method === 'POST' && path === '/worksheet/import') {
      return rawRequest(path, { ...worksheetHeaders(target), ...headers }, body, method);
    }
    const edit = body as Record<string, unknown> | undefined;
    if (edit?.catalogRevision !== undefined) return rawRequest(path, headers, body, method);
    if ((method === 'POST' && (path === '/rounds' || path === '/questions' || /^\/rounds\/[^/]+\/start$/.test(path)))
      || (method === 'PATCH' && path.startsWith('/questions/'))) {
      body = { ...(path === '/questions' ? { acceptedAnswersText: '答案' } : {}), ...edit, catalogRevision: target.catalogRevision };
    }
    return rawRequest(path, headers, body, method);
  }
  async function group(name = '甲組') {
    const response = await request('/groups', teacher, { name }, 'POST');
    if (!response.ok) throw new Error('測試建組失敗');
    return (await response.json()).groups.find((g: { name: string }) => g.name === name) as { id: string; name: string; joinCode: string };
  }
  async function student(joinCode: string, name = '小明') {
    const response = await request('/sessions', { Authorization: basic('student', joinCode) }, { name }, 'POST');
    if (!response.ok) throw new Error('測試加入失敗');
    const session = await response.json();
    return { session, headers: { ...scope, Authorization: basic('student', joinCode), 'X-Member-Id': session.memberId } };
  }
  async function configureRound(answers: (questionId: string) => string = () => '答案') {
    const view = await (await request('/view')).json() as ActivityView;
    for (const question of view.editableQuestions ?? []) {
      const response = await request(`/questions/${question.questionKey}`, teacher, {
        questionRevision: question.questionRevision,
        ...(question.missingPrompt ? { prompt: `測試題目 ${question.questionId}：請填答。` } : {}),
        acceptedAnswersText: answers(question.questionId),
      }, 'PATCH');
      if (!response.ok) throw new Error(`測試備題失敗：${response.status}`);
    }
  }
  async function startConfiguredRound(roundId: string, answers?: (questionId: string) => string) {
    await configureRound(answers);
    return request(`/rounds/${roundId}/start`, teacher, undefined, 'POST');
  }
  async function publishReviewedRound(roundId: string) {
    const view = await (await request('/view')).json() as ActivityView;
    const review = view.review;
    if (view.roundId !== roundId || !review) throw new Error('回合尚未停止收件。');
    const published = await request(`/rounds/${roundId}/publish`, teacher, { reviewRevision: review.reviewRevision }, 'POST');
    if (!published.ok) throw new Error(`測試公布失敗：${published.status}`);
    return published;
  }
  async function finishRound(roundId: string) {
    const stopped = await request(`/rounds/${roundId}/end`, teacher, undefined, 'POST');
    if (!stopped.ok) throw new Error(`測試停止收件失敗：${stopped.status}`);
    return publishReviewedRound(roundId);
  }
  return { app, classrooms, room, activity, config, base, scope, teacher, request, rawRequest, group, student, configureRound, startConfiguredRound, publishReviewedRound, finishRound, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
