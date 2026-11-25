import type { Activity } from './activity.js';
import type { ActivityView, Round, RoundResultLine, StudentRoundResultLine, WorksheetPreview } from '../../shared/api.js';
import { currentRound, finalCorrectness, remainingWait, reviewFor, roundNumbering } from './rounds.js';
import type { Identity } from './access.js';
import { nextUnitId } from './question-queue.js';
import { previewQuestion } from './questions.js';
import { activityStandings } from './scoring.js';

export function makeView(activity: Activity, identity: Identity, now = performance.now(), retainReceipt = false): ActivityView {
  const round = currentRound(activity) ?? (retainReceipt && identity.role === 'student' ? activity.rounds.at(-1) : undefined);
  const unit = round && (round.questions
    ? { id: round.unitId, name: round.unitName, questions: round.questions }
    : activity.units.find(item => item.id === round.unitId));
  const key = identity.role === 'teacher' ? 'teacher' : `student:${identity.groupId}`;
  const hideQuestionDetails = identity.role === 'student' && round?.phase === 'preparing';
  const standings = activityStandings(activity);
  const common: ActivityView = {
    phase: round?.phase ?? 'idle', roundId: round?.id ?? null,
    unit: unit ? {
      id: unit.id, questionIds: unit.questions.map(q => q.questionId),
      ...(hideQuestionDetails ? {} : {
        name: unit.name, fillBlankIds: [], questions: unit.questions.map((question, index) => ({ ...previewQuestion(question),
          ...(round?.sequenceNumber !== undefined ? roundNumbering(round, index) : {}),
        })),
      }),
    } : null,
    closedRoundIds: activity.rounds.filter(item => item.phase === 'ended').map(item => item.id),
    version: activity.viewVersions[key] ?? 0,
    ...(activity.settlementPublished ? { settlement: standings } : { standings: standings.groups }),
  };
  if (identity.role === 'teacher') {
    if (activity.writebackInProgress) common.writebackInProgress = true;
    common.rosterVersion = activity.rosterVersion;
    common.worksheetPreview = previewFor(activity);
    common.catalogRevision = activity.catalogRevision;
    common.queueUnitIds = activity.queueUnitIds;
    common.nextUnitId = nextUnitId(activity);
    const opened = new Map(activity.rounds.filter(round => round.phase !== 'preparing').map(round => [round.unitId, round]));
    common.questionCards = activity.units.map(unit => ({
      ...unit, opened: opened.has(unit.id), questionNumber: opened.get(unit.id)?.sequenceNumber,
    }));
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
    const published = round?.phase === 'ended' && own ? publishedAnswers(round) : undefined;
    common.groupId = groupId;
    common.groupName = activity.groups.find(g => g.id === groupId)?.name;
    common.received = Boolean(own);
    common.ownAnswers = own?.answers.map(answer => {
      const { questionId, text } = answer;
      if (!published) return { questionId, text };
      const correct = finalCorrectness(answer);
      return { questionId, text, correct, ...(correct === false ? { publishedAnswer: published.get(questionId) } : {}) };
    });
    common.waitRemainingMs = round?.phase === 'active' ? remainingWait(round, groupId, now) : 0;
  }
  return common;
}

export function resultsFor(round: Round): RoundResultLine[] | null {
  if (round.phase !== 'ended' || !round.questions) return null;
  const submissions = new Map(round.submissions.map(submission => [submission.groupId, submission]));
  const supplements = new Map(round.supplements?.map(entry => [entry.questionId, entry.text]));
  return round.questions.map(({ questionId, prompt }, index) => ({
    ...roundNumbering(round, index),
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

function publishedAnswers(round: Round) {
  const supplements = new Map(round.supplements?.map(entry => [entry.questionId, entry.text]));
  return new Map(round.questions?.map(({ questionId, acceptedAnswers }) =>
    [questionId, supplements.get(questionId) ?? acceptedAnswers.find(answer => answer.trim())]));
}

export function studentResultsFor(round: Round, groupId: string): StudentRoundResultLine[] | null {
  if (round.phase !== 'ended' || !round.questions) return null;
  const answers = new Map(round.submissions.find(row => row.groupId === groupId)?.answers.map(answer => [answer.questionId, answer]));
  const published = publishedAnswers(round);
  return round.questions.map((question, index) => {
    const own = answers.get(question.questionId);
    const correct = own ? finalCorrectness(own) ?? null : null;
    return { ...roundNumbering(round, index), prompt: question.prompt, ownAnswer: own?.text ?? null, correct,
      publishedAnswer: correct ? null : published.get(question.questionId) ?? null };
  });
}

export function previewFor(activity: Activity): WorksheetPreview | null {
  const worksheet = activity.worksheet;
  if (!worksheet) return null;
  const units = activity.units.filter(unit => unit.questions[0]?.origin === 'worksheet');
  const included = new Set(units.map(unit => unit.id));
  const fills = worksheet.fills.filter(fill => included.has(fill.unitId));
  return {
    source: worksheet.source,
    mainQuestionCount: new Set(fills.map(fill => fill.mainQuestionId)).size,
    fillCount: fills.length, unitCount: units.length,
    units: units.map(({ id, name, questions }) => ({ id, name, questionIds: questions.map(q => q.questionId), questions: questions.map(previewQuestion) })),
  };
}
