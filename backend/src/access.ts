import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from './config.js';
import type { Activity } from './activity.js';
import { type Classroom, type Classrooms, expiredActivity } from './classrooms.js';
import { DomainError } from './rounds.js';

export interface Identity { role: 'teacher' | 'student'; groupId?: string; memberId?: string }
export interface ActivityAccess { room: Classroom; activity: Activity; identity: Identity }

export function credential(req: Request) {
  const header = req.header('Authorization');
  const value = header?.startsWith('Basic ') && /^[A-Za-z0-9+/]+={0,2}$/.test(header.slice(6))
    ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
  const colon = value.indexOf(':');
  return { role: value.slice(0, colon), secret: colon < 0 ? '' : value.slice(colon + 1) };
}

export function teacherOnly(req: Request, config: AppConfig) {
  const { role, secret } = credential(req);
  if (role === 'student') throw new DomainError(403, 'FORBIDDEN', '此操作僅限教師使用，請以教師身分登入。');
  if (role !== 'teacher' || secret !== config.teacherPassword) throw new DomainError(401, 'UNAUTHORIZED', '教師密碼無效，請重新輸入。');
}

export function activityLocation(req: Request, classrooms: Classrooms, room: Classroom) {
  if (req.header('X-Classroom-Id') !== room.id || req.header('X-Activity-Id') !== room.activity.id
    || req.header('X-Activity-Epoch') !== classrooms.runtime) throw expiredActivity();
}

export function scopedAccess(req: Request, config: AppConfig, classrooms: Classrooms): ActivityAccess {
  const { role, secret } = credential(req);
  if (role !== 'teacher' && role !== 'student') throw new DomainError(401, 'UNAUTHORIZED', '請重新輸入教師密碼或學生加入碼。');
  if (role === 'teacher') teacherOnly(req, config);
  const id = req.header('X-Classroom-Id');
  if (req.header('X-Activity-Epoch') !== classrooms.runtime || !id) throw expiredActivity();
  let room;
  try { room = classrooms.get(id); }
  catch (error) { if (error instanceof DomainError && error.status === 404) throw expiredActivity(); throw error; }
  activityLocation(req, classrooms, room);
  const activity = room.activity;
  if (role === 'teacher') return { room, activity, identity: { role } };
  const match = classrooms.lookup(secret.trim());
  if (!match || match.room !== room) throw new DomainError(401, 'ACCESS_REVOKED', '加入碼無效，請向老師確認。');
  const memberId = req.header('X-Member-Id');
  if (!memberId || activity.members.get(memberId)?.groupId !== match.groupId) throw new DomainError(401, 'UNAUTHORIZED', '加入身分無效，請重新輸入加入碼與名稱。');
  return { room, activity, identity: { role, memberId, groupId: match.groupId } };
}

declare global { namespace Express { interface Request { activityAccess?: ActivityAccess; importGeneration?: number } } }

export function requireTeacher(req: Request, res: Response, next: NextFunction) {
  if (req.activityAccess?.identity.role !== 'teacher') return res.status(403).json({ code: 'FORBIDDEN', message: '此操作僅限教師使用，請以教師身分登入。' });
  next();
}
