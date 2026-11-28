import { suggestAnswers } from './answer-suggestions.js';
import type { Worksheet } from '../../shared/api.js';
import { normalizeAcceptedAnswers } from '../../shared/api.js';
import { TeacherAccounts } from './accounts.js';
import express from 'express';
import type { Request, Response } from 'express';
import { join } from 'node:path';
import type { AppConfig } from './config.js';
import type { Activity } from './activity.js';
import { activityLocation, credential, memberCredential, requireTeacher, scopedAccess, teacherOnly, type ActivityAccess } from './access.js';
import { Classrooms, expiredActivity } from './classrooms.js';
import { DomainError, endRound, prepareRound, publishRound, publishSettlement, requireSubmissionTime, startRound, submitAnswers, updateReview } from './rounds.js';
import { makeView, previewFor, resultsFor, studentResultsFor } from './views.js';
import { projectionFor } from './projection.js';
import { importGoogleWorksheet, type ImportResult } from './worksheet/google-source.js';
import { buildResultsCsv } from './results-csv.js';
import { exportXlsx, writebackToGoogle } from './worksheet/writeback.js';
import { deleteQuestionUnit, reorderQueue, requireCatalogRevision, requireNextUnit } from './question-queue.js';
import { addManualQuestion, updateQuestion, updateQuestionCard } from './questions.js';
import { beginImport, publishImportedWorksheet } from './worksheet/import.js';
import { importXlsxWorksheet, XLSX_LIMIT } from './worksheet/xlsx-source.js';
import { addGroup, renameGroup, deleteGroup, changeMember, joinMember, mergeRoster, rosterFor, validateName } from './roster.js';
import { readRosterXlsx } from './roster-xlsx.js';

export interface AppServices {
  suggestAnswers?: (prompt: string) => Promise<string[]>;
  importWorksheet?: (url: unknown, sheetId?: number) => Promise<ImportResult>;
  writeback?: (rounds: import('../../shared/api.js').Round[]) => Promise<{ written: string[]; alreadyMatched: string[]; noWinner: string[] }>;
  now?: () => number;
}

function handle(work: (req: Request, res: Response) => unknown) {
  return async (req: Request, res: Response) => {
    try { await work(req, res); } catch (error) { if (!res.destroyed && !res.headersSent) domainError(res, error); }
  };
}

export function createApp(config: AppConfig, services: AppServices = {}, classrooms = new Classrooms(undefined, config.teacherPassword), accounts = new TeacherAccounts(config)) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const access = (req: Request) => scopedAccess(req, config, classrooms, accounts);
  const scoped: express.RequestHandler = (req, res, next) => {
    try { req.activityAccess = access(req); next(); }
    catch (error) { domainError(res, error); }
  };
  const teacherAuth = [scoped, requireTeacher];
  const teacher = (work: (req: Request, res: Response) => unknown) => handle((req, res) => {
    teacherOnly(req, config, accounts);
    return work(req, res);
  });
  const routeRoom = (req: Request) => classrooms.get(String(req.params.classroomId), teacherOnly(req, config, accounts));
  const routeActivity = (req: Request, context: ActivityAccess, change: (draft: Activity) => unknown) =>
    classrooms.mutate(context.room, context.activity, draft => { req.activityAccess = access(req); return change(draft); });
  function mutate(change: (draft: Activity, req: Request) => unknown, status = 200) {
    return handle(async (req, res) => {
      const result = await routeActivity(req, req.activityAccess!, draft => change(draft, req));
      res.status(status).json(result);
    });
  }

  function verifyImport(req: Request, activity: Activity) {
    const revision = req.header('X-Catalog-Revision');
    requireCatalogRevision(activity, revision && /^\d+$/.test(revision) ? Number(revision) : undefined);
    if (activity.worksheet && req.header('X-Confirm-Worksheet-Replacement') !== 'true') {
      throw new DomainError(409, 'REPLACEMENT_CONFIRMATION_REQUIRED', '請先確認重新匯入會清除既有題目和出題清單。');
    }
  }

  const staged = new WeakMap<Activity, { generation: number; worksheet: Worksheet }>();

  async function completeImport(req: Request, res: Response, result: ImportResult, generation: number) {
    const context = req.activityAccess!;
    const alive = () => !req.aborted && !res.destroyed;
    if ('candidates' in result) {
      await classrooms.exclusive(context.room, context.activity, () => {
        verifyImport(req, context.activity);
        if (context.activity.importGeneration !== generation || context.activity.rosterLocked || !alive()) {
          throw new DomainError(409, 'IMPORT_SUPERSEDED', '匯入期間活動或來源已更新，請重新匯入。');
        }
      });
      res.json({ candidates: result.candidates });
      return;
    }
    if (req.header('X-Prepare-Answers') === 'true' && result.worksheet) {
      const worksheet = result.worksheet;
      await classrooms.exclusive(context.room, context.activity, () => {
        access(req); verifyImport(req, context.activity);
        if (!alive() || context.activity.rosterLocked || context.activity.importGeneration !== generation) throw new DomainError(409, 'IMPORT_SUPERSEDED', '題源已更新，請重新預覽。');
        staged.set(context.activity, { generation, worksheet });
      });
      const parts = new Map(worksheet.units.flatMap(unit => unit.fillBlankIds.length > 1
        ? unit.fillBlankIds.map((id, index) => [id, `第 ${index + 1} 部分（題號 ${unit.questionIds[index]}）`] as const) : []));
      res.json({ generation, units: worksheet.units.map(({ id, name, fillBlankIds }) => ({ id, name, fillBlankIds })),
        questions: worksheet.fills.map(({ id, questionId, prompt }) => ({ id, questionId, prompt, part: parts.get(id) })) });
      return;
    }
    const preview = await routeActivity(req, context, draft => {
      verifyImport(req, draft);
      publishImportedWorksheet(draft, result, generation, context.activity.id, alive);
      return previewFor(draft);
    });
    res.json(preview);
  }

  // 檔案上傳先驗證授權、活動及格式，再由 Express 接收內容。
  app.post('/api/worksheet/import/xlsx', ...teacherAuth, async (req, res, next) => {
    try {
      const type = req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase();
      if (!['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'].includes(type ?? '')
        || (req.header('Content-Encoding') && req.header('Content-Encoding') !== 'identity')) {
        throw new DomainError(415, 'UNSUPPORTED_MEDIA_TYPE', '請直接上傳未壓縮的 XLSX 檔案。');
      }
      const { room, activity } = req.activityAccess!;
      req.importGeneration = await classrooms.exclusive(room, activity, () => { verifyImport(req, activity); return beginImport(activity).generation; });
      next();
    } catch (error) { domainError(res, error); }
  }, express.raw({ type: () => true, limit: XLSX_LIMIT, inflate: false }), handle(async (req, res) => {
    const raw = req.query.sheetId;
    let sheetId: number | undefined;
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) throw new DomainError(422, 'INVALID_SHEET_ID', '請選擇有效的工作表。');
      sheetId = Number(raw);
    }
    let name: string;
    try { name = decodeURIComponent(req.header('X-File-Name') ?? ''); }
    catch { throw new DomainError(422, 'INVALID_FILE_NAME', '檔名格式不正確，請重新選擇 XLSX。'); }
    const result = await importXlsxWorksheet(req.body ?? Buffer.alloc(0), name, sheetId);
    await completeImport(req, res, result, req.importGeneration!);
  }));
  app.post('/api/roster/import/xlsx', ...teacherAuth, (req, res, next) => {
    try {
      if (!req.is(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])) {
        throw new DomainError(415, 'UNSUPPORTED_MEDIA_TYPE', '請選擇 .xlsx 格式的組別名單。');
      }
      next();
    } catch (error) { domainError(res, error); }
  }, express.raw({ type: () => true, limit: XLSX_LIMIT, inflate: false }), handle(async (req, res) => {
    const rows = await readRosterXlsx(req.body);
    res.json(await routeActivity(req, req.activityAccess!, draft => mergeRoster(draft, rows, config.teacherPassword,
      () => classrooms.epoch === null ? null : classrooms.issue())));
  }));
  app.use(express.json({ limit: '100kb' }));

  app.post('/api/sessions', handle(async (req, res) => {
    const { role, secret } = credential(req);
    if (role === 'teacher' && req.body?.username !== undefined) return res.json(await accounts.login(req.body.username, secret));
    if (role === 'teacher' || req.header('Authorization')?.startsWith('Bearer ')) {
      teacherOnly(req, config, accounts);
      if (req.header('X-Classroom-Id')) {
        const { room } = access(req);
        return res.json({ role: 'teacher', ...classrooms.location(room) });
      }
      return res.json({ role: 'teacher' });
    }
    if (role !== 'student') throw new DomainError(401, 'UNAUTHORIZED', '請選擇身分並輸入教師密碼或加入碼。');
    const prior = req.header('X-Classroom-Id') ? access(req) : undefined;
    const match = prior ? { room: prior.room, groupId: prior.identity.groupId! } : classrooms.lookup(secret.trim());
    if (!match) throw new DomainError(401, 'ACCESS_REVOKED', '加入碼無效，請向老師確認。');
    const { room } = match;
    const activity = room.activity;
    const member = await classrooms.mutate(room, activity, draft => {
      if (!prior) return joinMember(draft, match.groupId, req.body?.name);
      const previous = draft.members.get(access(req).identity.memberId!);
      if (!previous || previous.name !== validateName(req.body?.name, '名稱')) {
        throw new DomainError(401, 'ACCESS_REVOKED', '學生身分已失效，請重新輸入加入碼與名稱。');
      }
      return previous;
    });
    const { classroomId, activityId, activityEpoch } = classrooms.location(room);
    return res.json({ role, classroomId, activityId, activityEpoch, classroomName: room.name, groupId: member.groupId,
      groupName: activity.groups.find(group => group.id === member.groupId)?.name, memberId: member.id, studentName: member.name,
      memberCredential: memberCredential(activityId, member.id) });
  }));

  app.post('/api/teachers', teacher(async (req, res) => {
    await accounts.update(teacherOnly(req, config, accounts), req.body?.username, req.body?.password, true, { displayName: req.body?.displayName });
    res.sendStatus(201);
  }));
  app.patch('/api/teachers/me/password', teacher(async (req, res) => {
    await accounts.update(teacherOnly(req, config, accounts), undefined, req.body?.password, false, { currentPassword: req.body?.currentPassword });
    res.sendStatus(204);
  }));
  app.delete('/api/sessions', handle((req, res) => {
    accounts.logout(req.header('Authorization')?.replace(/^Bearer /, '') ?? '');
    res.sendStatus(204);
  }));

  app.get('/api/classrooms', teacher((req, res) => res.json(classrooms.list(teacherOnly(req, config, accounts)))));
  app.post('/api/classrooms', teacher(async (req, res) => res.status(201).json(classrooms.location(await classrooms.create(req.body?.name, teacherOnly(req, config, accounts))))));
  app.get('/api/classrooms/:classroomId', teacher((req, res) => res.json(classrooms.location(routeRoom(req)))));
  app.delete('/api/classrooms/:classroomId', teacher(async (req, res) => {
    await classrooms.remove(routeRoom(req));
    res.status(204).end();
  }));
  app.post('/api/classrooms/:classroomId/activities', teacher(async (req, res) => {
    const room = routeRoom(req);
    activityLocation(req, classrooms, room);
    res.status(201).json(await classrooms.startNew(room, room.activity));
  }));
  app.get('/api/classrooms/:classroomId/activities/history', teacher((req, res) => {
    const room = routeRoom(req);
    res.json(classrooms.archivedRosters(room));
  }));
  app.get('/api/classrooms/:classroomId/results', teacher((req, res) => res.json(classrooms.history(routeRoom(req)))));
  app.get('/api/classrooms/:classroomId/activities/:activityId/rounds/:roundId/results', teacher((req, res) => {
    const room = routeRoom(req);
    const activity = room.activity.id === req.params.activityId ? room.activity : room.history.find(entry => entry.id === req.params.activityId);
    const round = activity?.rounds.find(entry => entry.id === req.params.roundId && entry.phase === 'ended');
    if (!round) throw new DomainError(404, 'ROUND_NOT_FOUND', '找不到已定案的回合，請重新載入歷史紀錄。');
    res.json(resultsFor(round));
  }));

  app.get('/api/roster', ...teacherAuth, (req, res) => res.json(rosterFor(req.activityAccess!.activity)));
  app.post('/api/groups', ...teacherAuth, mutate((draft, req) => {
    addGroup(draft, req.body?.name, config.teacherPassword, undefined, () => classrooms.epoch === null ? null : classrooms.issue());
    return rosterFor(draft);
  }, 201));
  app.patch('/api/groups/:id', ...teacherAuth, mutate((draft, req) => {
    renameGroup(draft, String(req.params.id), req.body?.name);
    return rosterFor(draft);
  }));
  app.delete('/api/groups/:id', ...teacherAuth, mutate((draft, req) => {
    deleteGroup(draft, String(req.params.id));
    return rosterFor(draft);
  }));
  for (const method of ['patch', 'delete'] as const) {
    app[method]('/api/groups/:groupId/members/:id', ...teacherAuth, mutate((draft, req) => {
      changeMember(draft, String(req.params.id), req.params.groupId, req.body?.targetGroupId, method === 'delete');
      return rosterFor(draft);
    }));
  }
  app.put('/api/roster', ...teacherAuth, (_req, res) => res.status(405).json({ code: 'ROSTER_UPDATE_REPLACED', message: '請使用新增、更名或刪除組別操作。' }));

  app.post('/api/worksheet/import', ...teacherAuth, handle(async (req, res) => {
    const { room, activity } = req.activityAccess!;
    const sheetId = req.body?.sheetId;
    if (sheetId !== undefined && (!Number.isSafeInteger(sheetId) || sheetId < 0)) throw new DomainError(422, 'INVALID_GID', '請選擇有效的工作表。');
    const { generation } = await classrooms.exclusive(room, activity, () => { verifyImport(req, activity); return beginImport(activity); });
    try {
      const result = services.importWorksheet ? await services.importWorksheet(req.body?.url, sheetId) : await importGoogleWorksheet(config, req.body?.url, sheetId);
      await completeImport(req, res, result, generation);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(500, 'IMPORT_FAILED', '匯入失敗，原有預覽仍保留。請重新檢查網址後再試。');
    }
  }));
  app.post('/api/worksheet/confirm', ...teacherAuth, mutate((activity, req) => {
    verifyImport(req, activity);
    const pending = staged.get(req.activityAccess!.activity);
    if (!pending || pending.generation !== req.body?.generation || activity.importGeneration !== pending.generation) throw new DomainError(409, 'IMPORT_SUPERSEDED', '題源已更新，請重新預覽。');
    const answers = req.body?.answers;
    if (!Array.isArray(answers)) throw new DomainError(422, 'INVALID_ANSWERS', '請重新確認各題的標準答案。');
    const byId = new Map<string, string[]>();
    const ids = new Set(pending.worksheet.fills.map(fill => fill.id));
    for (const row of answers) {
      if (!row || !ids.delete(row.id) || typeof row.text !== 'string') throw new DomainError(422, 'INVALID_ANSWERS', '請重新確認各題的標準答案。');
      byId.set(row.id, normalizeAcceptedAnswers(row.text));
    }
    publishImportedWorksheet(activity, { worksheet: pending.worksheet }, pending.generation, activity.id);
    for (const unit of activity.units) for (const q of unit.questions) if (q.fillBlankId) q.acceptedAnswers = byId.get(q.fillBlankId) ?? [];
    return previewFor(activity);
  }));
  app.post('/api/questions/suggest-answers', ...teacherAuth, handle(async (req, res) => {
    const prompt = req.body?.prompt;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) throw new DomainError(422, 'INVALID_PROMPT', '請輸入 1 至 8000 字的題幹。');
    const part = req.body?.part;
    if (part !== undefined && (typeof part !== 'string' || !part.trim())) throw new DomainError(422, 'INVALID_PART', '請選擇有效的小題。');
    const question = part ? `題組中請只回答指定小題：${part}\n題幹：${prompt}` : prompt;
    const answers = await (services.suggestAnswers ?? suggestAnswers)(question);
    access(req);
    res.json({ answers });
  }));
  app.post('/api/questions', ...teacherAuth, mutate((draft, req) => {
    requireCatalogRevision(draft, req.body?.catalogRevision);
    return addManualQuestion(draft, req.body);
  }, 201));
  app.patch('/api/questions/:questionKey', ...teacherAuth, mutate((draft, req) => {
    requireCatalogRevision(draft, req.body?.catalogRevision);
    return updateQuestion(draft, String(req.params.questionKey), req.body);
  }));
  app.patch('/api/questions/units/:unitId', ...teacherAuth, mutate((draft, req) => {
    requireCatalogRevision(draft, req.body?.catalogRevision);
    const unit = updateQuestionCard(draft, String(req.params.unitId), req.body?.questions);
    return { unit, catalogRevision: draft.catalogRevision };
  }));
  app.delete('/api/questions/units/:unitId', ...teacherAuth, mutate((draft, req) =>
    deleteQuestionUnit(draft, String(req.params.unitId), req.body?.catalogRevision)));
  app.put('/api/question-queue', ...teacherAuth, mutate((draft, req) => reorderQueue(draft, req.body ?? {})));
  app.post('/api/rounds/open-next', ...teacherAuth, mutate((draft, req) => {
    const unitId = req.body?.unitId;
    requireNextUnit(draft, unitId, req.body?.catalogRevision);
    const prepared = draft.rounds.find(round => round.phase === 'preparing' && round.unitId === unitId);
    const round = prepared ?? prepareRound(draft, unitId);
    return startRound(draft, round.id, services.now?.());
  }, 201));
  app.post('/api/rounds', ...teacherAuth, mutate((draft, req) => {
    requireNextUnit(draft, req.body?.unitId, req.body?.catalogRevision);
    return prepareRound(draft, req.body?.unitId);
  }, 201));
  app.post('/api/rounds/:id/start', ...teacherAuth, mutate((draft, req) => {
    const round = draft.rounds.find(round => round.id === req.params.id);
    if (!round) throw new DomainError(409, 'ROUND_EXPIRED', '回合已更新，請重新載入教師畫面。');
    requireNextUnit(draft, round.unitId, req.body?.catalogRevision);
    return startRound(draft, round.id, services.now?.());
  }));
  app.post('/api/rounds/:id/end', ...teacherAuth, mutate((draft, req) => endRound(draft, String(req.params.id))));
  app.patch('/api/rounds/:id/review', ...teacherAuth, mutate((draft, req) => updateReview(draft, String(req.params.id), req.body)));
  app.post('/api/rounds/:id/publish', ...teacherAuth, mutate((draft, req) => publishRound(draft, String(req.params.id), req.body?.reviewRevision, req.body?.supplements)));
  app.post('/api/settlement/publish', ...teacherAuth, mutate(publishSettlement));
  app.post('/api/rounds/:id/submissions', scoped, handle(async (req, res) => {
    const context = req.activityAccess!;
    if (context.identity.role !== 'student') throw new DomainError(403, 'FORBIDDEN', '此操作僅限學生組別使用。');
    const receivedAt = services.now?.() ?? performance.now();
    const roundId = String(req.params.id);
    const round = context.activity.rounds.find(item => item.id === roundId);
    if (round?.phase === 'active') requireSubmissionTime(round, context.identity.groupId!, receivedAt);
    await routeActivity(req, context, draft =>
      submitAnswers(draft, roundId, req.activityAccess!.identity.groupId!, req.body?.answers, receivedAt));
    res.status(201).json({ roundId, received: true });
  }));
  app.get('/api/rounds/:id/results', scoped, handle((req, res) => {
    const round = req.activityAccess!.activity.rounds.find(item => item.id === req.params.id);
    if (!round) throw new DomainError(404, 'ROUND_NOT_FOUND', '找不到指定回合。');
    if (round.phase !== 'ended') throw new DomainError(403, 'RESULTS_HIDDEN', '老師公布後才能查看結果。');
    const identity = req.activityAccess!.identity;
    res.json(identity.role === 'student' ? studentResultsFor(round, identity.groupId!) : resultsFor(round));
  }));
  app.get('/api/view', scoped, handle((req, res) => poll(req, res, () => {
    const { activity, identity } = access(req);
    return makeView(activity, identity, services.now?.(), true);
  })));

  app.get('/api/classrooms/:classroomId/projection', ...teacherAuth, handle((req, res) => poll(req, res, () => {
    const { room } = access(req);
    if (room.id !== req.params.classroomId) throw expiredActivity();
    return projectionFor(room, services.now?.());
  })));

  app.get('/api/results.csv', ...teacherAuth, handle((req, res) => {
    let csv: string;
    try { csv = buildResultsCsv(req.activityAccess!.activity); }
    catch (error) {
      if (error instanceof Error && error.message === 'NO_ENDED_ROUNDS') throw new DomainError(409, 'NO_ENDED_ROUNDS', '尚無已公布回合，請先公布結果再匯出。');
      throw error;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="classroom-results.csv"');
    // 讓 Excel 直接開啟 CSV 時辨識 UTF-8。
    res.send('\uFEFF' + csv);
  }));
  app.post('/api/worksheet/results.xlsx', ...teacherAuth, express.raw({ type: 'application/octet-stream', limit: XLSX_LIMIT }), handle(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new DomainError(415, 'INVALID_XLSX', '請上傳原始 XLSX 學習單。');
    const bytes = await exportXlsx(req.activityAccess!.activity, req.body);
    res.attachment('classroom-results.xlsx').send(bytes);
  }));
  app.post('/api/worksheet/writeback', ...teacherAuth, handle(async (req, res) => {
    const { room, activity } = req.activityAccess!;
    const source = activity.worksheet?.source;
    if (source?.kind !== 'google') throw new DomainError(409, 'WRITEBACK_NOT_SUPPORTED', source ? '請在結算頁選取原始 XLSX 並下載填好的副本。' : '目前沒有可回填的 Google 原稿，請下載活動 CSV。');
    const endedRounds = structuredClone(activity.rounds.filter(round => round.phase === 'ended'));
    if (!endedRounds.length) throw new DomainError(409, 'NO_ENDED_ROUNDS', '尚無已公布回合，請先公布結果再回填。');
    const sourceUnits = new Set(activity.worksheet!.units.map(unit => unit.id));
    const sourceRounds = endedRounds.filter(round => sourceUnits.has(round.unitId));
    const release = await classrooms.beginWriteback(room, activity, JSON.stringify([source.documentId, source.sheetId]));
    let result;
    try {
      result = !sourceRounds.length ? { written: [], alreadyMatched: [], noWinner: [] }
        : services.writeback ? await services.writeback(sourceRounds) : await writebackToGoogle(activity, config, sourceRounds);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(500, 'WRITEBACK_UNCONFIRMED', '寫回結果待確認，請先檢查來源工作表後再試。');
    } finally { await release(); }
    res.json(result);
  }));

  app.use('/api', (_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: '找不到這項操作，請重新整理頁面。' }));
  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 500;
    if (status === 413) return res.status(413).json({ code: 'REQUEST_TOO_LARGE', message: ['/api/roster/import/xlsx', '/api/worksheet/import/xlsx', '/api/worksheet/results.xlsx'].includes(req.path) ? '檔案超過 10 MB，請選擇較小的 XLSX 檔案。' : '資料超過 100 KB，請縮短內容後重試。' });
    if (status === 400) return res.status(400).json({ code: 'INVALID_JSON', message: '資料格式不正確，請檢查欄位後重試。' });
    res.status(status).json({ code: 'REQUEST_FAILED', message: status < 500 ? '請求內容不正確，請檢查後重試。' : '服務暫時無法完成操作，請稍後重試。' });
  });

  const frontend = join(process.cwd(), 'dist/frontend');
  app.use(express.static(frontend));
  app.get('*path', (_req, res) => res.sendFile(join(frontend, 'index.html')));
  return { app, classrooms };
}

async function poll<T extends { version: number; groupId?: string }>(req: Request, res: Response, read: () => T) {
  const after = Number(req.query.after);
  let view = read();
  const deadline = Date.now() + 20_000;
  const unchanged = () => after === view.version && (!view.groupId || !req.query.group || req.query.group === view.groupId);
  while (unchanged() && Date.now() < deadline && !res.destroyed) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (res.destroyed) return;
    view = read();
  }
  if (!res.destroyed) {
    if (unchanged()) res.status(204).end();
    else res.json(view);
  }
}

function domainError(res: Response, error: unknown) {
  if (error instanceof DomainError) return res.status(error.status).json({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
  return res.status(500).json({ code: 'INTERNAL_ERROR', message: '操作未完成，請重新整理後再試。' });
}
