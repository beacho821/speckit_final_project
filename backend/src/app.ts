import express from 'express';
import type { Request, Response } from 'express';
import { join } from 'node:path';
import type { AppConfig } from './config.js';
import type { Activity } from './activity.js';
import { activityLocation, credential, requireTeacher, scopedAccess, teacherOnly, type ActivityAccess } from './access.js';
import { Classrooms, expiredActivity } from './classrooms.js';
import { DomainError, endRound, prepareRound, publishRound, startRound, submitAnswers, updateReview } from './rounds.js';
import { makeView, previewFor, resultsFor, studentResultsFor } from './views.js';
import { projectionFor } from './projection.js';
import { importGoogleWorksheet, type ImportResult } from './worksheet/google-source.js';
import { buildResultsCsv } from './results-csv.js';
import { writebackToGoogle } from './worksheet/writeback.js';
import { addToQueue, deleteQuestionUnit, reorderQueue, requireCatalogRevision, requireNextUnit } from './question-queue.js';
import { addManualQuestion, updateQuestion } from './questions.js';
import { beginImport, publishImportedWorksheet } from './worksheet/import.js';
import { importXlsxWorksheet, XLSX_LIMIT } from './worksheet/xlsx-source.js';
import { addGroup, renameGroup, deleteGroup, joinMember, rosterFor, validateName } from './roster.js';

export interface AppServices {
  importWorksheet?: (url: unknown, sheetId?: number) => Promise<ImportResult>;
  writeback?: (rounds: import('../../shared/api.js').Round[]) => Promise<{ written: string[]; alreadyMatched: string[]; noWinner: string[] }>;
  now?: () => number;
}

function handle(work: (req: Request, res: Response) => unknown) {
  return async (req: Request, res: Response) => {
    try { await work(req, res); } catch (error) { if (!res.destroyed && !res.headersSent) domainError(res, error); }
  };
}

export function createApp(config: AppConfig, services: AppServices = {}, classrooms = new Classrooms(undefined, config.teacherPassword)) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const access = (req: Request) => scopedAccess(req, config, classrooms);
  const scoped: express.RequestHandler = (req, res, next) => {
    try { req.activityAccess = access(req); next(); }
    catch (error) { domainError(res, error); }
  };
  const teacherAuth = [scoped, requireTeacher];
  const teacher = (work: (req: Request, res: Response) => unknown) => handle((req, res) => {
    teacherOnly(req, config);
    return work(req, res);
  });
  const routeRoom = (req: Request) => classrooms.get(String(req.params.classroomId));
  const routeActivity = (req: Request, context: ActivityAccess, change: (draft: Activity) => unknown) =>
    classrooms.mutate(context.room, context.activity, draft => { access(req); return change(draft); });
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
  app.use(express.json({ limit: '100kb' }));

  app.post('/api/sessions', handle(async (req, res) => {
    const { role, secret } = credential(req);
    if (role === 'teacher') {
      teacherOnly(req, config);
      if (req.header('X-Classroom-Id')) {
        const { room } = access(req);
        return res.json({ role, ...classrooms.location(room) });
      }
      return res.json({ role });
    }
    if (role !== 'student') throw new DomainError(401, 'UNAUTHORIZED', '請選擇身分並輸入教師密碼或加入碼。');
    const priorRoom = req.header('X-Classroom-Id');
    if (priorRoom) {
      if (req.header('X-Activity-Epoch') !== classrooms.runtime) throw expiredActivity();
      let room: ReturnType<Classrooms['get']>;
      try { room = classrooms.get(priorRoom); } catch { throw expiredActivity(); }
      activityLocation(req, classrooms, room);
    }
    const match = classrooms.lookup(secret.trim());
    if (!match) throw new DomainError(401, 'ACCESS_REVOKED', '加入碼無效，請向老師確認。');
    const { room, groupId } = match;
    if (priorRoom && priorRoom !== room.id) throw expiredActivity();
    const activity = room.activity;
    const member = await classrooms.mutate(room, activity, draft => {
      if (!priorRoom) return joinMember(draft, groupId, req.body?.name);
      const previous = draft.members.get(req.header('X-Member-Id') ?? '');
      if (!previous || previous.groupId !== groupId || previous.name !== validateName(req.body?.name, '名稱')) {
        throw new DomainError(401, 'ACCESS_REVOKED', '學生身分已失效，請重新輸入加入碼與名稱。');
      }
      return previous;
    });
    const { classroomId, activityId, activityEpoch } = classrooms.location(room);
    return res.json({ role, classroomId, activityId, activityEpoch, classroomName: room.name, groupId,
      groupName: activity.groups.find(group => group.id === groupId)?.name, memberId: member.id, studentName: member.name });
  }));

  app.get('/api/classrooms', teacher((_req, res) => res.json(classrooms.list())));
  app.post('/api/classrooms', teacher(async (req, res) => res.status(201).json(classrooms.location(await classrooms.create(req.body?.name)))));
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
  app.post('/api/questions', ...teacherAuth, mutate((draft, req) => {
    requireCatalogRevision(draft, req.body?.catalogRevision);
    return addManualQuestion(draft, req.body);
  }, 201));
  app.patch('/api/questions/:questionKey', ...teacherAuth, mutate((draft, req) => {
    requireCatalogRevision(draft, req.body?.catalogRevision);
    return updateQuestion(draft, String(req.params.questionKey), req.body);
  }));
  app.delete('/api/questions/units/:unitId', ...teacherAuth, mutate((draft, req) =>
    deleteQuestionUnit(draft, String(req.params.unitId), req.body?.catalogRevision)));
  app.post('/api/question-queue', ...teacherAuth, mutate((draft, req) => addToQueue(draft, req.body ?? {})));
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
  app.post('/api/rounds/:id/publish', ...teacherAuth, mutate((draft, req) => publishRound(draft, String(req.params.id), req.body?.reviewRevision)));
  app.post('/api/rounds/:id/submissions', scoped, mutate((draft, req) => {
    const identity = req.activityAccess!.identity;
    if (identity.role !== 'student') throw new DomainError(403, 'FORBIDDEN', '此操作僅限學生組別使用。');
    submitAnswers(draft, String(req.params.id), identity.groupId!, req.body?.answers, services.now?.());
    return { roundId: req.params.id, received: true };
  }, 201));
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
    return projectionFor(room);
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
    res.send(csv);
  }));
  app.post('/api/worksheet/writeback', ...teacherAuth, handle(async (req, res) => {
    const { room, activity } = req.activityAccess!;
    const source = activity.worksheet?.source;
    if (source?.kind !== 'google') throw new DomainError(409, 'WRITEBACK_NOT_SUPPORTED', source ? '本機 XLSX 學習單不支援回填原檔，請下載活動 CSV。' : '目前沒有可回填的 Google 原稿，請下載活動 CSV。');
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
    if (status === 413) return res.status(413).json({ code: 'REQUEST_TOO_LARGE', message: req.path === '/api/worksheet/import/xlsx' ? '檔案超過 10 MB，請選擇較小的 XLSX 學習單。' : '資料超過 100 KB，請縮短內容後重試。' });
    if (status === 400) return res.status(400).json({ code: 'INVALID_JSON', message: '資料格式不正確，請檢查欄位後重試。' });
    res.status(status).json({ code: 'REQUEST_FAILED', message: status < 500 ? '請求內容不正確，請檢查後重試。' : '服務暫時無法完成操作，請稍後重試。' });
  });

  const frontend = join(process.cwd(), 'dist/frontend');
  app.use(express.static(frontend));
  app.get('*path', (_req, res) => res.sendFile(join(frontend, 'index.html')));
  return { app, classrooms };
}

async function poll<T extends { version: number }>(req: Request, res: Response, read: () => T) {
  const after = Number(req.query.after);
  let view = read();
  const deadline = Date.now() + 20_000;
  while (after === view.version && Date.now() < deadline && !res.destroyed) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (res.destroyed) return;
    view = read();
  }
  if (!res.destroyed) {
    if (view.version === after) res.status(204).end();
    else res.json(view);
  }
}

function domainError(res: Response, error: unknown) {
  if (error instanceof DomainError) return res.status(error.status).json({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
  return res.status(500).json({ code: 'INTERNAL_ERROR', message: '操作未完成，請重新整理後再試。' });
}
