import { useEffect, useRef, useState } from 'react';
import type { SessionResponse, WorksheetPreview } from '../../shared/api';
import { activityHeaders } from './api';

interface Candidate { sheetId: number; title: string }
interface Props {
  session: SessionResponse;
  credential: string;
  catalogRevision?: number;
  preview?: WorksheetPreview | null;
  locked?: boolean;
  unconfirmed?: boolean;
  completedRefresh?: number;
  onBusy?: (busy: boolean) => void;
  onPublished?: () => void;
  onUnconfirmed?: () => void;
  onExpired?: () => void;
}

const maxFileBytes = 10 * 1024 * 1024;
const pendingMessage = '匯入結果待確認，正在同步最新課堂資料；確認前暫停匯入與開題。';

export default function WorksheetImport({
  session, credential, catalogRevision, preview = null, locked = false, unconfirmed = false, completedRefresh,
  onBusy, onPublished, onUnconfirmed, onExpired,
}: Props) {
  const [mode, setMode] = useState<'google' | 'xlsx'>('google');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const confirmation = useRef<HTMLDialogElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const confirmedSource = useRef<{ revision: number | undefined } | null>(null);
  const pendingReplacement = useRef<{ revision: number | undefined; sheetId?: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  const disabled = busy || unconfirmed || uncertain || locked;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!unconfirmed) {
      setUncertain(false);
      if (uncertain) setError('');
    }
  }, [unconfirmed, completedRefresh]);

  useEffect(() => {
    const pending = pendingReplacement.current;
    if (!confirmation.current?.open || !pending || pending.revision === catalogRevision) return;
    pendingReplacement.current = null;
    confirmation.current.close();
    setError('題目清單已更新，請核對最新內容後再重新匯入。');
  }, [catalogRevision]);

  function resetSelection() {
    confirmedSource.current = null;
    setCandidates([]);
    setError('');
  }

  async function importSheet(sheetId?: number) {
    if (request.current || disabled) return;
    if (mode === 'xlsx' && (!file || !file.name.toLowerCase().endsWith('.xlsx') || file.size > maxFileBytes)) {
      setError('請選擇不超過 10 MB 的 .xlsx 學習單。');
      return;
    }
    if (preview && (!confirmedSource.current || confirmedSource.current.revision !== catalogRevision)) {
      pendingReplacement.current = { revision: catalogRevision, sheetId };
      confirmation.current?.showModal();
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setBusy(true); onBusy?.(true); setError('');
    try {
      const upload = mode === 'xlsx';
      const path = upload ? '/api/worksheet/import/xlsx' + (sheetId === undefined ? '' : '?sheetId=' + sheetId)
        : '/api/worksheet/import';
      const response = await fetch(path, {
        method: 'POST',
        headers: {
          ...activityHeaders(session, credential),
          ...(catalogRevision === undefined ? {} : { 'X-Catalog-Revision': String(catalogRevision) }),
          ...(preview ? { 'X-Confirm-Worksheet-Replacement': 'true' } : {}),
          'Content-Type': upload ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json',
          ...(upload ? { 'X-File-Name': encodeURIComponent(file!.name) } : {}),
        },
        body: upload ? file : JSON.stringify({ url, ...(sheetId === undefined ? {} : { sheetId }) }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        confirmedSource.current = null;
        if (response.status === 401 || body.code === 'ACTIVITY_EXPIRED') onExpired?.();
        else setError(body.message ?? '匯入未完成，請檢查學習單。');
        return;
      }
      if (Array.isArray(body.candidates)) {
        setCandidates(body.candidates);
        return;
      }
      resetSelection();
      setFile(null);
      onPublished?.();
    } catch {
      if (controller.signal.aborted) return;
      confirmedSource.current = null;
      setUncertain(true);
      onUnconfirmed?.();
    } finally {
      request.current = null;
      if (!controller.signal.aborted) { setBusy(false); onBusy?.(false); }
    }
  }

  function switchMode(next: 'google' | 'xlsx') {
    setMode(next);
    setFile(null);
    resetSelection();
  }

  return <section className="round-panel">
    <h2>匯入學習單</h2>
    {locked ? <p className="muted">已有回合開始，學習單已鎖定。</p> : <>
      <p className="muted">選擇本機 XLSX，或貼上 Google 試算表網址。匯入後可將所需題目加入出題清單。</p>
      <div className="role-switch" role="group" aria-label="學習單來源">
        <button aria-pressed={mode === 'google'} disabled={disabled} className={mode === 'google' ? 'active' : ''} onClick={() => switchMode('google')}>Google 試算表</button>
        <button aria-pressed={mode === 'xlsx'} disabled={disabled} className={mode === 'xlsx' ? 'active' : ''} onClick={() => switchMode('xlsx')}>本機 XLSX</button>
      </div>
      <form className="form-stack" onSubmit={event => { event.preventDefault(); void importSheet(); }}>
        {mode === 'google' && <>
          <label htmlFor="sheet-url">Google 試算表網址</label>
          <input id="sheet-url" aria-label="Google 試算表網址" type="url" required disabled={disabled} value={url}
            onChange={event => { setUrl(event.target.value); resetSelection(); }} />
        </>}
        <label htmlFor="xlsx-file">XLSX 學習單（上限 10 MB）</label>
        <input id="xlsx-file" type="file" accept=".xlsx" disabled={disabled} onChange={event => {
          const selected = event.target.files?.[0];
          if (selected) { setFile(selected); setMode('xlsx'); resetSelection(); }
          event.target.value = '';
        }} />
        {mode === 'xlsx' && file && <p className="muted">已選擇：{file.name}</p>}
        <button ref={importButton} className="primary" disabled={disabled || (mode === 'xlsx' && !file)}>{busy ? '正在匯入…' : '匯入並預覽'}</button>
      </form>
      {candidates.length > 0 && <div className="form-stack">
        <label htmlFor="sheet-choice">選擇工作表（尚未發布）</label>
        <select id="sheet-choice" disabled={disabled} value="" onChange={event => {
          if (event.target.value) void importSheet(Number(event.target.value));
        }}>
          <option value="">請選擇分頁</option>
          {candidates.map(candidate => <option key={candidate.sheetId} value={candidate.sheetId}>{candidate.title}</option>)}
        </select>
        <button className="quiet" disabled={disabled} onClick={() => { setFile(null); resetSelection(); }}>取消選擇</button>
      </div>}
    </>}
    {(error || unconfirmed || uncertain) && <p className="error" role="status">{unconfirmed || uncertain ? pendingMessage : error}</p>}
    {preview && <p className="muted">目前來源：{preview.source.kind === 'xlsx' ? preview.source.fileName : preview.source.sheetTitle} · {preview.unitCount} 張題目卡</p>}
    <dialog ref={confirmation} className="work-dialog" aria-labelledby="replacement-title" onClose={() => importButton.current?.focus()}>
      <h2 id="replacement-title">重新匯入學習單</h2>
      <p>匯入成功後，會清除目前全部題目卡及出題清單，包含手動新增的題目。</p>
      <div className="row-actions">
        <button className="secondary-button" autoFocus onClick={() => confirmation.current?.close()}>取消</button>
        <button className="primary" onClick={() => {
          const pending = pendingReplacement.current;
          if (!confirmation.current?.open || !pending || pending.revision !== catalogRevision) return;
          confirmedSource.current = { revision: pending.revision };
          pendingReplacement.current = null;
          confirmation.current.close();
          void importSheet(pending.sheetId);
        }}>確認重新匯入</button>
      </div>
    </dialog>
  </section>;
}
