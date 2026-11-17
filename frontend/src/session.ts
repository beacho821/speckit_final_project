import type { SessionResponse } from '../../shared/api';

export const SESSION_KEY = 'classroom.student';
export interface SavedStudent { version: 1; activityId: string; joinCode: string; studentName: string; memberId: string }

export function readStudent(): SavedStudent | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !['activityId', 'joinCode', 'studentName', 'memberId'].every(key => typeof saved[key] === 'string' && saved[key])) {
      clearStudent(); return null;
    }
    return saved;
  } catch { clearStudent(); return null; }
}

export function clearStudent() {
  try { sessionStorage.removeItem(SESSION_KEY); }
  catch { /* 儲存不可用時仍可登出。 */ }
}

export function saveStudent(session: SessionResponse, joinCode: string) {
  if (session.role !== 'student') return true;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      version: 1, activityId: session.activityId, joinCode,
      studentName: session.studentName, memberId: session.memberId,
    }));
    return true;
  } catch { return false; }
}
