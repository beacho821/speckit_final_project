import type { SessionResponse } from '../../shared/api';

export function basicHeader(role: string, credential: string) {
  const bytes = new TextEncoder().encode(`${role}:${credential}`);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return `Basic ${btoa(binary)}`;
}

export function activityHeaders(session: SessionResponse, credential: string): HeadersInit {
  return { Authorization: basicHeader(session.role, credential), 'X-Activity-Id': session.activityId, ...(session.role === 'student' ? { 'X-Member-Id': session.memberId ?? '' } : {}) };
}

export async function readError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return { message: typeof body.message === 'string' ? body.message : '操作未完成，請稍後再試。', code: body.code, details: body.details };
}
