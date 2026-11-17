import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../backend/src/app.js';
import { identifyWorksheet } from '../../backend/src/worksheet/identify.js';
import { DomainError } from '../../backend/src/rounds.js';
import type { AppConfig } from '../../backend/src/config.js';
import { makeMarkedWorksheet, makeMixedWorksheet, makeSimpleWorksheet } from '../fixtures/guided-notes.js';

const config: AppConfig = { teacherPassword: 'teacher-preview-secret', groupCodes: new Map([['a', 'alpha-preview-secret']]), port: 0 };
const sourceFor = (documentId: string, sheetId: number, sheetTitle: string) => ({ documentId, sheetId, sheetTitle, importedAt: 1 });
const { app, activity } = createApp(config, { importWorksheet: async url => {
  const fixture = url === 'single' ? await makeSimpleWorksheet() : url === 'mixed' ? await makeMixedWorksheet() : url === 'moved' ? await makeMarkedWorksheet() : null;
  if (!fixture) throw new DomainError(422, 'INVALID_SHEET_URL', '來源格式錯誤，請修正後重試。');
  return { worksheet: { source: sourceFor(String(url), 7, fixture.sheet.name), ...identifyWorksheet(fixture.sheet) } };
} });
let server: ReturnType<typeof app.listen>; let base = '';
const auth = `Basic ${Buffer.from(`teacher:${config.teacherPassword}`).toString('base64')}`;
beforeAll(async () => { server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

describe('樣本學習單匯入入口', () => {
  it('三種版面經教師 HTTP 匯入後與預期題號、單位及填空數一致', async () => {
    const login = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { Authorization: auth } });
    const { activityId } = await login.json() as { activityId: string };
    const expectations = [
      { url: 'single', unitCount: 6, fillCount: 6, questionIds: ['1', '2', '3', '4', '5', '6'] },
      { url: 'mixed', unitCount: 4, fillCount: 6, questionIds: ['1（1）', '1（2）', '2（1）', '2（2）', '3', '4'] },
      { url: 'moved', unitCount: 4, fillCount: 6, questionIds: ['5', '8', '9', '10', '11', '12'] },
    ];
    let previous: typeof activity.worksheet = null;
    for (const expected of expectations) {
      const response = await fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { Authorization: auth, 'X-Activity-Id': activityId, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: expected.url }) });
      expect(response.status).toBe(200);
      const preview = await response.json() as { unitCount: number; fillCount: number; units: Array<{ questionIds: string[] }> };
      expect(preview.unitCount).toBe(expected.unitCount); expect(preview.fillCount).toBe(expected.fillCount);
      expect(preview.units.flatMap(unit => unit.questionIds)).toEqual(expected.questionIds);
      previous = activity.worksheet;
    }
    const invalid = await fetch(`${base}/api/worksheet/import`, { method: 'POST', headers: { Authorization: auth, 'X-Activity-Id': activityId, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'invalid' }) });
    expect(invalid.status).toBe(422); expect(activity.worksheet).toBe(previous);
  });
});
