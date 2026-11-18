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
    await c.request(path + '/submissions', member.headers, { answers: [{ questionId: '1', text: '答案' }] }, 'POST');
    await c.request(path + '/end', c.teacher, undefined, 'POST');
    const edit = (rev: number, disqualified: boolean) => c.request(path + '/review', c.teacher, { reviewRevision: rev, eligibility: [{ groupId: group.id, disqualified }] }, 'PATCH');
    expect(await (await edit(0, true)).json()).toMatchObject({ missingSupplementQuestionIds: ['1'] });
    expect((await edit(0, false)).status).toBe(409);
    expect(await (await edit(1, false)).json()).toMatchObject({ missingSupplementQuestionIds: [] });
    await edit(2, true);
    await c.publishReviewedRound(round.id);
    const result = await (await c.request(path + '/results')).json();
    expect(result[0]).toMatchObject({ winnerGroupId: null, teacherAnswer: '測試補答', groups: [{ rank: 1, status: '已取消資格', answer: '答案' }] });
  } finally { await c.close(); }
});
