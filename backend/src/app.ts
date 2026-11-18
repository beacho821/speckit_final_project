import express from 'express';
import { join } from 'node:path';
import type { AppConfig } from './config.js';
import { createActivity } from './activity.js';
import { authenticate, requireTeacher } from './access.js';
import { DomainError, endRound, prepareRound, publishRound, startRound, submitAnswers, updateReview } from './rounds.js';
import { makeView, previewFor, resultsFor } from './views.js';
import { importGoogleWorksheet, type ImportResult } from './worksheet/google-source.js';
import { buildResultsCsv } from './results-csv.js';
import { writebackToGoogle } from './worksheet/writeback.js';
import { addManualQuestion, updateQuestion } from './questions.js';
import { beginImport, publishImportedWorksheet } from './worksheet/import.js';
import {importXlsxWorksheet, XLSX_LIMIT} from './worksheet/xlsx-source.js';
import { addGroup, renameGroup, deleteGroup, joinMember, rosterFor } from './roster.js';

export interface AppServices {
  importWorksheet?: (url: unknown, sheetId?: number) => Promise<ImportResult>;
  writeback?: (rounds: import('../../shared/api.js').Round[]) => Promise<{ written: string[]; alreadyMatched: string[]; noWinner: string[] }>;
  now?: () => number;
}

export function createApp(config: AppConfig, services: AppServices = {}) {
  const activity = createActivity();
  const app = express();
  app.disable('x-powered-by');
  app.post('/api/worksheet/import/xlsx', authenticate(config,activity), requireTeacher, (req,res,next)=>{
    try {
      if(activity.rosterLocked)throw new DomainError(409,'WORKSHEET_LOCKED','已有回合開始，不能更換來源學習單。');
      const type=req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase();
      if(!['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'].includes(type??'') || (req.header('Content-Encoding')&&req.header('Content-Encoding')!=='identity'))throw new DomainError(415,'UNSUPPORTED_MEDIA_TYPE','請直接上傳未壓縮的 XLSX 檔案。');
      req.importGeneration=beginImport(activity).generation;next();
    }catch(error){domainError(res,error);}
  }, express.raw({type:()=>true,limit:XLSX_LIMIT,inflate:false}), async(req,res)=>{
    const id=activity.id;let alive=true;res.once('close',()=>{alive=false;});
    try{
      const raw=req.query.sheetId;let sheetId:number|undefined;
      if(raw!==undefined){if(typeof raw!=='string'||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1)throw new DomainError(422,'INVALID_SHEET_ID','請選擇有效的工作表。');sheetId=Number(raw);}
      let name:string;try{name=decodeURIComponent(req.header('X-File-Name')??'');}catch{throw new DomainError(422,'INVALID_FILE_NAME','檔名格式不正確，請重新選擇 XLSX。');}
      const result=await importXlsxWorksheet(req.body??Buffer.alloc(0),name,sheetId);
      if('candidates' in result)return res.json({candidates:result.candidates});
      publishImportedWorksheet(activity,result,req.importGeneration!,id,()=>alive&&!req.aborted&&!res.destroyed);
      res.json(previewFor(activity));
    }catch(error){domainError(res,error);}
  });
  app.use(express.json({ limit: '100kb' }));

  app.post('/api/sessions', authenticate(config, activity, false), (req, res) => {
    try {
      if (req.identity!.role === 'teacher') return res.json({ activityId: activity.id, role: 'teacher' });
      const groupId = req.identity!.groupId!;
      const member = joinMember(activity, groupId, req.body?.name);
      res.json({ activityId: activity.id, role: 'student', groupId, groupName: activity.groups.find(g => g.id === groupId)!.name, memberId: member.id, studentName: member.name });
    } catch (error) { domainError(res, error); }
  });
  const rosterAuth = [authenticate(config, activity), requireTeacher];
  app.get('/api/roster', ...rosterAuth, (_req, res) => res.json(rosterFor(activity)));
  app.post('/api/groups', ...rosterAuth, (req, res) => {
    try { addGroup(activity, req.body?.name, config.teacherPassword); res.status(201).json(rosterFor(activity)); } catch (error) { domainError(res, error); }
  });
  app.patch('/api/groups/:id', ...rosterAuth, (req, res) => {
    try { renameGroup(activity, String(req.params.id), req.body?.name); res.json(rosterFor(activity)); } catch (error) { domainError(res, error); }
  });
  app.delete('/api/groups/:id', ...rosterAuth, (req, res) => {
    try { deleteGroup(activity, String(req.params.id)); res.json(rosterFor(activity)); } catch (error) { domainError(res, error); }
  });
  app.put('/api/roster', ...rosterAuth, (_req, res) => res.status(405).json({ code: 'ROSTER_UPDATE_REPLACED', message: '請使用新增、更名或刪除組別操作。' }));

  app.post('/api/worksheet/import', authenticate(config, activity), requireTeacher, async (req, res) => {
    if (activity.rosterLocked) return res.status(409).json({ code: 'WORKSHEET_LOCKED', message: '已有回合開始，不能更換來源學習單。' });
    const {generation,activityId}=beginImport(activity);
    const rawSheetId = req.body?.sheetId;
    if (rawSheetId !== undefined && (!Number.isSafeInteger(rawSheetId) || rawSheetId < 0)) return res.status(422).json({ code: 'INVALID_GID', message: '請選擇有效的工作表。' });
    try {
      const imported = services.importWorksheet
        ? await services.importWorksheet(req.body?.url, rawSheetId)
        : await importGoogleWorksheet(config, req.body?.url, rawSheetId);
      if ('candidates' in imported) return res.json({ candidates: imported.candidates });
      publishImportedWorksheet(activity, imported, generation, activityId, () => !req.aborted && !res.destroyed);
      res.json(previewFor(activity));
    } catch (error) {
      if (error instanceof DomainError) return res.status(error.status).json({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
      res.status(500).json({ code: 'IMPORT_FAILED', message: '匯入失敗，原有預覽仍保留。請重新檢查網址後再試。' });
    }
  });

  const teacherAuth = [authenticate(config, activity), requireTeacher];
  app.post('/api/questions', ...teacherAuth, (req, res) => {
    try { res.status(201).json(addManualQuestion(activity, req.body)); }
    catch (error) { domainError(res, error); }
  });
  app.patch('/api/questions/:questionKey', ...teacherAuth, (req, res) => {
    try { res.json(updateQuestion(activity, String(req.params.questionKey), req.body)); }
    catch (error) { domainError(res, error); }
  });
  app.post('/api/rounds', ...teacherAuth, (req, res) => {
    try { res.status(201).json(prepareRound(activity, req.body?.unitId)); }
    catch (error) { domainError(res, error); }
  });
  app.post('/api/rounds/:id/start', ...teacherAuth, (req, res) => {
    try { res.json(startRound(activity, String(req.params.id), services.now?.())); }
    catch (error) { domainError(res, error); }
  });
  app.post('/api/rounds/:id/end', ...teacherAuth, (req, res) => {
    try { res.json(endRound(activity, String(req.params.id))); }
    catch (error) { domainError(res, error); }
  });
  app.patch('/api/rounds/:id/review', ...teacherAuth, (req, res) => {
    try { res.json(updateReview(activity, String(req.params.id), req.body)); }
    catch (error) { domainError(res, error); }
  });
  app.post('/api/rounds/:id/publish', ...teacherAuth, (req, res) => {
    try { res.json(publishRound(activity, String(req.params.id), req.body?.reviewRevision)); }
    catch (error) { domainError(res, error); }
  });
  app.post('/api/rounds/:id/submissions', authenticate(config, activity), (req, res) => {
    if (req.identity?.role !== 'student') return res.status(403).json({ code: 'FORBIDDEN', message: '此操作僅限學生組別使用。' });
    try { submitAnswers(activity, String(req.params.id), req.identity.groupId!, req.body?.answers, services.now?.()); res.status(201).json({ roundId: req.params.id, received: true }); }
    catch (error) { domainError(res, error); }
  });
  app.get('/api/rounds/:id/results', authenticate(config, activity), (req, res) => {
    const round = activity.rounds.find(item => item.id === req.params.id);
    if (!round) return res.status(404).json({ code: 'ROUND_NOT_FOUND', message: '找不到指定回合。' });
    if (round.phase !== 'ended') return res.status(403).json({ code: 'RESULTS_HIDDEN', message: '老師公布後才能查看全班結果。' });
    res.json(resultsFor(round));
  });
  app.get('/api/view', authenticate(config, activity), async (req, res) => {
    const identity = req.identity!;
    let view = makeView(activity, identity, services.now?.());
    const after = Number(req.query.after);
    if (Number.isFinite(after) && after === view.version) {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline && !req.aborted) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (identity.role === 'student' && !activity.groups.some(group => group.id === identity.groupId)) return res.status(401).json({ code: 'ACCESS_REVOKED', message: '組別授權已移除，請重新向老師確認名單。' });
        view = makeView(activity, identity, services.now?.());
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
      if (error instanceof Error && error.message === 'NO_ENDED_ROUNDS') return res.status(409).json({ code: 'NO_ENDED_ROUNDS', message: '尚無已公布回合，請先公布結果再匯出。' });
      domainError(res, error);
    }
  });
  app.post('/api/worksheet/writeback', ...teacherAuth, async (_req, res) => {
    if (!activity.worksheet) return res.status(409).json({ code: 'WRITEBACK_NOT_SUPPORTED', message: '目前沒有可回填的 Google 原稿，請下載活動 CSV。' });
    if(activity.worksheet?.source.kind==='xlsx')return res.status(409).json({code:'WRITEBACK_NOT_SUPPORTED',message:'本機 XLSX 學習單不支援回填原檔，請下載活動 CSV。'});
    if (activity.writebackInProgress) return res.status(409).json({ code: 'WRITEBACK_BUSY', message: '回填作業正在執行，請稍候再查看結果。' });
    const endedRounds = structuredClone(activity.rounds.filter(round => round.phase === 'ended'));
    if (!endedRounds.length) return res.status(409).json({ code: 'NO_ENDED_ROUNDS', message: '尚無已公布回合，請先公布結果再回填。' });
    activity.writebackInProgress = true;
    try {
      const sourceUnits = new Set(activity.worksheet.units.map(unit => unit.id));
      const sourceRounds = endedRounds.filter(round => sourceUnits.has(round.unitId));
      if (!sourceRounds.length) return res.json({ written: [], alreadyMatched: [], noWinner: [] });
      const result = services.writeback ? await services.writeback(sourceRounds) : await writebackToGoogle(activity, config, sourceRounds);
      res.json(result);
    } catch (error) {
      if (error instanceof DomainError) return res.status(error.status).json({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
      res.status(500).json({ code: 'WRITEBACK_UNCONFIRMED', message: '寫回結果待確認，請先檢查來源工作表後再試。' });
    } finally { activity.writebackInProgress = false; }
  });

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
  return { app, activity };
}

function domainError(res: import('express').Response, error: unknown) {
  if (error instanceof DomainError) return res.status(error.status).json({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
  return res.status(500).json({ code: 'INTERNAL_ERROR', message: '操作未完成，請重新整理後再試。' });
}
