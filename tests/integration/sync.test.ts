import { describe, expect, it } from 'vitest';
import { identifyWorksheet } from '../../backend/src/worksheet/identify.js';
import { classroom } from '../helpers/classroom.js';
import { makeSimpleWorksheet } from '../fixtures/guided-notes.js';

const within = async <T>(promise: Promise<T>, startedAt: number) => {
  const value = await promise;
  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeLessThan(1000);
  return { value, elapsedMs };
};

describe('授權畫面同步整合', () => {
  it('一師三組五回合只通知可見角色，授權更新於一秒內抵達', async () => {
    let clock = 100;
    const fixture = await makeSimpleWorksheet();
    const c = await classroom({ now: () => clock, importWorksheet: async () => ({ worksheet: {
      source: { kind: 'google', documentId: 'sync-fixture', sheetId: 7, sheetTitle: fixture.sheet.name, importedAt: clock },
      ...identifyWorksheet(fixture.sheet),
    } }) });
    const pending: Promise<unknown>[] = [];
    try {
      const groups = await Promise.all(['甲組', '乙組', '丙組'].map(name => c.group(name)));
      const students = await Promise.all(groups.map((group, index) => c.student(group.joinCode, `${group.name}學生${index + 1}`)));
      await c.request('/worksheet/import', c.teacher, { url: 'fixture' }, 'POST');
      const winners = [0, 1, 2, 0, 1];
      const latencies: number[] = [];

      for (const [roundIndex, winnerIndex] of winners.entries()) {
        const unit = c.activity.worksheet!.units[roundIndex];
        const round = await (await c.request('/rounds', c.teacher, { unitId: unit.id }, 'POST')).json();
        const versions = await Promise.all([c.request('/view'), ...students.map(student => c.request('/view', student.headers))]
          .map(async response => (await (await response).json()).version as number));
        const beforeStart = [
          c.request(`/view?after=${versions[0]}`),
          ...students.map((student, index) => c.request(`/view?after=${versions[index + 1]}`, student.headers)),
        ];
        const startAt = Date.now();
        expect((await c.request(`/rounds/${round.id}/start`, c.teacher, undefined, 'POST')).status).toBe(200);
        const startedViews = await Promise.all(beforeStart.map(promise => within(promise.then(async response => {
          expect(response.status).toBe(200);
          return response.json();
        }), startAt)));
        latencies.push(...startedViews.map(item => item.elapsedMs));
        expect(startedViews.every(({ value }) => value.phase === 'active')).toBe(true);

        const activeViews = await Promise.all([
          c.request('/view'),
          ...students.map(student => c.request('/view', student.headers)),
        ].map(async response => (await (await response).json()) as { version: number }));
        const submissionPolls = activeViews.map((view, index) => {
          const headers = index === 0 ? c.teacher : students[index - 1].headers;
          const request = c.request(`/view?after=${view.version}`, headers).then(async response => ({ response, view: response.status === 200 ? await response.json() : undefined }));
          pending.push(request);
          return request;
        });
        const resultsResponse = await c.request(`/rounds/${round.id}/results`, students[0].headers);
        expect(resultsResponse.status).toBe(403);

        const startSubmission = Date.now();
        const accepted = await c.request(`/rounds/${round.id}/submissions`, students[winnerIndex].headers,
          { answers: unit.questionIds.map(questionId => ({ questionId, text: `第 ${roundIndex + 1} 回合答案 ${questionId}` })) }, 'POST');
        expect(accepted.status).toBe(201);
        const elapsedFromAccept = Date.now();
        const visibleIndexes = [0, winnerIndex + 1];
        for (const index of visibleIndexes) {
          const result = await within(submissionPolls[index], elapsedFromAccept);
          expect(result.value.response.status).toBe(200);
          if (index === 0) expect(result.value.view.groups.find((group: { id: string }) => group.id === groups[winnerIndex].id)).toMatchObject({ received: true, rank: 1 });
          else expect(result.value.view).toMatchObject({ received: true, ownAnswers: expect.any(Array) });
          latencies.push(result.elapsedMs);
        }
        for (const index of [1, 2, 3].filter(index => !visibleIndexes.includes(index))) {
          const quiet = await Promise.race([submissionPolls[index].then(() => false), new Promise<boolean>(resolve => setTimeout(() => resolve(true), 150))]);
          expect(quiet).toBe(true);
        }

        const endVersions = await Promise.all(visibleIndexes.map(async index => {
          const headers = index === 0 ? c.teacher : students[index - 1].headers;
          return (await (await c.request('/view', headers)).json()).version as number;
        }));
        const endPolls = visibleIndexes.map((index, offset) => {
          const headers = index === 0 ? c.teacher : students[index - 1].headers;
          const request = c.request(`/view?after=${endVersions[offset]}`, headers).then(async response => ({ response, view: response.status === 200 ? await response.json() : undefined }));
          pending.push(request);
          return { index, request };
        });
        const beforeEnd = Date.now();
        expect((await c.request(`/rounds/${round.id}/end`, c.teacher, undefined, 'POST')).status).toBe(200);
        for (const index of [0, 1, 2, 3]) {
          const poll = endPolls.find(item => item.index === index)?.request ?? submissionPolls[index];
          const result = await within(poll, beforeEnd);
          expect(result.value.response.status).toBe(200);
          expect(result.value.view.phase).toBe('idle');
          expect(result.value.view.closedRoundIds).toContain(round.id);
          if (index > 0) expect(result.value.view).not.toHaveProperty('groups');
          latencies.push(result.elapsedMs);
        }
        const sealedViews = await Promise.all(students.map(async student => (await (await c.request('/view', student.headers)).json())));
        expect(sealedViews.every(view => view.phase === 'idle' && view.closedRoundIds.includes(round.id))).toBe(true);
        expect(sealedViews.every(view => view.groups === undefined && view.ownAnswers === undefined)).toBe(true);
        expect(Date.now() - startSubmission).toBeLessThan(1000);
        clock += 4000;
      }
      expect(latencies.length).toBeGreaterThanOrEqual(25);
      expect(Math.max(...latencies)).toBeLessThan(1000);
      expect(c.activity.rounds.map(round => round.submissions[0]?.groupId)).toEqual(winners.map(index => groups[index].id));
    } finally {
      await c.close();
      await Promise.allSettled(pending);
    }
  }, 10_000);
});
