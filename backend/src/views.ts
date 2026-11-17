import type { Activity } from './activity.js';
import type { ActivityView, Round } from '../../shared/api.js';
import { currentRound, remainingWait } from './rounds.js';
import type { Identity } from './access.js';

export function makeView(activity: Activity, identity: Identity, now = performance.now()): ActivityView {
  const round = currentRound(activity);
  const unit = round && activity.worksheet?.units.find(item => item.id === round.unitId);
  const key = identity.role === 'teacher' ? 'teacher' : `student:${identity.groupId}`;
  const common: ActivityView = {
    phase: round?.phase ?? 'idle', roundId: round?.id ?? null,
    unit: unit ? { ...unit, questionIds: [...unit.questionIds], fillBlankIds: [] } : null,
    closedRoundIds: activity.rounds.filter(item => item.phase === 'ended').map(item => item.id),
    version: activity.viewVersions[key] ?? 0,
  };
  if (identity.role === 'teacher') {
    common.rosterVersion = activity.rosterVersion;
    const worksheet = activity.worksheet;
    common.worksheetPreview = worksheet ? { source: worksheet.source, mainQuestionCount: new Set(worksheet.fills.map(f => f.mainQuestionId)).size, fillCount: worksheet.fills.length, unitCount: worksheet.units.length, units: worksheet.units.map(u => ({ id: u.id, name: u.name, questionIds: u.questionIds })) } : null;
    common.availableUnits = activity.worksheet?.units.filter(candidate => !activity.rounds.some(item => item.unitId === candidate.id && item.id !== (round?.phase === 'preparing' ? round.id : undefined))).map(candidate => ({ unitId: candidate.id, questionIds: candidate.questionIds })) ?? [];
    common.groups = round?.roster.map(group => {
      const submission = round.submissions.find(item => item.groupId === group.id);
      return { id: group.id, name: group.name, received: Boolean(submission), ...(submission ? { rank: submission.rank, answers: submission.answers.map(answer => ({ questionId: answer.questionId, text: answer.text })) } : {}) };
    }) ?? activity.groups.map(group => ({ ...group, received: false }));
  } else {
    const groupId = identity.groupId!;
    const own = round?.submissions.find(item => item.groupId === groupId);
    common.groupId = groupId;
    common.groupName = activity.groups.find(g => g.id === groupId)?.name;
    common.received = Boolean(own);
    common.ownAnswers = own?.answers.map(answer => ({ questionId: answer.questionId, text: answer.text }));
    common.waitRemainingMs = round?.phase === 'active' ? remainingWait(round, groupId, now) : 0;
  }
  return common;
}

export function resultsFor(round: Round, activity: Activity) {
  if (round.phase !== 'ended') return null;
  const unit = activity.worksheet?.units.find(item => item.id === round.unitId);
  if (!unit || !activity.worksheet) return null;
  return unit.questionIds.map(questionId => ({
    questionId,
    groups: round.roster.map(group => {
      const submission = round.submissions.find(item => item.groupId === group.id);
      const answer = submission?.answers.find(item => item.questionId === questionId);
      return { groupId: group.id, groupName: group.name, answer: answer?.text ?? '', rank: submission?.rank ?? null, status: submission ? '已送出' : '未送出' };
    }),
  }));
}
