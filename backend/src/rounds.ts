import { randomUUID } from 'node:crypto';
import type { Activity } from './activity.js';
import { changed, projectionChanged } from './activity.js';
import { FAIRNESS_DELAY_MS, openTimes } from './fairness.js';
import type { Answer, GradeEdit, ReviewView, Round, Submission, TeacherSupplement } from '../../shared/api.js';

export class DomainError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

export function currentRound(activity: Activity): Round | undefined {
  return [...activity.rounds].reverse().find(round => round.phase !== 'ended');
}

export function prepareRound(activity: Activity, unitId: unknown): Round {
  if (typeof unitId !== 'string') throw new DomainError(422, 'INVALID_UNIT', '請選擇一個有效題目。');
  const unit = activity.units.find(candidate => candidate.id === unitId);
  if (!unit) throw new DomainError(404, 'UNIT_NOT_FOUND', '找不到所選題目，請重新整理後選擇。');
  const active = currentRound(activity);
  if (active && active.phase !== 'preparing') throw new DomainError(409, 'ROUND_ACTIVE', '請先公布目前回合結果，再準備下一題。');
  if (activity.rounds.some(round => round.unitId === unitId && round.id !== active?.id)) throw new DomainError(409, 'UNIT_ALREADY_USED', '此題目已開過回合，請選擇尚未使用的題目。');
  const round: Round = { id: randomUUID(), unitId, unitName: unit.name, phase: 'preparing', openAtByGroup: {}, roster: [...activity.groups], submissions: [] };
  if (active?.phase === 'preparing') activity.rounds.splice(activity.rounds.indexOf(active), 1);
  activity.rounds.push(round);
  changed(activity);
  projectionChanged(activity);
  return round;
}

export function startRound(activity: Activity, roundId: string, now = performance.now()): Round {
  const round = activity.rounds.find(item => item.id === roundId);
  if (!round || currentRound(activity)?.id !== roundId) throw new DomainError(409, 'ROUND_EXPIRED', '回合已更新，請重新載入教師畫面。');
  if (round.phase !== 'preparing') throw new DomainError(409, 'INVALID_PHASE', '此回合目前無法開始，請重新整理畫面。');
  if (activity.groups.length === 0) throw new DomainError(409, 'EMPTY_ROSTER', '尚未加入任何組別，請先設定組別名單。');
  const unit = activity.units.find(candidate => candidate.id === round.unitId);
  if (!unit) throw new DomainError(404, 'UNIT_NOT_FOUND', '找不到所選題目，請重新選擇。');
  const missingPromptQuestionIds = unit.questions.filter(question => question.missingPrompt).map(question => question.questionId);
  const missingAcceptedAnswerQuestionIds = unit.questions.filter(question => !question.acceptedAnswers.length).map(question => question.questionId);
  if (missingPromptQuestionIds.length || missingAcceptedAnswerQuestionIds.length) {
    const missing = [
      missingPromptQuestionIds.length ? `請補填題目：${missingPromptQuestionIds.join('、')}` : '',
      missingAcceptedAnswerQuestionIds.length ? `請填寫標準答案：${missingAcceptedAnswerQuestionIds.join('、')}` : '',
    ].filter(Boolean);
    throw new DomainError(422, 'QUESTION_NOT_READY', `${missing.join('。')}，儲存後再開始搶答。`, { missingPromptQuestionIds, missingAcceptedAnswerQuestionIds });
  }
  round.questions = structuredClone(unit.questions);
  round.phase = 'active'; round.openedAt = now; round.roster = [...activity.groups];
  round.openAtByGroup = openTimes(activity, round, now);
  if (!activity.rosterLocked) activity.rosterVersion++;
  activity.rosterLocked = true;
  changed(activity);
  projectionChanged(activity);
  return round;
}

export function submitAnswers(activity: Activity, roundId: string, groupId: string, input: unknown, now = performance.now()): Submission {
  const round = activity.rounds.find(item => item.id === roundId);
  if (!round || currentRound(activity)?.id !== roundId) throw new DomainError(409, 'ROUND_EXPIRED', '此回合已更新，請查看目前題目。');
  if (round.phase !== 'active') throw new DomainError(409, 'INVALID_PHASE', '回合尚未開放或已停止收件，答案沒有送出。');
  if (!round.roster.some(group => group.id === groupId)) throw new DomainError(403, 'GROUP_NOT_IN_ROSTER', '此組別不在本回合名單中，請聯絡老師。');
  if (round.submissions.some(submission => submission.groupId === groupId)) throw new DomainError(409, 'ALREADY_RECEIVED', '本組答案已收件，無法重複送出。');
  const openAt = round.openAtByGroup[groupId];
  if (openAt === undefined) throw new DomainError(403, 'GROUP_NOT_IN_ROSTER', '本回合未包含此組別，請聯絡老師。');
  if (now < openAt) {
    const remainingMs = Math.max(0, Math.ceil(openAt - now));
    throw new DomainError(409, 'WAIT_REQUIRED', `本組尚須等待 ${remainingMs} 毫秒才能送出，答案草稿已保留。`, { waitRemainingMs: remainingMs });
  }
  if (!Array.isArray(input)) throw new DomainError(422, 'INVALID_ANSWERS', '答案格式不正確，請填妥所有題目後一起送出。');
  const questions = round.questions;
  if (!questions) throw new DomainError(500, 'UNIT_MISSING', '找不到本回合題目資料，請聯絡老師。');
  const answers = input as Array<{ questionId?: unknown; text?: unknown }>;
  if (answers.some(answer => !answer || typeof answer.questionId !== 'string' || typeof answer.text !== 'string')) throw new DomainError(422, 'INVALID_ANSWERS', '答案格式不正確，請檢查題號及作答內容。');
  const ids = answers.map(answer => answer.questionId as string);
  if (new Set(ids).size !== ids.length) throw new DomainError(422, 'DUPLICATE_QUESTION', '答案中有重複題號，請每題保留一個答案。');
  const expected = questions.map(question => question.questionId);
  const missing = expected.filter(id => !ids.includes(id) || !(answers.find(answer => answer.questionId === id)?.text as string).trim());
  const extra = ids.filter(id => !expected.includes(id));
  if (missing.length || extra.length || ids.length !== expected.length) {
    const details = { missingQuestionIds: missing, extraQuestionIds: extra };
    const message = missing.length ? `${missing.join('、')} 尚未填答，請補齊後一起送出。` : '答案題號與本回合不符，請檢查後再送出。';
    throw new DomainError(422, 'INVALID_ANSWERS', message, details);
  }
  const submission: Submission = {
    groupId, rank: round.submissions.length + 1, receivedAt: now, receivedOn: Date.now(),
    answers: questions.map(({ questionId, fillBlankId }) => ({ questionId, ...(fillBlankId ? { fillBlankId } : {}), text: answers.find(answer => answer.questionId === questionId)!.text as string })),
  };
  round.submissions.push(submission);
  changed(activity, ['teacher', `student:${groupId}`]);
  projectionChanged(activity, groupId);
  return submission;
}

export function endRound(activity: Activity, roundId: string): Round {
  const round = activity.rounds.find(item => item.id === roundId);
  if (!round || currentRound(activity)?.id !== roundId) throw new DomainError(409, 'ROUND_EXPIRED', '回合已更新，請重新載入教師畫面。');
  if (round.phase !== 'active') throw new DomainError(409, 'INVALID_PHASE', '只有進行中的回合可以結束。');
  const accepted = new Map(round.questions?.map(question => [question.questionId, new Set(question.acceptedAnswers)]));
  for (const submission of round.submissions) {
    for (const answer of submission.answers) {
      answer.autoCorrect = accepted.get(answer.questionId)?.has(answer.text.trim()) ?? false;
    }
  }
  round.phase = 'reviewing';
  round.reviewRevision = 0;
  round.supplements = [];
  changed(activity);
  projectionChanged(activity);
  return round;
}

export function finalCorrectness(answer: Answer): boolean | undefined {
  return answer.overrideCorrect ?? answer.autoCorrect;
}

function unansweredQuestionIds(questions: Round['questions'], submissions: Submission[]): string[] {
  const correctIds = new Set(submissions.filter(submission => !submission.disqualified).flatMap(submission => submission.answers
    .filter(answer => finalCorrectness(answer) === true).map(answer => answer.questionId)));
  return (questions ?? []).map(question => question.questionId).filter(id => !correctIds.has(id));
}

export function reviewFor(round: Round): ReviewView {
  const supplements = round.supplements ?? [];
  const answeredByTeacher = new Set(supplements.filter(entry => entry.text.trim()).map(entry => entry.questionId));
  return {
    reviewRevision: round.reviewRevision ?? 0,
    missingSupplementQuestionIds: unansweredQuestionIds(round.questions, round.submissions).filter(id => !answeredByTeacher.has(id)),
    supplements,
  };
}

function requireCurrentReview(activity: Activity, round: Round | undefined, revision: unknown): asserts round is Round {
  if (!round || round !== currentRound(activity) || round.phase !== 'reviewing') {
    throw new DomainError(409, 'REVIEW_UNAVAILABLE', '這個回合目前無法更正或公布，請重新整理畫面。');
  }
  if (!Number.isSafeInteger(revision)) {
    throw new DomainError(422, 'INVALID_REVIEW_REVISION', '請重新載入判分內容後再操作。');
  }
  if (revision !== round.reviewRevision) {
    throw new DomainError(409, 'REVIEW_REVISION_CHANGED', '判分內容已更新，請核對最新版本後再操作。');
  }
}

export function updateReview(activity: Activity, roundId: string, input: unknown): ReviewView {
  const round = activity.rounds.find(item => item.id === roundId);
  const { reviewRevision, grades = [], supplements = [], eligibility = [] } = (input ?? {}) as Record<string, unknown>;
  requireCurrentReview(activity, round, reviewRevision);
  if (!Array.isArray(grades) || !Array.isArray(supplements) || !Array.isArray(eligibility) || (!grades.length && !supplements.length && !eligibility.length)) {
    throw new DomainError(422, 'INVALID_REVIEW', '請選擇要更正的答案，或填寫要儲存的老師補答。');
  }

  const nextSubmissions = structuredClone(round.submissions);
  const answers = new Map(nextSubmissions.map(submission => [submission.groupId, new Map(submission.answers.map(answer => [answer.questionId, answer]))]));
  const seenGrades = new Set<Answer>();
  for (const entry of grades as Array<Partial<GradeEdit> | null>) {
    const answer = entry && typeof entry.groupId === 'string' && typeof entry.questionId === 'string'
      ? answers.get(entry.groupId)?.get(entry.questionId) : undefined;
    if (!entry || !answer || typeof entry.correct !== 'boolean' || seenGrades.has(answer)) {
      throw new DomainError(422, 'INVALID_GRADE', '請確認改判項目的組別、題號與正誤，且每筆答案只更正一次。');
    }
    seenGrades.add(answer);
    answer.overrideCorrect = entry.correct;
  }

  const seenGroups = new Set<string>();
  for (const entry of eligibility as Array<{ groupId?: unknown; disqualified?: unknown } | null>) {
    const submission = nextSubmissions.find(item => item.groupId === entry?.groupId);
    if (!entry || !submission || typeof entry.disqualified !== 'boolean' || seenGroups.has(submission.groupId)) {
      throw new DomainError(422, 'INVALID_ELIGIBILITY', '請選擇已送出的組別，每組只可設定一次資格。');
    }
    seenGroups.add(submission.groupId);
    submission.disqualified = entry.disqualified;
  }
  const needsSupplement = new Set(unansweredQuestionIds(round.questions, nextSubmissions));
  const questionIds = new Set(round.questions?.map(question => question.questionId));
  const nextSupplements = new Map(round.supplements?.filter(entry => needsSupplement.has(entry.questionId)).map(entry => [entry.questionId, entry.text]));
  const seenSupplements = new Set<string>();
  for (const entry of supplements as Array<Partial<TeacherSupplement> | null>) {
    if (!entry || typeof entry.questionId !== 'string' || typeof entry.text !== 'string'
      || !questionIds.has(entry.questionId) || seenSupplements.has(entry.questionId)) {
      throw new DomainError(422, 'INVALID_SUPPLEMENT', '請確認補答的完整題號與內容，每個題號只能填一筆。');
    }
    seenSupplements.add(entry.questionId);
    if (!entry.text.trim()) nextSupplements.delete(entry.questionId);
    else if (needsSupplement.has(entry.questionId)) nextSupplements.set(entry.questionId, entry.text);
    else throw new DomainError(422, 'SUPPLEMENT_NOT_NEEDED', `第 ${entry.questionId} 題已有組別答對，請先清除該題補答。`);
  }

  round.submissions = nextSubmissions;
  round.supplements = [...nextSupplements].map(([questionId, text]) => ({ questionId, text }));
  round.reviewRevision = (round.reviewRevision ?? 0) + 1;
  changed(activity, ['teacher']);
  return reviewFor(round);
}

export function publishRound(activity: Activity, roundId: string, revision: unknown) {
  const round = activity.rounds.find(item => item.id === roundId);
  if (round?.phase === 'ended') return { id: round.id, phase: round.phase, winnerGroupId: round.winnerGroupId ?? null };
  requireCurrentReview(activity, round, revision);
  const { missingSupplementQuestionIds } = reviewFor(round);
  if (missingSupplementQuestionIds.length) {
    throw new DomainError(422, 'SUPPLEMENT_REQUIRED', `請補答第 ${missingSupplementQuestionIds.join('、')} 題後再公布。`, { missingSupplementQuestionIds });
  }

  round.winnerGroupId = round.submissions.find(submission =>
    !submission.disqualified && submission.answers.length === round.questions?.length && submission.answers.every(answer => finalCorrectness(answer) === true),
  )?.groupId;
  round.phase = 'ended';
  changed(activity);
  projectionChanged(activity);
  return { id: round.id, phase: round.phase, winnerGroupId: round.winnerGroupId ?? null };
}

export function remainingWait(round: Round, groupId: string, now = performance.now()): number {
  return Math.max(0, Math.ceil((round.openAtByGroup[groupId] ?? now) - now));
}

export const fairnessDelay = FAIRNESS_DELAY_MS;
