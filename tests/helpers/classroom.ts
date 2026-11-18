import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { ActivityView } from '../../shared/api.js';
import { createApp, type AppServices } from '../../backend/src/app.js';

export const basic = (role: string, value: string) => `Basic ${Buffer.from(`${role}:${value}`).toString('base64')}`;
export async function classroom(services: AppServices = {}) {
  const config = { teacherPassword: randomUUID(), port: 0 };
  const { app, activity } = createApp(config, services);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const teacher = { Authorization: basic('teacher', config.teacherPassword), 'X-Activity-Id': activity.id };
  async function request(path: string, headers = teacher, body?: unknown, method = 'GET') {
    return fetch(base + '/api' + path, { method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function group(name = '甲組') {
    const response = await request('/groups', teacher, { name }, 'POST');
    if (!response.ok) throw new Error('測試建組失敗');
    return (await response.json()).groups.find((g: { name: string }) => g.name === name) as { id: string; name: string; joinCode: string };
  }
  async function student(joinCode: string, name = '小明') {
    const response = await request('/sessions', { ...teacher, Authorization: basic('student', joinCode) }, { name }, 'POST');
    if (!response.ok) throw new Error('測試加入失敗');
    const session = await response.json();
    return { session, headers: { Authorization: basic('student', joinCode), 'X-Activity-Id': activity.id, 'X-Member-Id': session.memberId } };
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
    if (!review) throw new Error('回合尚未停止收件。');
    let reviewRevision = review.reviewRevision;
    if (review.missingSupplementQuestionIds.length) {
      const saved = await request(`/rounds/${roundId}/review`, teacher, {
        reviewRevision,
        supplements: review.missingSupplementQuestionIds.map(questionId => ({ questionId, text: '測試補答' })),
      }, 'PATCH');
      if (!saved.ok) throw new Error(`測試補答失敗：${saved.status}`);
      reviewRevision = (await saved.json()).reviewRevision;
    }
    const published = await request(`/rounds/${roundId}/publish`, teacher, { reviewRevision }, 'POST');
    if (!published.ok) throw new Error(`測試公布失敗：${published.status}`);
    return published;
  }
  async function finishRound(roundId: string) {
    const stopped = await request(`/rounds/${roundId}/end`, teacher, undefined, 'POST');
    if (!stopped.ok) throw new Error(`測試停止收件失敗：${stopped.status}`);
    return publishReviewedRound(roundId);
  }
  return { app, activity, config, base, teacher, request, group, student, configureRound, startConfiguredRound, publishReviewedRound, finishRound, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
