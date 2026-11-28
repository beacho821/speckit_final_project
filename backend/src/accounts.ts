import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from './classroom-store.js';
import { DomainError } from './rounds.js';
import type { AppConfig } from './config.js';

const derive = promisify(scrypt);
type Account = { id: string; username: string; displayName?: string; salt: string; hash: string };
const denied = () => new DomainError(401, 'UNAUTHORIZED', '教師帳號或密碼無效，請重新登入。');

async function matchesPassword(account: Account, password: unknown) {
  if (typeof password !== 'string' || !password.length || password.length > 256) return false;
  const actual = await derive(password, account.salt, 64) as Buffer;
  return timingSafeEqual(Buffer.from(account.hash, 'hex'), actual);
}

export class TeacherAccounts {
  private rows: Account[] = [];
  private sessions = new Map<string, { id: string; expires: number }>();
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private config: AppConfig, private directory?: string) {}

  static async open(config: AppConfig, directory: string) {
    const accounts = new TeacherAccounts(config, directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const rows = JSON.parse(await readFile(join(directory, 'accounts.json'), 'utf8'));
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row.username !== 'string' || typeof row.id !== 'string' || row.id === 'master' || !/^[0-9a-f]{32}$/.test(row.salt) || !/^[0-9a-f]{128}$/.test(row.hash))) throw Error();
      if (rows.some(row => row.displayName !== undefined && typeof row.displayName !== 'string')) throw Error();
      accounts.rows = rows;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('帳號資料無法讀取，請檢查本機存檔。');
    }
    return accounts;
  }

  async login(username: unknown, password: string) {
    let id: string;
    let displayName: string;
    if (username === (this.config.teacherUsername ?? 'teacher')) {
      if (password !== this.config.teacherPassword) throw denied();
      id = 'master';
      displayName = this.config.teacherDisplayName || this.config.teacherUsername || 'teacher';
    } else {
      const row = this.rows.find(item => item.username === username);
      if (!row || !await matchesPassword(row, password) || !this.rows.includes(row)) throw denied();
      id = row.id;
      displayName = row.displayName || row.username;
    }
    for (const [key, session] of this.sessions) if (session.expires <= Date.now()) this.sessions.delete(key);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, { id, expires: Date.now() + 12 * 3600000 });
    return { role: 'teacher', token, master: id === 'master', displayName };
  }

  identity(token: string) {
    const session = this.sessions.get(token);
    if (!session || session.expires <= Date.now()) throw denied();
    return session.id;
  }

  logout(token: string) { this.sessions.delete(token); }

  update(owner: string, username: unknown, password: unknown, creating: boolean, fields: { currentPassword?: unknown; displayName?: unknown } = {}) {
    const work = this.pending.catch(() => {}).then(async () => {
      if (creating !== (owner === 'master')) throw new DomainError(403, 'FORBIDDEN', '主帳號可建立教師；子帳號僅可修改自己的密碼。');
      if (typeof password !== 'string' || password.length < 8 || password.length > 256 || !password.trim()) throw new DomainError(422, 'INVALID_PASSWORD', '密碼須為 8 至 256 字，請重新輸入。');
      const prior = this.rows.find(row => row.id === owner);
      if (!creating && (!prior || !await matchesPassword(prior, fields.currentPassword))) {
        throw new DomainError(403, 'CURRENT_PASSWORD_INCORRECT', '目前密碼不正確，請重新輸入。');
      }
      let displayName = prior?.displayName;
      if (creating && fields.displayName !== undefined) {
        if (typeof fields.displayName !== 'string' || fields.displayName.trim().length > 40) {
          throw new DomainError(422, 'INVALID_DISPLAY_NAME', '教師姓名最多可填寫 40 個字。');
        }
        displayName = fields.displayName.trim() || undefined;
      }
      const name = creating && typeof username === 'string' ? username.trim() : prior?.username;
      if (!name || !/^[\p{L}\p{N}_.-]{1,64}$/u.test(name)) throw new DomainError(422, 'INVALID_USERNAME', '帳號限 1 至 64 個文字、數字、點、底線或連字號。');
      if (creating && (name === (this.config.teacherUsername ?? 'teacher') || this.rows.some(row => row.username === name))) throw new DomainError(409, 'DUPLICATE_ACCOUNT', '帳號已使用，請更換名稱。');
      const salt = randomBytes(16).toString('hex');
      const hash = (await derive(password, salt, 64) as Buffer).toString('hex');
      const row = { id: creating ? randomUUID() : owner, username: name, displayName, salt, hash };
      const next = [...this.rows.filter(item => item.id !== row.id), row];
      if (this.directory) await atomicJson(join(this.directory, 'accounts.json'), next);
      this.rows = next;
      if (!creating) for (const [token, session] of this.sessions) if (session.id === owner) this.sessions.delete(token);
    });
    this.pending = work;
    return work;
  }
}
