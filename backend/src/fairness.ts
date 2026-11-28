import type { Activity } from './activity.js';
import type { Round } from '../../shared/api.js';

export const FAIRNESS_DELAY_MS = 3_000;

export function hasWonBefore(rounds: Round[], groupId: string): boolean {
  return rounds.some(round => round.phase === 'ended' && round.winnerGroupId === groupId);
}

export function openTimes(activity: Activity, round: Round, now: number): Record<string, number> {
  const hasUnwonGroup = round.roster.some(group => !hasWonBefore(activity.rounds, group.id));
  return Object.fromEntries(round.roster.map(group => [
    group.id,
    now + (hasUnwonGroup && hasWonBefore(activity.rounds, group.id) ? FAIRNESS_DELAY_MS : 0),
  ]));
}
