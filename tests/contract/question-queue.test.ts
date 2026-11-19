import { expect, it } from 'vitest';
import { classroom } from '../helpers/classroom';
import { worksheet } from '../helpers/worksheet';

it('首次匯入保留手動題，舊版本無法移動清單或開題，重匯須確認', async () => {
  const c = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }) });
  try {
    const manual = await c.request('/questions', c.teacher, { catalogRevision: 0, prompt: '補充題', acceptedAnswersText: '答案' }, 'POST');
    expect(manual.status).toBe(201);
    const manualId = (await manual.json()).unitId;
    const view = () => c.request('/view').then(result => result.json());
    const importSheet = async (confirm = false) => c.rawRequest('/worksheet/import', {
      ...c.teacher, 'X-Catalog-Revision': String((await view()).catalogRevision),
      ...(confirm ? { 'X-Confirm-Worksheet-Replacement': 'true' } : {}),
    }, { url: '測試來源' }, 'POST');
    expect((await importSheet()).status).toBe(200);
    const snapshot = await view();
    expect(snapshot.queueUnitIds).toEqual([manualId]);
    expect((await c.request('/question-queue', c.teacher, { unitId: 'u', catalogRevision: snapshot.catalogRevision }, 'POST')).status).toBe(200);
    expect((await view()).queueUnitIds).toEqual(['u', manualId]);
    const live = await view();
    const mixed = await c.rawRequest('/question-queue', c.teacher,
      { worksheetUnitIds: [manualId], catalogRevision: live.catalogRevision }, 'PUT');
    expect(mixed.status).toBe(422);
    expect((await view()).queueUnitIds).toEqual(['u', manualId]);
    expect((await c.request('/rounds/open-next', c.teacher, { unitId: 'u', catalogRevision: snapshot.catalogRevision }, 'POST')).status).toBe(409);
    expect((await importSheet()).status).toBe(409);
    expect((await view()).queueUnitIds).toEqual(['u', manualId]);
    expect((await importSheet(true)).status).toBe(200);
    expect((await view()).queueUnitIds).toEqual([]);
    expect((await view()).questionCards.map((card: { id: string }) => card.id)).toEqual(['u']);
  } finally { await c.close(); }
});

it('同一清單版本並行開題只成功一次，學生歷史各自顯示本組答案', async () => {
  const c = await classroom();
  try {
    const first = await c.group('甲組');
    const second = await c.group('乙組');
    const third = await c.group('丙組');
    const students = await Promise.all([c.student(first.joinCode), c.student(second.joinCode), c.student(third.joinCode)]);
    const created = await c.rawRequest('/questions', c.teacher, { catalogRevision: 0, prompt: '請答題', acceptedAnswersText: '標準答案' }, 'POST');
    const question = await created.json();
    const open = () => c.rawRequest('/rounds/open-next', c.teacher, { unitId: question.unitId, catalogRevision: 1 }, 'POST');
    const attempts = await Promise.all([open(), open()]);
    expect(attempts.map(item => item.status).sort()).toEqual([201, 409]);
    const round = await attempts.find(item => item.status === 201)!.json();
    expect(round.sequenceNumber).toBe(1);
    const results = `/rounds/${round.id}/results`;
    expect((await c.rawRequest(results, students[0].headers)).status).toBe(403);
    const blank = await c.rawRequest(`/rounds/${round.id}/submissions`, students[0].headers,
      { answers: [{ questionId: question.questionId, text: ' ' }] }, 'POST');
    expect(blank.status).toBe(422);
    expect(await blank.json()).toMatchObject({ message: expect.stringContaining('第 1 題'),
      details: { missingQuestionIds: [question.questionId] } });
    expect(c.activity.rounds.at(-1)?.submissions).toHaveLength(0);
    for (const [index, student] of students.slice(0, 2).entries()) {
      const submitted = await c.rawRequest(`/rounds/${round.id}/submissions`, student.headers, {
        answers: [{ questionId: question.questionId, text: index === 0 ? '標準答案' : '乙組私有作答' }],
      }, 'POST');
      expect(submitted.status).toBe(201);
    }
    await c.finishRound(round.id);
    const a = await (await c.rawRequest(results, students[0].headers)).json();
    const b = await (await c.rawRequest(results, students[1].headers)).json();
    expect(a).toEqual([{ questionNumber: 1, partNumber: null, prompt: '請答題', ownAnswer: '標準答案', correct: true, publishedAnswer: null }]);
    expect(b).toEqual([{ questionNumber: 1, partNumber: null, prompt: '請答題', ownAnswer: '乙組私有作答', correct: false, publishedAnswer: '標準答案' }]);
    const unanswered = await (await c.rawRequest(results, students[2].headers)).json();
    expect(unanswered[0]).toMatchObject({ ownAnswer: null, correct: null, publishedAnswer: '標準答案' });
    expect((await (await c.rawRequest(results)).json())[0].groups).toHaveLength(3);
  } finally { await c.close(); }
});

it('題組漏答使用正式部分序號並保留傳輸識別', async () => {
  const c = await classroom({ importWorksheet: async () => ({ worksheet: structuredClone(worksheet) }) });
  try {
    const group = await c.group();
    const student = await c.student(group.joinCode);
    expect((await c.request('/worksheet/import', c.teacher, { url: '測試題組' }, 'POST')).status).toBe(200);
    const prepared = await c.request('/rounds', c.teacher, { unitId: 'u' }, 'POST');
    expect(prepared.status).toBe(201);
    const round = await prepared.json();
    expect((await c.startConfiguredRound(round.id)).status).toBe(200);
    const answer = await c.rawRequest(`/rounds/${round.id}/submissions`, student.headers,
      { answers: [{ questionId: worksheet.units[0].questionIds[0], text: '答案' }] }, 'POST');
    expect(answer.status).toBe(422);
    expect(await answer.json()).toMatchObject({ message: expect.stringContaining('第 1 題，第 2 部分'),
      details: { missingQuestionIds: [worksheet.units[0].questionIds[1]] } });
    expect(c.activity.rounds.at(-1)?.submissions).toHaveLength(0);
  } finally { await c.close(); }
});
