import type { Activity } from './activity.js';
import { resultsFor } from './views.js';

const escapeCell = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function buildResultsCsv(activity: Activity): string {
  const ended = activity.rounds.filter(round => round.phase === 'ended');
  if (!ended.length) throw new Error('NO_ENDED_ROUNDS');

  const lines = [['題號', '組別', '答案', '搶答順位', '作答狀態', '正誤']];
  for (const round of ended) {
    for (const { questionId, questionNumber, groups, teacherAnswer } of resultsFor(round) ?? []) {
      const label = questionId === round.unitId && questionNumber !== undefined ? String(questionNumber) : questionId;
      const ordered = [...groups].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
      for (const { groupName, answer, rank, status, correct } of ordered) {
        lines.push([label, groupName, answer, rank === null ? '' : String(rank), status, correct === null ? '' : correct ? '答對' : '答錯']);
      }
      if (teacherAnswer !== undefined) lines.push([label, '', teacherAnswer, '', '老師補答', '']);
    }
  }
  return lines.map(row => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}
