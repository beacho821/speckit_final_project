import type { Activity } from './activity.js';
import type { Round } from '../../shared/api.js';

export const FAIRNESS_DELAY_MS = 5_000;
const MAX_DELAY_MS = 8_000;
const RECENT_ROUNDS = 5;

export function hasWonBefore(rounds: Round[], groupId: string): boolean {
  return rounds.some(round => round.phase === 'ended' && round.winnerGroupId === groupId);
}

export function openTimes(activity: Activity, round: Round, now: number): Record<string, number> {
  const recent = activity.rounds.filter(entry => entry.phase === 'ended').slice(-RECENT_ROUNDS);
  const total = recent.reduce((count, entry) => count + (entry.questions?.length ?? 0), 0);
  return Object.fromEntries(round.roster.map(group => {
    const lastWinner = recent.at(-1)?.winnerGroupId === group.id;
    const earlierWinner = recent.at(-2)?.winnerGroupId === group.id;
    if (!lastWinner && !earlierWinner) return [group.id, now];
    const correct = recent.reduce((count, entry) => {
      const submission = entry.submissions.find(item => item.groupId === group.id && !item.disqualified);
      return count + (submission?.answers.filter(answer => answer.overrideCorrect ?? answer.autoCorrect).length ?? 0);
    }, 0);
    const rate = total ? correct / total : 0;
    const fullDelay = FAIRNESS_DELAY_MS + (MAX_DELAY_MS - FAIRNESS_DELAY_MS) * rate ** 2;
    return [group.id, now + Math.ceil(fullDelay * (lastWinner ? 1 : 0.6))];
  }));
}
