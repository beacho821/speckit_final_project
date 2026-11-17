import { randomUUID } from 'node:crypto';
import type { Activity } from './activity.js';
import { changed } from './activity.js';
import { FAIRNESS_DELAY_MS, openTimes } from './fairness.js';
import type { Round, Submission } from '../../shared/api.js';

export class DomainError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

export function currentRound(activity: Activity): Round | undefined {
  return [...activity.rounds].reverse().find(round => round.phase !== 'ended');
}

export function prepareRound(activity: Activity, unitId: unknown): Round {
  if (!activity.worksheet) throw new DomainError(409, 'WORKSHEET_REQUIRED', '請先匯入學習單，再選擇題目。');
  if (typeof unitId !== 'string') throw new DomainError(422, 'INVALID_UNIT', '請選擇一個有效題目。');
  const unit = activity.worksheet.units.find(candidate => candidate.id === unitId);
  if (!unit) throw new DomainError(404, 'UNIT_NOT_FOUND', '找不到所選題目，請重新整理後選擇。');
  const active = currentRound(activity);
  if (active?.phase === 'active') throw new DomainError(409, 'ROUND_ACTIVE', '目前回合尚未結束，請先結束再準備下一題。');
  if (activity.rounds.some(round => round.unitId === unitId && round.id !== active?.id)) throw new DomainError(409, 'UNIT_ALREADY_USED', '此題目已開過回合，請選擇尚未使用的題目。');
  const round: Round = { id: randomUUID(), unitId, phase: 'preparing', openAtByGroup: {}, roster: [...activity.groups], submissions: [] };
  if (active?.phase === 'preparing') activity.rounds.splice(activity.rounds.indexOf(active), 1);
  activity.rounds.push(round);
  changed(activity);
  return round;
}

export function startRound(activity: Activity, roundId: string, now = performance.now()): Round {
  const round = activity.rounds.find(item => item.id === roundId);
  if (!round || currentRound(activity)?.id !== roundId) throw new DomainError(409, 'ROUND_EXPIRED', '回合已更新，請重新載入教師畫面。');
  if (round.phase !== 'preparing') throw new DomainError(409, 'INVALID_PHASE', '此回合目前無法開始，請重新整理畫面。');
  if (activity.groups.length === 0) throw new DomainError(409, 'EMPTY_ROSTER', '尚未加入任何組別，請先設定組別名單。');
  round.phase = 'active'; round.openedAt = now; round.roster = [...activity.groups];
  round.openAtByGroup = openTimes(activity, round, now);
  if (!activity.rosterLocked) activity.rosterVersion++;
  activity.rosterLocked = true;
  changed(activity);
  return round;
}

export function submitAnswers(activity: Activity, roundId: string, groupId: string, input: unknown, now = performance.now()): Submission {
  const round = activity.rounds.find(item => item.id === roundId);
  if (!round || currentRound(activity)?.id !== roundId) throw new DomainError(409, 'ROUND_EXPIRED', '此回合已更新，請查看目前題目。');
  if (round.phase !== 'active') throw new DomainError(409, 'INVALID_PHASE', '回合已結束或尚未開始，答案沒有送出。');
  if (!round.roster.some(group => group.id === groupId)) throw new DomainError(403, 'GROUP_NOT_IN_ROSTER', '此組別不在本回合名單中，請聯絡老師。');
  if (round.submissions.some(submission => submission.groupId === groupId)) throw new DomainError(409, 'ALREADY_RECEIVED', '本組答案已收件，無法重複送出。');
  const openAt = round.openAtByGroup[groupId];
  if (openAt === undefined) throw new DomainError(403, 'GROUP_NOT_IN_ROSTER', '本回合未包含此組別，請聯絡老師。');
  if (now < openAt) {
    const remainingMs = Math.max(0, Math.ceil(openAt - now));
    throw new DomainError(409, 'WAIT_REQUIRED', `本組尚須等待 ${remainingMs} 毫秒才能送出，答案草稿已保留。`, { waitRemainingMs: remainingMs });
  }
  if (!Array.isArray(input)) throw new DomainError(422, 'INVALID_ANSWERS', '答案格式不正確，請填妥所有題目後一起送出。');
  const unit = activity.worksheet?.units.find(item => item.id === round.unitId);
  if (!unit) throw new DomainError(500, 'UNIT_MISSING', '找不到本回合題目資料，請聯絡老師。');
  const fills = unit.fillBlankIds.map(id => activity.worksheet!.fills.find(fill => fill.id === id)!);
  const answers = input as Array<{ questionId?: unknown; text?: unknown }>;
  if (answers.some(answer => typeof answer.questionId !== 'string' || typeof answer.text !== 'string')) throw new DomainError(422, 'INVALID_ANSWERS', '答案格式不正確，請檢查題號及作答內容。');
  const ids = answers.map(answer => answer.questionId as string);
  if (new Set(ids).size !== ids.length) throw new DomainError(422, 'DUPLICATE_QUESTION', '答案中有重複題號，請每題保留一個答案。');
  const expected = fills.map(fill => fill.questionId);
  const missing = expected.filter(id => !ids.includes(id) || !(answers.find(answer => answer.questionId === id)?.text as string).trim());
  const extra = ids.filter(id => !expected.includes(id));
  if (missing.length || extra.length || ids.length !== expected.length) {
    const details = { missingQuestionIds: missing, extraQuestionIds: extra };
    const message = missing.length ? `${missing.join('、')} 尚未填答，請補齊後一起送出。` : '答案題號與本回合不符，請檢查後再送出。';
    throw new DomainError(422, 'INVALID_ANSWERS', message, details);
  }
  const submission: Submission = {
    groupId, rank: round.submissions.length + 1, receivedAt: now,
    answers: fills.map(fill => ({ questionId: fill.questionId, fillBlankId: fill.id, text: answers.find(answer => answer.questionId === fill.questionId)!.text as string })),
  };
  round.submissions.push(submission);
  changed(activity, ['teacher', `student:${groupId}`]);
  return submission;
}

export function endRound(activity: Activity, roundId: string): Round {
  const round = activity.rounds.find(item => item.id === roundId);
  if (!round || currentRound(activity)?.id !== roundId) throw new DomainError(409, 'ROUND_EXPIRED', '回合已更新，請重新載入教師畫面。');
  if (round.phase !== 'active') throw new DomainError(409, 'INVALID_PHASE', '只有進行中的回合可以結束。');
  round.phase = 'ended'; round.winnerGroupId = round.submissions[0]?.groupId;
  changed(activity);
  return round;
}

export function remainingWait(round: Round, groupId: string, now = performance.now()): number {
  return Math.max(0, Math.ceil((round.openAtByGroup[groupId] ?? now) - now));
}

export const fairnessDelay = FAIRNESS_DELAY_MS;
