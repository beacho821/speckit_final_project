import { describe, expect, it } from 'vitest';
import { changed, createActivity } from '../../backend/src/activity.js';
import { prepareRound, startRound, submitAnswers } from '../../backend/src/rounds.js';
import { makeView } from '../../backend/src/views.js';
import type { FillBlank } from '../../shared/api.js';

describe('角色專屬快照', () => {
  it('學生快照不含教師題目清單或他組答案，他組送出不改變本組版本', () => {
    const activity = createActivity(); activity.groups = [{ id: 'a', name: '甲組' }, { id: 'b', name: '乙組' }];
    const fill: FillBlank = { id: 'f', questionId: '1', mainQuestionId: '1', unitId: 'u', row: 1, column: 2, originalValue: '', originalType: 'string', identitySource: 'header' };
    activity.worksheet = { source: { kind: 'google', documentId: 'test', sheetId: 1, sheetTitle: '測試', importedAt: 0 }, fills: [fill], units: [{ id: 'u', name: '題目', questionIds: ['1'], fillBlankIds: ['f'] }] };
    const round = prepareRound(activity, 'u'); startRound(activity, round.id, 0);
    const before = makeView(activity, { role: 'student', groupId: 'b' });
    submitAnswers(activity, round.id, 'a', [{ questionId: '1', text: '保密答案' }], 1);
    const after = makeView(activity, { role: 'student', groupId: 'b' });
    expect(after.version).toBe(before.version); expect(JSON.stringify(after)).not.toContain('保密答案'); expect(after).not.toHaveProperty('availableUnits');
  });
  it('教師快照取得選題及進度，學生加入後名單變動可獨立更新', () => {
    const activity = createActivity(); activity.groups = [{ id: 'a', name: '甲組' }];
    activity.worksheet = { source: { kind: 'google', documentId: 'test', sheetId: 1, sheetTitle: '測試', importedAt: 0 }, fills: [], units: [{ id: 'u', name: '題目', questionIds: ['1'], fillBlankIds: [] }] };
    changed(activity);
    const view = makeView(activity, { role: 'teacher' }); expect(view.availableUnits).toEqual([{ unitId: 'u', questionIds: ['1'] }]); expect(view.groups?.[0].name).toBe('甲組');
  });
});
