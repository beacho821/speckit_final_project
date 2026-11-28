import { expect, it } from 'vitest';
import { classroom } from '../helpers/classroom';

it('取消資格會重算補答和勝組，原始收件順位仍可查', async () => {
  const c = await classroom();
  try {
    const group = await c.group();
    const member = await c.student(group.joinCode);
    const added = await (await c.request('/questions', c.teacher, { questionId: '1', prompt: '請填寫測試答案。' }, 'POST')).json();
    const round = await (await c.request('/rounds', c.teacher, { unitId: added.unitId }, 'POST')).json();
    await c.startConfiguredRound(round.id);
    const path = '/rounds/' + round.id;
    await c.request(path + '/submissions', member.headers, { answers: [{ questionId: added.questionId, text: '答案' }] }, 'POST');
    await c.request(path + '/end', c.teacher, undefined, 'POST');
    const edit = (rev: number, disqualified: boolean) => c.request(path + '/review', c.teacher, { reviewRevision: rev, eligibility: [{ groupId: group.id, disqualified }] }, 'PATCH');
    expect(await (await edit(0, true)).json()).toMatchObject({
      missingSupplementQuestionIds: [], supplements: [{ questionId: added.questionId, text: '答案' }],
    });
    const stale = await edit(0, false);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'REVIEW_REVISION_CHANGED' });
    expect(await (await c.request('/view', c.teacher)).json()).toMatchObject({ review: { reviewRevision: 1 }, groups: [{ disqualified: true }] });
    expect(await (await c.request('/view', member.headers)).json()).not.toHaveProperty('review');
    expect((await c.request(path + '/results', c.teacher)).status).toBe(403);
    expect(await (await edit(1, false)).json()).toMatchObject({ missingSupplementQuestionIds: [] });
    await edit(2, true);
    await c.publishReviewedRound(round.id);
    const result = await (await c.request(path + '/results')).json();
    expect(result[0]).toMatchObject({ winnerGroupId: null, teacherAnswer: '答案', groups: [{ rank: 1, status: '已取消資格', answer: '答案' }] });
  } finally { await c.close(); }
});

it('競爭改判僅接受同版本的一次更新，最早符合資格的全對組獲勝', async () => {
  const c = await classroom();
  try {
    const first = await c.group('甲組');
    const second = await c.group('乙組');
    const absent = await c.group('未收件組');
    const a = await c.student(first.joinCode);
    const b = await c.student(second.joinCode);
    const { unitId, questionId } = await (await c.request('/questions', c.teacher, { questionId: '1', prompt: '請填寫答案。' }, 'POST')).json();
    const { id } = await (await c.request('/rounds', c.teacher, { unitId }, 'POST')).json();
    const path = '/rounds/' + id;
    expect((await c.startConfiguredRound(id)).ok).toBe(true);
    for (const [student, text] of [[a, '合理的同義原答'], [b, '答案']] as const) {
      expect((await c.request(path + '/submissions', student.headers, { answers: [{ questionId, text }] }, 'POST')).ok).toBe(true);
    }
    await c.request(path + '/end', c.teacher, undefined, 'POST');
    const grade = { groupId: first.id, questionId, correct: true };
    const review = (revision: number, changes: object, headers = c.teacher) =>
      c.request(path + '/review', headers, { reviewRevision: revision, ...changes }, 'PATCH');
    const view = async () => (await c.request('/view', c.teacher)).json();
    const before = await view();
    expect((await review(0, { grades: [grade] }, a.headers)).status).toBe(403);
    expect((await review(0, { grades: [grade, { ...grade, groupId: absent.id }] })).status).toBe(422);
    expect((await review(0, { grades: [grade, grade] })).status).toBe(422);
    expect(await view()).toMatchObject({ review: before.review, groups: before.groups });
    const reply = await Promise.all([
      review(0, { grades: [grade] }),
      review(0, { eligibility: [{ groupId: second.id, disqualified: true }] }),
    ]);
    expect(reply.map(response => response.status).sort()).toEqual([200, 409]);
    const firstWasSaved = reply[0].status === 200;
    const after = await view();
    expect(after).toMatchObject({ review: { reviewRevision: 1 }, groups: [
      { rank: 1, answers: [{ correct: firstWasSaved, autoCorrect: false, text: '合理的同義原答' }] },
      { rank: 2 },
      { received: false },
    ] });
    expect(after.groups[1].disqualified ?? false).toBe(!firstWasSaved);
    if (!firstWasSaved) {
      expect((await review(1, { grades: [grade], eligibility: [{ groupId: second.id, disqualified: false }] })).status).toBe(200);
    }
    const { review: { reviewRevision } } = await view();
    const noop = await review(reviewRevision, { grades: [grade] });
    expect(await noop.json()).toMatchObject({ reviewRevision });
    expect(await (await c.publishReviewedRound(id)).json()).toMatchObject({ winnerGroupId: first.id });
    expect((await review(reviewRevision, { grades: [{ ...grade, correct: false }] })).status).toBe(409);
    expect(await (await c.request(path + '/results', c.teacher)).json()).toMatchObject([{
      winnerGroupId: first.id, groups: [
        { rank: 1, answer: '合理的同義原答', correct: true },
        { rank: 2, answer: '答案', correct: true },
        { rank: null },
      ],
    }]);
  } finally { await c.close(); }
});
