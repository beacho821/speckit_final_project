import type { Activity } from './activity.js';

const escapeCell = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function buildResultsCsv(activity: Activity): string {
  const ended = activity.rounds.filter(round => round.phase === 'ended');
  if (!ended.length) throw new Error('NO_ENDED_ROUNDS');
  if (!activity.worksheet) throw new Error('WORKSHEET_REQUIRED');
  const lines = [['題號', '組別', '答案', '搶答順位', '作答狀態']];
  for (const round of ended) {
    const unit = activity.worksheet.units.find(item => item.id === round.unitId);
    if (!unit) continue;
    for (const questionId of unit.questionIds) {
      const submitted = round.roster.flatMap(group => {
        const record = round.submissions.find(item => item.groupId === group.id);
        const answer = record?.answers.find(item => item.questionId === questionId);
        return record && answer ? [{ group, answer: answer.text, rank: record.rank }] : [];
      }).sort((a, b) => a.rank - b.rank);
      const unanswered = round.roster.filter(group => !round.submissions.some(item => item.groupId === group.id));
      for (const row of [...submitted, ...unanswered.map(group => ({ group, answer: '', rank: null as number | null }))]) {
        lines.push([questionId, row.group.name, row.answer, row.rank === null ? '' : String(row.rank), row.rank === null ? '未送出' : '已送出']);
      }
    }
  }
  return lines.map(row => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}
