import express from 'express';
import { join } from 'node:path';
import type { AppConfig } from './config.js';
import { changed, createActivity } from './activity.js';
import { authenticate, requireTeacher } from './access.js';
import { DomainError, endRound, prepareRound, startRound, submitAnswers } from './rounds.js';
import { makeView, resultsFor } from './views.js';
import { importGoogleWorksheet, type ImportResult } from './worksheet/google-source.js';
import { DomainError as ImportError } from './rounds.js';
import { buildResultsCsv } from './results-csv.js';
import { writebackToGoogle } from './worksheet/writeback.js';
import { publishImportedWorksheet } from './worksheet/import.js';

export interface AppServices {
  importWorksheet?: (url: unknown, sheetId?: number) => Promise<ImportResult>;
  writeback?: (rounds: import('../../shared/api.js').Round[]) => Promise<{ written: string[]; alreadyMatched: string[]; noWinner: string[] }>;
}

export function createApp(config: AppConfig, services: AppServices = {}) {
  const activity = createActivity();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.post('/api/sessions', authenticate(config, activity, false), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ activityId: activity.id, ...req.identity });
  });

  app.get('/api/roster', authenticate(config, activity), requireTeacher, (_req, res) => {
    res.json({ groups: activity.groups, availableGroups: [...config.groupCodes.keys()].map(id => ({ id })), locked: activity.rosterLocked });
  });

  app.put('/api/roster', authenticate(config, activity), requireTeacher, (req, res) => {
    if (activity.rosterLocked) return res.status(409).json({ code: 'ROSTER_LOCKED', message: '首回合已開始，組別名單已鎖定。' });
    const groups = req.body?.groups;
    if (!Array.isArray(groups)) return res.status(400).json({ code: 'INVALID_ROSTER', message: '名單格式不正確，請重新編輯組別。' });
    const cleaned = groups.map((group: { id?: unknown; name?: unknown }) => ({ id: typeof group.id === 'string' ? group.id : '', name: typeof group.name === 'string' ? group.name.trim() : '' }));
    if (cleaned.some(group => !config.groupCodes.has(group.id) || !group.name) || new Set(cleaned.map(group => group.id)).size !== cleaned.length || new Set(cleaned.map(group => group.name)).size !== cleaned.length) return res.status(422).json({ code: 'INVALID_ROSTER', message: '組名不可空白或重複，且每組須選擇唯一的可用組別代碼。' });
    activity.groups = cleaned;
    changed(activity, ['teacher', ...[...config.groupCodes.keys()].map(id => `student:${id}`)]);
    res.json({ groups: activity.groups, availableGroups: [...config.groupCodes.keys()].map(id => ({ id })), locked: activity.rosterLocked });
  });

  app.post('/api/worksheet/import', authenticate(config, activity), requireTeacher, async (req, res) => {
    const generation = ++activity.importGeneration;
    const activityId = activity.id;
    if (activity.rounds.some(round => round.phase !== 'preparing')) return res.status(409).json({ code: 'WORKSHEET_LOCKED', message: '已有回合開始，不能更換來源學習單。' });
    const rawSheetId = req.body?.sheetId;
    if (rawSheetId !== undefined && (!Number.isSafeInteger(rawSheetId) || rawSheetId < 0)) return res.status(422).json({ code: 'INVALID_GID', message: '請選擇有效的工作表。' });
    try {
      const imported = services.importWorksheet
        ? await services.importWorksheet(req.body?.url, rawSheetId)
        : await importGoogleWorksheet(config, req.body?.url, rawSheetId);
      if ('candidates' in imported) return res.json({ candidates: imported.candidates });
      const worksheet = publishImportedWorksheet(activity, imported, generation, activityId);
      res.json({ source: worksheet.source, unitCount: worksheet.units.length, fillCount: worksheet.fills.length, units: worksheet.units.map(unit => ({ id: unit.id, name: unit.name, questionIds: unit.questionIds })) });
    } catch (error) {
      if (error instanceof ImportError) return res.status(error.status).json({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
      if (error instanceof DomainError) return res.status(error.status).json({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
      res.status(500).json({ code: 'IMPORT_FAILED', message: '匯入失敗，原有預覽仍保留。請重新檢查網址後再試。' });
    }
  });

  const teacherAuth = [authenticate(config, activity), requireTeacher];
  app.post('/api/rounds', ...teacherAuth, (req, res) => {
    try { res.status(201).json(prepareRound(activity, req.body?.unitId)); }
    catch (error) { domainError(res, error); }
  });
  app.post('/api/rounds/:id/start', ...teacherAuth, (req, res) => {
    try { res.json(startRound(activity, String(req.params.id))); }
    catch (error) { domainError(res, error); }
  });
  app.post('/api/rounds/:id/end', ...teacherAuth, (req, res) => {
    try { res.json(endRound(activity, String(req.params.id))); }
    catch (error) { domainError(res, error); }
  });
  app.post('/api/rounds/:id/submissions', authenticate(config, activity), (req, res) => {
    if (req.identity?.role !== 'student') return res.status(403).json({ code: 'FORBIDDEN', message: '此操作僅限學生組別使用。' });
    try { submitAnswers(activity, String(req.params.id), req.identity.groupId!, req.body?.answers); res.status(201).json({ roundId: req.params.id, received: true }); }
    catch (error) { domainError(res, error); }
  });
  app.get('/api/rounds/:id/results', authenticate(config, activity), (req, res) => {
    const round = activity.rounds.find(item => item.id === req.params.id);
    if (!round) return res.status(404).json({ code: 'ROUND_NOT_FOUND', message: '找不到指定回合。' });
    if (round.phase !== 'ended') return res.status(403).json({ code: 'RESULTS_HIDDEN', message: '回合結束後才會公布全班結果。' });
    res.json(resultsFor(round, activity));
  });
  app.get('/api/view', authenticate(config, activity), async (req, res) => {
    const identity = req.identity!;
    let view = makeView(activity, identity);
    const after = Number(req.query.after);
    if (Number.isFinite(after) && after === view.version) {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline && !req.aborted) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (identity.role === 'student' && !activity.groups.some(group => group.id === identity.groupId)) return res.status(401).json({ code: 'ACCESS_REVOKED', message: '組別授權已移除，請重新向老師確認名單。' });
        view = makeView(activity, identity);
        if (view.version !== after) break;
      }
      if (req.aborted) return;
      if (view.version === after) return res.status(204).end();
    }
    res.json(view);
  });
  app.get('/api/results.csv', ...teacherAuth, (_req, res) => {
    try {
      const csv = buildResultsCsv(activity);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="classroom-results.csv"');
      res.send(csv);
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_ENDED_ROUNDS') return res.status(409).json({ code: 'NO_ENDED_ROUNDS', message: '尚無已結束回合，請先完成一題後再匯出。' });
      res.status(409).json({ code: 'WORKSHEET_REQUIRED', message: '尚未匯入學習單，無法整理結果。' });
    }
  });
  app.post('/api/worksheet/writeback', ...teacherAuth, async (_req, res) => {
    if (activity.writebackInProgress) return res.status(409).json({ code: 'WRITEBACK_BUSY', message: '回填作業正在執行，請稍候再查看結果。' });
    const endedRounds = structuredClone(activity.rounds.filter(round => round.phase === 'ended'));
    if (!endedRounds.length) return res.status(409).json({ code: 'NO_ENDED_ROUNDS', message: '尚無已結束回合，請先結束一題後再回填。' });
    activity.writebackInProgress = true;
    try {
      const result = services.writeback ? await services.writeback(endedRounds) : await writebackToGoogle(activity, config, endedRounds);
      res.json(result);
    } catch (error) {
      if (error instanceof DomainError) return res.status(error.status).json({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
      res.status(500).json({ code: 'WRITEBACK_UNCONFIRMED', message: '寫回結果待確認，請先檢查來源工作表後再試。' });
    } finally { activity.writebackInProgress = false; }
  });

  app.use('/api', (_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: '找不到這項操作，請重新整理頁面。' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 500;
    if (status === 400) return res.status(400).json({ code: 'INVALID_JSON', message: '資料格式不正確，請檢查欄位後重試。' });
    res.status(status).json({ code: 'REQUEST_FAILED', message: status < 500 ? '請求內容不正確，請檢查後重試。' : '服務暫時無法完成操作，請稍後重試。' });
  });

  const frontend = join(process.cwd(), 'dist/frontend');
  app.use(express.static(frontend));
  app.get('*path', (_req, res) => res.sendFile(join(frontend, 'index.html')));
  return { app, activity };
}

function domainError(res: import('express').Response, error: unknown) {
  if (error instanceof DomainError) return res.status(error.status).json({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
  return res.status(500).json({ code: 'INTERNAL_ERROR', message: '操作未完成，請重新整理後再試。' });
}
