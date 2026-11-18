import { describe, expect, it } from 'vitest';
import { identifyWorksheet } from '../../backend/src/worksheet/identify.js';
import { classroom } from '../helpers/classroom.js';
import { makeSimpleWorksheet } from '../fixtures/guided-notes.js';

describe('完整課堂 HTTP 演練', () => {
  it('一師三組連續五回合、晚加入學生、重新登入、保密與角色同步', async () => {
    let clock = 100;
    const fixture = await makeSimpleWorksheet();
    const c = await classroom({ now: () => clock, importWorksheet: async () => ({ worksheet: {
      source: { kind: 'google', documentId: 'classroom-fixture', sheetId: 7, sheetTitle: fixture.sheet.name, importedAt: clock },
      ...identifyWorksheet(fixture.sheet),
    } }) });
    try {
      const groups = await Promise.all(['甲組', '乙組', '丙組'].map(name => c.group(name)));
      const students: Array<Awaited<ReturnType<typeof c.student>>> = [await c.student(groups[0].joinCode), await c.student(groups[1].joinCode)];
      await c.request('/worksheet/import', c.teacher, { url: 'fixture' }, 'POST');
      const winningOrder = [0, 1, 2, 0, 1];
      for (const [index, winnerIndex] of winningOrder.entries()) {
        if (winnerIndex === 2 && !students[2]) students[2] = await c.student(groups[2].joinCode, '晚加入學生');
        const teacherBefore = await (await c.request('/view')).json();
        const unit = c.activity.worksheet!.units[index];
        expect(teacherBefore.availableUnits).toContainEqual(expect.objectContaining({ unitId: unit.id, questionIds: unit.questionIds }));
        const round = await (await c.request('/rounds', c.teacher, { unitId: unit.id }, 'POST')).json();
        expect((await c.startConfiguredRound(round.id, () => `第 ${index + 1} 回合答案`)).status).toBe(200);
        const teacherActive = await (await c.request('/view')).json();
        const studentViews = await Promise.all(students.map(async student => (await c.request('/view', student.headers)).json()));
        expect(studentViews.every(view => view.phase === 'active' && view.unit.questionIds[0] === String(index + 1))).toBe(true);
        expect(studentViews.every(view => !('groups' in view) && !('availableUnits' in view))).toBe(true);

        const winner = students[winnerIndex];
        const answers = unit.questionIds.map(questionId => ({ questionId, text: `第 ${index + 1} 回合答案` }));
        const pendingTeacher = c.request(`/view?after=${teacherActive.version}`, c.teacher);
        const started = Date.now();
        const accepted = await c.request(`/rounds/${round.id}/submissions`, winner.headers, { answers }, 'POST');
        expect(accepted.status).toBe(201);
        expect(Date.now() - started).toBeLessThan(1000);
        const updatedTeacher = await (await pendingTeacher).json();
        expect(updatedTeacher.groups.find((group: { id: string }) => group.id === groups[winnerIndex].id)).toMatchObject({ received: true, rank: 1 });
        for (const [studentIndex, student] of students.entries()) {
          const view = await (await c.request('/view', student.headers)).json();
          expect(view.received).toBe(studentIndex === winnerIndex);
          expect(view).not.toHaveProperty('groups');
          expect(view).not.toHaveProperty('joinCode');
          expect(view.version).toBe(studentViews[studentIndex].version + (studentIndex === winnerIndex ? 1 : 0));
        }
        await c.finishRound(round.id);
        const finalView = await (await c.request('/view', students[0].headers)).json();
        expect(finalView.closedRoundIds).toContain(round.id);
        expect(finalView.availableUnits).toBeUndefined();
        if (index === 0) {
          const relogin = await c.request('/sessions', c.teacher, {}, 'POST');
          expect(await relogin.json()).toMatchObject({ activityId: c.activity.id, role: 'teacher' });
          expect((await (await c.request('/view')).json()).availableUnits).toContainEqual(expect.objectContaining({ unitId: c.activity.worksheet!.units[1].id, questionIds: ['2'] }));
        }
        clock += 4000;
      }
      const teacherLogin = await c.request('/sessions', c.teacher, {}, 'POST');
      expect(await teacherLogin.json()).toMatchObject({ activityId: c.activity.id, role: 'teacher' });
      const remaining = await (await c.request('/view')).json();
      expect(remaining.availableUnits).toHaveLength(1);
      expect(remaining.availableUnits[0].questionIds).toEqual(['6']);
      expect(c.activity.rounds.map(round => round.submissions[0]?.groupId)).toEqual(winningOrder.map(index => groups[index].id));
    } finally { await c.close(); }
  });
});
