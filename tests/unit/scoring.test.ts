import { expect, it } from 'vitest';
import { createActivity } from '../../backend/src/activity.js';
import { endRound, prepareRound, publishRound, startRound, submitAnswers, updateReview } from '../../backend/src/rounds.js';
import { activityStandings } from '../../backend/src/scoring.js';

it('依定案正誤、有效資格及收件順位計算單題與題組積分', () => {
  const activity = createActivity();
  activity.groups = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => ({ id, name: id }));
  function open(id: string, parts: number) {
    const questions = Array.from({ length: parts }, (_, index) => ({
      questionId: String(index + 1), questionKey: id + index, unitId: id, origin: 'manual' as const,
      prompt: '題幹', missingPrompt: false, acceptedAnswers: ['對'], questionRevision: 0,
    }));
    activity.units.push({ id, name: id, questions });
    const round = prepareRound(activity, id);
    startRound(activity, round.id, 0);
    return {
      round,
      submit(groupId: string, ...answers: string[]) {
        submitAnswers(activity, round.id, groupId, questions.map(({ questionId }, index) =>
          ({ questionId, text: answers[index] })), 3000);
      },
    };
  }

  const single = open('single', 1);
  single.submit('a', '錯');
  single.submit('b', '對');
  single.submit('c', '對');
  single.submit('d', '等價答案');
  single.submit('e', '對');
  endRound(activity, single.round.id);
  updateReview(activity, single.round.id, { reviewRevision: 0,
    grades: [{ groupId: 'd', questionId: '1', correct: true }],
    eligibility: [{ groupId: 'b', disqualified: true }],
  });
  expect(activityStandings(activity).groups.every(group => group.points === 0)).toBe(true);
  publishRound(activity, single.round.id, 1);
  const snapshot = () => activityStandings(activity).groups.map(({ id, points, rank }) => [id, points, rank]);
  expect(snapshot()).toEqual([['c', 3, 1], ['d', 2, 2], ['e', 1, 3], ['a', 0, 4], ['b', 0, 4], ['f', 0, 4], ['g', 0, 4]]);

  const multi = open('multipart', 3);
  multi.submit('e', '對', '錯', '錯');
  multi.submit('d', '對', '對', '錯');
  multi.submit('b', '對', '對', '錯');
  multi.submit('c', '對', '對', '錯');
  multi.submit('a', '對', '錯', '錯');
  endRound(activity, multi.round.id);
  publishRound(activity, multi.round.id, 0);
  expect(multi.round.winnerGroupId).toBeUndefined();
  expect(snapshot()).toEqual([['d', 6, 1], ['c', 5, 2], ['b', 3, 3], ['e', 2, 4], ['a', 1, 5], ['f', 0, 6], ['g', 0, 6]]);

  const wrong = open('wrong', 1);
  wrong.submit('f', '錯');
  endRound(activity, wrong.round.id);
  publishRound(activity, wrong.round.id, 0);
  expect(activityStandings(activity).roundCount).toBe(3);
  expect(snapshot().slice(-2)).toEqual([['f', 0, 6], ['g', 0, 6]]);
});
