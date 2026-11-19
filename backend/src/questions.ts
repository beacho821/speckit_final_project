import { randomUUID } from 'node:crypto';
import { catalogChanged, type Activity } from './activity.js';
import { DomainError } from './rounds.js';
import type { CatalogUnit, QuestionPreview, RoundQuestion, Worksheet } from '../../shared/api.js';

const subPattern = /^(.+?)\s*[（(]\s*(\d+)\s*[）)]$/;

function questionNumber(raw: string, inferredSub?: string) {
  const value = raw.trim();
  const match = value.match(subPattern);
  const mainQuestionId = (match?.[1] ?? value).trim();
  const subQuestionId = match?.[2] ?? inferredSub;
  const questionId = subQuestionId ? `${mainQuestionId}（${subQuestionId}）` : mainQuestionId;
  return { mainQuestionId, subQuestionId, questionId };
}

export function parseQuestion(raw: string, inferredSub?: string) {
  const parsed = questionNumber(raw, inferredSub);
  return /\d/.test(parsed.mainQuestionId) ? parsed : null;
}

export function hasPrompt(questionId: string, prompt: unknown): prompt is string {
  if (typeof prompt !== 'string') return false;
  const text = prompt.replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}]/gu, '').trim();
  const normalizedId = questionNumber(questionId).questionId;
  return Boolean(text
    && questionNumber(text).questionId !== normalizedId
    && questionNumber(text.replace(/[.．。]$/, '')).questionId !== normalizedId);
}

export function previewQuestion({ questionId, prompt }: Pick<RoundQuestion, 'questionId' | 'prompt'>): QuestionPreview {
  return { questionId, prompt, missingPrompt: prompt === null };
}

export function worksheetUnits(worksheet: Worksheet): CatalogUnit[] {
  const fills = new Map(worksheet.fills.map(fill => [fill.id, fill]));
  return worksheet.units.map(unit => ({
    id: unit.id,
    name: unit.name,
    questions: unit.questionIds.map((questionId, index) => {
      const fill = fills.get(unit.fillBlankIds[index]);
      const prompt = hasPrompt(questionId, fill?.prompt) ? fill.prompt : null;
      return {
        questionKey: randomUUID(), questionId, unitId: unit.id, origin: 'worksheet',
        ...(fill ? { fillBlankId: fill.id } : {}),
        prompt, missingPrompt: prompt === null, acceptedAnswers: [], questionRevision: 0,
      };
    }),
  }));
}

export function updateQuestion(activity: Activity, key: string, input: unknown): RoundQuestion {
  assertQuestionEditingAllowed(activity);
  const question = activity.units.flatMap(unit => unit.questions).find(item => item.questionKey === key);
  if (!question) throw new DomainError(404, 'QUESTION_NOT_FOUND', '找不到原題目，請重新整理並重新選題。');
  if (activity.rounds.some(round => round.unitId === question.unitId && round.phase !== 'preparing')) {
    throw new DomainError(409, 'QUESTION_ALREADY_USED', '這個題目已開過回合，請選擇尚未使用的題目。');
  }
  const { questionRevision, prompt, acceptedAnswersText } = (input ?? {}) as Record<string, unknown>;
  if (!Number.isSafeInteger(questionRevision) || (prompt === undefined && acceptedAnswersText === undefined)) {
    throw new DomainError(422, 'INVALID_QUESTION_EDIT', '請重新選題，並填寫要儲存的題目或標準答案。');
  }
  if (questionRevision !== question.questionRevision) {
    throw new DomainError(409, 'QUESTION_REVISION_CHANGED', '題目已更新，請核對最新內容後再儲存。');
  }
  if (prompt !== undefined && !hasPrompt(question.questionId, prompt)) {
    throw new DomainError(422, 'INVALID_PROMPT', `缺少題目，請輸入完整題幹。`);
  }
  if (acceptedAnswersText !== undefined && typeof acceptedAnswersText !== 'string') {
    throw new DomainError(422, 'INVALID_ACCEPTED_ANSWERS', '標準答案須輸入文字，一行一種答案。');
  }
  if (typeof prompt === 'string') {
    question.prompt = prompt;
    question.missingPrompt = false;
  }
  if (typeof acceptedAnswersText === 'string') {
    question.acceptedAnswers = acceptedAnswersText.split(/\r\n|\r|\n/).map(answer => answer.trim()).filter(Boolean);
  }
  ++question.questionRevision;
  catalogChanged(activity);
  return question;
}

function assertQuestionEditingAllowed(activity: Activity) {
  if (activity.rounds.some(round => round.phase === 'active' || round.phase === 'reviewing')) {
    throw new DomainError(409, 'ROUND_IN_PROGRESS', '請先公布目前回合結果，再編輯題目。');
  }
}

export function addManualQuestion(activity: Activity, input: unknown): RoundQuestion {
  assertQuestionEditingAllowed(activity);
  const { prompt, acceptedAnswersText } = (input ?? {}) as Record<string, unknown>;
  const unitId = randomUUID();
  if (!hasPrompt(unitId, prompt)) throw new DomainError(422, 'INVALID_PROMPT', '請填寫完整題幹。');
  const acceptedAnswers = typeof acceptedAnswersText === 'string'
    ? acceptedAnswersText.split(/\r\n|\r|\n/).map(answer => answer.trim()).filter(Boolean) : [];
  if (!acceptedAnswers.length) throw new DomainError(422, 'INVALID_ACCEPTED_ANSWERS', '請填寫至少一個標準答案，一行一種答案。');
  const question: RoundQuestion = {
    questionId: unitId, prompt, unitId, origin: 'manual', questionKey: randomUUID(),
    missingPrompt: false, acceptedAnswers, questionRevision: 0,
  };
  activity.units.push({ id: unitId, name: '手動題', questions: [question] });
  activity.queueUnitIds.push(unitId);
  catalogChanged(activity);
  return question;
}
