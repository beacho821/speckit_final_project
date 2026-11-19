export function questionLabel(question: { questionNumber?: number; partNumber?: number | null; questionId?: string }) {
  if (question.questionNumber === undefined) return question.questionId ?? '題目';
  return `第 ${question.questionNumber} 題${question.partNumber == null ? '' : `，第 ${question.partNumber} 部分`}`;
}
