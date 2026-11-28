import type { Request, Response, NextFunction } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TeacherAccounts } from './accounts.js';
import type { AppConfig } from './config.js';
import type { Activity } from './activity.js';
import { type Classroom, type Classrooms, expiredActivity } from './classrooms.js';
import { DomainError } from './rounds.js';

export interface Identity { role: 'teacher' | 'student'; groupId?: string; memberId?: string }
export interface ActivityAccess { room: Classroom; activity: Activity; identity: Identity }

const memberSigningKey = randomBytes(32);
export function memberCredential(activityId: string, memberId: string) {
  return 'member.' + createHmac('sha256', memberSigningKey).update(JSON.stringify([activityId, memberId])).digest('hex');
}

export function credential(req: Request) {
  const header = req.header('Authorization');
  const value = header?.startsWith('Basic ') && /^[A-Za-z0-9+/]+={0,2}$/.test(header.slice(6))
    ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
  const colon = value.indexOf(':');
  return { role: value.slice(0, colon), secret: colon < 0 ? '' : value.slice(colon + 1) };
}

export function teacherOnly(req: Request, config: AppConfig, accounts?: TeacherAccounts) {
  const header = req.header("Authorization");
  if (accounts && header?.startsWith("Bearer ")) return accounts.identity(header.slice(7));
  const { role, secret } = credential(req);
  if (role === 'student') throw new DomainError(403, 'FORBIDDEN', '此操作僅限教師使用，請以教師身分登入。');
  if (role !== 'teacher' || (config.teacherUsername ?? 'teacher') !== 'teacher' || secret !== config.teacherPassword) throw new DomainError(401, 'UNAUTHORIZED', '教師密碼無效，請重新輸入。');
  return "master";
}

export function activityLocation(req: Request, classrooms: Classrooms, room: Classroom) {
  if (req.header('X-Classroom-Id') !== room.id || req.header('X-Activity-Id') !== room.activity.id
    || req.header('X-Activity-Epoch') !== classrooms.runtime) throw expiredActivity();
}

export function scopedAccess(req: Request, config: AppConfig, classrooms: Classrooms, accounts?: TeacherAccounts): ActivityAccess {
  const { role, secret } = credential(req);
  const teacher = role === 'teacher' || req.header('Authorization')?.startsWith('Bearer ');
  if (!teacher && role !== 'student') throw new DomainError(401, 'UNAUTHORIZED', '請重新輸入教師密碼或學生加入碼。');
  const owner = teacher ? teacherOnly(req, config, accounts) : undefined;
  const id = req.header('X-Classroom-Id');
  if (req.header('X-Activity-Epoch') !== classrooms.runtime || !id) throw expiredActivity();
  let room;
  try { room = classrooms.get(id, owner); }
  catch (error) { if (error instanceof DomainError && error.status === 404) throw expiredActivity(); throw error; }
  activityLocation(req, classrooms, room);
  const activity = room.activity;
  if (teacher) return { room, activity, identity: { role: "teacher" } };
  const memberId = req.header('X-Member-Id');
  const member = memberId && activity.members.get(memberId);
  if (member && /^member\.[0-9a-f]{64}$/.test(secret) && activity.joinCodes.has(member.groupId)
    && timingSafeEqual(Buffer.from(secret), Buffer.from(memberCredential(activity.id, member.id)))) {
    return { room, activity, identity: { role: 'student', memberId: member.id, groupId: member.groupId } };
  }
  const match = classrooms.lookup(secret.trim());
  if (member && activity.joinCodes.has(member.groupId) && activity.memberLoginCodes.get(member.id)?.has(secret.trim())) {
    return { room, activity, identity: { role: 'student', memberId: member.id, groupId: member.groupId } };
  }
  if (!match || match.room !== room) throw new DomainError(401, 'ACCESS_REVOKED', '加入碼無效，請向老師確認。');
  if (!member || member.groupId !== match.groupId) throw new DomainError(401, 'UNAUTHORIZED', '加入身分無效，請重新輸入加入碼與名稱。');
  return { room, activity, identity: { role: 'student', memberId: member.id, groupId: member.groupId } };
}

declare global { namespace Express { interface Request { activityAccess?: ActivityAccess; importGeneration?: number } } }

export function requireTeacher(req: Request, res: Response, next: NextFunction) {
  if (req.activityAccess?.identity.role !== 'teacher') return res.status(403).json({ code: 'FORBIDDEN', message: '此操作僅限教師使用，請以教師身分登入。' });
  next();
}
