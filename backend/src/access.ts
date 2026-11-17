import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from './config.js';
import type { Activity } from './activity.js';

export interface Identity { role: 'teacher' | 'student'; groupId?: string }
declare global { namespace Express { interface Request { identity?: Identity } } }

function reject(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ code, message });
}

export function authenticate(config: AppConfig, activity: Activity, requireActivity = true) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (requireActivity && req.header('X-Activity-Id') !== activity.id) return reject(res, 409, 'ACTIVITY_EXPIRED', '活動已重新啟動，請重新登入。');
    const header = req.header('Authorization');
    if (!header?.startsWith('Basic ')) return reject(res, 401, 'UNAUTHORIZED', '請輸入有效憑證後登入。');
    let decoded: string;
    try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); }
    catch { return reject(res, 401, 'UNAUTHORIZED', '憑證格式不正確，請重新輸入。'); }
    const separator = decoded.indexOf(':');
    if (separator < 0) return reject(res, 401, 'UNAUTHORIZED', '憑證格式不正確，請重新輸入。');
    const user = decoded.slice(0, separator), credential = decoded.slice(separator + 1);
    let identity: Identity | undefined;
    if (user === 'teacher' && credential === config.teacherPassword) identity = { role: 'teacher' };
    else if (user === 'student') {
      const groupId = [...config.groupCodes].find(([, code]) => code === credential)?.[0];
      if (groupId && activity.groups.some(group => group.id === groupId)) identity = { role: 'student', groupId };
    }
    if (!identity) return reject(res, 401, 'UNAUTHORIZED', '登入憑證無效，請重新輸入對應憑證。');
    req.identity = identity;
    next();
  };
}

export function requireTeacher(req: Request, res: Response, next: NextFunction) {
  if (req.identity?.role !== 'teacher') return reject(res, 403, 'FORBIDDEN', '此操作僅限教師使用，請以教師身分登入。');
  next();
}
