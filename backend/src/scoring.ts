import type { Activity } from './activity.js';
import type { ActivitySettlement } from '../../shared/api.js';
import { finalCorrectness } from './rounds.js';

const standingsByActivity = new WeakMap<Activity, { version: number; standings: ActivitySettlement }>();

export function activityStandings(activity: Activity): ActivitySettlement {
  // Long polling can read the same committed activity repeatedly.
  const cached = standingsByActivity.get(activity);
  if (cached?.version === activity.version) return cached.standings;

  const points = new Map(activity.groups.map(group => [group.id, 0]));
  const rounds = activity.rounds.filter(round => round.phase === 'ended');
  for (const round of rounds) {
    const scores = round.submissions
      .filter(submission => !submission.disqualified)
      .map(submission => ({
        groupId: submission.groupId,
        receivedRank: submission.rank,
        correct: submission.answers.filter(answer => finalCorrectness(answer) === true).length,
      }));
    const mostCorrect = scores.reduce((max, score) => Math.max(max, score.correct), 0);
    if (!mostCorrect) continue;

    // A submission earns at most one bonus, even when it covers multiple parts.
    const fastest = scores.filter(score => score.correct === mostCorrect)
      .sort((a, b) => a.receivedRank - b.receivedRank)
      .slice(0, 2);
    const bonuses = new Map(fastest.map(({ groupId }, index) => [groupId, 2 - index]));
    for (const { groupId, correct } of scores) {
      points.set(groupId, (points.get(groupId) ?? 0) + correct + (bonuses.get(groupId) ?? 0));
    }
  }

  const sorted = activity.groups.map(group => ({ id: group.id, name: group.name, points: points.get(group.id) ?? 0 }))
    .sort((a, b) => b.points - a.points);
  let rank = 0;
  const groups = sorted.map((group, index) => {
    if (index === 0 || group.points !== sorted[index - 1].points) rank = index + 1;
    return { ...group, rank };
  });
  const standings = { roundCount: rounds.length, groups };
  standingsByActivity.set(activity, { version: activity.version, standings });
  return standings;
}
