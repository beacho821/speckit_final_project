import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../backend/src/config.js';

const original = { teacher: process.env.TEACHER_PASSWORD, groups: process.env.GROUP_CODES_JSON, google: process.env.GOOGLE_SERVICE_ACCOUNT_JSON };
function setConfig(teacher = 'teacher-test-secret', groups = '{"a":"alpha-test-secret","b":"beta-test-secret"}') {
  process.env.TEACHER_PASSWORD = teacher; process.env.GROUP_CODES_JSON = groups; delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

afterEach(() => {
  if (original.teacher === undefined) delete process.env.TEACHER_PASSWORD; else process.env.TEACHER_PASSWORD = original.teacher;
  if (original.groups === undefined) delete process.env.GROUP_CODES_JSON; else process.env.GROUP_CODES_JSON = original.groups;
  if (original.google === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = original.google;
});

describe('環境設定', () => {
  it('讀取教師與組別代碼，Google 設定可留空供本機測試', () => {
    setConfig();
    const config = loadConfig();
    expect(config.groupCodes.get('a')).toBe('alpha-test-secret');
    expect(config.googleServiceAccount).toBeUndefined();
  });
  it.each([
    ['', '{"a":"alpha"}'], ['teacher', '{"a":"teacher"}'], ['teacher', '{"a":"alpha","b":"alpha"}'], ['teacher', '{bad json'], ['teacher', '{" ":"alpha"}'],
  ])('拒絕不合法環境值且錯誤訊息不含機敏內容', (teacher, groups) => {
    setConfig(teacher, groups);
    try { loadConfig(); throw new Error('應拒絕設定'); }
    catch (error) {
      expect((error as Error).message).not.toContain('teacher-test-secret');
      expect((error as Error).message).not.toContain('alpha');
    }
  });
  it('拒絕格式錯誤的 Google JSON，不要求未使用 Google 時提供帳戶', () => {
    setConfig(); process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{bad';
    expect(() => loadConfig()).toThrow('GOOGLE_SERVICE_ACCOUNT_JSON');
  });
});
