import type { SessionResponse } from '../../shared/api';

export const SESSION_KEY = 'classroom.student';
export type SavedStudent = { activityId: string; classroomId?: string; activityEpoch?: string; studentName: string; memberId: string } &
  ({ version: 1; joinCode: string } | { version: 2; memberCredential: string });

export function readStudent(): SavedStudent | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const credentialKey = saved.version === 2 ? 'memberCredential' : 'joinCode';
    if (![1, 2].includes(saved.version) || !['activityId', credentialKey, 'studentName', 'memberId'].every(key => typeof saved[key] === 'string' && saved[key])) {
      clearStudent(); return null;
    }
    if (saved.classroomId !== undefined || saved.activityEpoch !== undefined) {
      if (typeof saved.classroomId !== 'string' || !saved.classroomId || typeof saved.activityEpoch !== 'string' || !saved.activityEpoch) {
        clearStudent(); return null;
      }
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
      ...(session.memberCredential ? { version: 2, memberCredential: session.memberCredential } : { version: 1, joinCode }),
      activityId: session.activityId,
      ...(session.classroomId && session.activityEpoch ? { classroomId: session.classroomId, activityEpoch: session.activityEpoch } : {}),
      studentName: session.studentName, memberId: session.memberId,
    }));
    return true;
  } catch { return false; }
}
