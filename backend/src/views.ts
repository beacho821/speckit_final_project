import type { Activity } from './activity.js';
import type { ActivityView, Round, RoundResultLine, WorksheetPreview } from '../../shared/api.js';
import { currentRound, finalCorrectness, remainingWait, reviewFor } from './rounds.js';
import type { Identity } from './access.js';
import { previewQuestion } from './questions.js';

export function makeView(activity: Activity, identity: Identity, now = performance.now(), retainReceipt = false): ActivityView {
  const round = currentRound(activity) ?? (retainReceipt && identity.role === 'student' ? activity.rounds.at(-1) : undefined);
  const unit = round && activity.units.find(item => item.id === round.unitId);
  const key = identity.role === 'teacher' ? 'teacher' : `student:${identity.groupId}`;
  const hideQuestionDetails = identity.role === 'student' && round?.phase === 'preparing';
  const common: ActivityView = {
    phase: round?.phase ?? 'idle', roundId: round?.id ?? null,
    unit: unit ? {
      id: unit.id, questionIds: unit.questions.map(q => q.questionId),
      ...(hideQuestionDetails ? {} : {
        name: unit.name, fillBlankIds: [], questions: (round?.questions ?? unit.questions).map(previewQuestion),
      }),
    } : null,
    closedRoundIds: activity.rounds.filter(item => item.phase === 'ended').map(item => item.id),
    version: activity.viewVersions[key] ?? 0,
  };
  if (identity.role === 'teacher') {
    if (activity.writebackInProgress) common.writebackInProgress = true;
    common.rosterVersion = activity.rosterVersion;
    common.worksheetPreview = previewFor(activity);
    common.availableUnits = activity.units
      .filter(candidate => !activity.rounds.some(item => item.unitId === candidate.id && item.phase !== 'preparing'))
      .map(candidate => ({ unitId: candidate.id, questionIds: candidate.questions.map(q => q.questionId), questions: candidate.questions.map(previewQuestion) }));
    if (unit && round?.phase === 'preparing') common.editableQuestions = unit.questions;
    if (round?.phase === 'reviewing') common.review = reviewFor(round);
    common.groups = round?.roster.map(group => {
      const submission = round.submissions.find(item => item.groupId === group.id);
      return { id: group.id, name: group.name, received: Boolean(submission), ...(submission ? { rank: submission.rank, ...(submission.disqualified ? { disqualified: true } : {}), answers: submission.answers.map(answer => ({
        questionId: answer.questionId,
        text: answer.text,
        ...(round.phase === 'reviewing' ? { autoCorrect: answer.autoCorrect, correct: finalCorrectness(answer) } : {}),
      })) } : {}) };
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

export function resultsFor(round: Round): RoundResultLine[] | null {
  if (round.phase !== 'ended' || !round.questions) return null;
  const submissions = new Map(round.submissions.map(submission => [submission.groupId, submission]));
  const supplements = new Map(round.supplements?.map(entry => [entry.questionId, entry.text]));
  return round.questions.map(({ questionId, prompt }) => ({
    questionId,
    prompt,
    winnerGroupId: round.winnerGroupId ?? null,
    ...(supplements.has(questionId) ? { teacherAnswer: supplements.get(questionId) } : {}),
    groups: round.roster.map(group => {
      const submission = submissions.get(group.id);
      const answer = submission?.answers.find(item => item.questionId === questionId);
      return {
        groupId: group.id, groupName: group.name, answer: answer?.text ?? '', rank: submission?.rank ?? null,
        status: submission?.disqualified ? '已取消資格' : submission ? '已送出' : '未送出',
        correct: answer ? finalCorrectness(answer) ?? null : null,
      };
    }),
  }));
}

export function previewFor(activity: Activity): WorksheetPreview | null {
  const worksheet = activity.worksheet;
  if (!worksheet) return null;
  const units = activity.units.filter(unit => unit.questions[0]?.origin === 'worksheet');
  return {
    source: worksheet.source,
    mainQuestionCount: new Set(worksheet.fills.map(fill => fill.mainQuestionId)).size,
    fillCount: worksheet.fills.length, unitCount: units.length,
    units: units.map(({ id, name, questions }) => ({ id, name, questionIds: questions.map(q => q.questionId), questions: questions.map(previewQuestion) })),
  };
}
