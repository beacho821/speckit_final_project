import type { RoundQuestion, SupplementCandidate, TeacherSupplement } from './api.js';

type SourceQuestion = Pick<RoundQuestion, 'questionId' | 'acceptedAnswers'>;

export function supplementCandidates(questions: readonly SourceQuestion[], legacy: readonly TeacherSupplement[]): SupplementCandidate[] {
  const saved = new Map(legacy.filter(item => item.text.trim()).map(item => [item.questionId, item.text]));
  const candidates: SupplementCandidate[] = [];
  for (const { questionId, acceptedAnswers } of questions) {
    const manual = saved.get(questionId);
    if (manual !== undefined) candidates.push({ questionId, text: manual, source: 'legacy' });
    else {
      const text = acceptedAnswers.find(answer => answer.trim());
      if (text !== undefined) candidates.push({ questionId, text, source: 'configured' });
    }
  }
  return candidates;
}

export function selectReviewSupplements(
  questions: readonly { questionId: string }[],
  correctIds: ReadonlySet<string>,
  candidates: readonly SupplementCandidate[],
) {
  const byId = new Map(candidates.map(candidate => [candidate.questionId, candidate]));
  const selected: SupplementCandidate[] = [];
  const missingSupplementQuestionIds: string[] = [];
  for (const { questionId } of questions) {
    if (correctIds.has(questionId)) continue;
    const candidate = byId.get(questionId);
    if (candidate) selected.push(candidate);
    else missingSupplementQuestionIds.push(questionId);
  }
  return { selected, missingSupplementQuestionIds };
}
