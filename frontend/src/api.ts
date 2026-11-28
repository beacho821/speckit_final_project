import type { SessionResponse, StudentRoundResultLine } from '../../shared/api';

export function basicHeader(role: string, credential: string, login = false) {
  if (!login && role === "teacher" && credential.startsWith("session:")) return "Bearer " + credential.slice(8);
  const bytes = new TextEncoder().encode(`${role}:${credential}`);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return `Basic ${btoa(binary)}`;
}

export function activityHeaders(session: SessionResponse, credential: string): HeadersInit {
  return { Authorization: basicHeader(session.role, credential), 'X-Activity-Id': session.activityId, ...(session.classroomId && session.activityEpoch ? { 'X-Classroom-Id': session.classroomId, 'X-Activity-Epoch': session.activityEpoch } : {}), ...(session.role === 'student' ? { 'X-Member-Id': session.memberId ?? '' } : {}) };
}

export async function readError(response: Response) {
  const body = await response.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code : undefined;
  const message = typeof body?.message === 'string' && body.message.trim()
    ? body.message : '操作未完成，請確認連線後再試。';
  return { message, code, details: body?.details };
}

export class ApiRequestError extends Error {}

export async function requireOk(response: Response) {
  if (!response.ok) throw new ApiRequestError((await readError(response)).message);
}

export function requestMessage(cause: unknown, fallback: string) {
  return cause instanceof ApiRequestError ? cause.message : fallback;
}

export async function readList<T>(response: Response): Promise<T[]> {
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error();
  return data;
}

export async function fetchStudentRoundResults(
  roundId: string, headers: HeadersInit, signal: AbortSignal, onExpired?: () => void,
): Promise<StudentRoundResultLine[]> {
  const response = await fetch(`/api/rounds/${encodeURIComponent(roundId)}/results`, { headers, signal });
  if (!response.ok) {
    const issue = await readError(response);
    if (!signal.aborted && (response.status === 401 || issue.code === 'ACTIVITY_EXPIRED')) onExpired?.();
    if (response.status >= 500 && !issue.code) throw new Error();
    throw new ApiRequestError(issue.message);
  }
  const rows = await readList<StudentRoundResultLine>(response);
  if (rows.some(row => !row || !Number.isSafeInteger(row.questionNumber)
    || (row.partNumber !== null && !Number.isSafeInteger(row.partNumber))
    || ![row.prompt, row.ownAnswer, row.publishedAnswer].every(text => text === null || typeof text === 'string')
    || (row.correct !== null && typeof row.correct !== 'boolean'))) throw new Error();
  return rows;
}
