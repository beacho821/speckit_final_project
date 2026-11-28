import { useEffect, useRef, useState } from 'react';
import type { SessionResponse, WorksheetSource } from '../../shared/api';
import { activityHeaders, readError } from './api';

type OnExpired = (reason: 'authorization' | 'activity') => void;
type Conflict = { questionId: string; currentValue: string; winningAnswer: string };

export function useTeacherWriteback(session: SessionResponse, credential: string, onExpired: OnExpired) {
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  useEffect(() => () => request.current?.abort(), []);

  async function run() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true); setMessage(''); setConflicts([]);
    try {
      const response = await fetch('/api/worksheet/writeback', {
        method: 'POST', headers: activityHeaders(session, credential), signal: controller.signal,
      });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 401 || body.code === 'FORBIDDEN') { onExpired('authorization'); return; }
      if (response.status === 409 && body.code === 'ACTIVITY_EXPIRED') { onExpired('activity'); return; }
      if (!response.ok) {
        setMessage(body.message ?? '回填未完成，請確認後重試。');
        if (Array.isArray(body.details)) setConflicts(body.details);
        return;
      }
      if (!body.written.length && !body.alreadyMatched.length) {
        setMessage('沒有可回填的答案。');
        return;
      }
      setMessage(`回填完成：寫入 ${body.written.length} 格、已相符 ${body.alreadyMatched.length} 格、無勝組 ${body.noWinner.length} 格。`);
    } catch {
      if (!controller.signal.aborted) setMessage('寫回結果待確認。請檢查原工作表後再操作。');
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return { pending, message, conflicts, run };
}

export default function TeacherResults({ session, credential, source, hasResults, disabled, writeback, onExpired }: {
  session: SessionResponse; credential: string; source?: WorksheetSource; hasResults: boolean;
  disabled: boolean; writeback: ReturnType<typeof useTeacherWriteback>; onExpired: OnExpired;
}) {
  const csvRequest = useRef<AbortController | null>(null);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [downloading, setDownloading] = useState(false);
  const busy = downloading || writeback.pending;
  useEffect(() => () => csvRequest.current?.abort(), []);
  async function download() {
    if (csvRequest.current || busy || disabled || !hasResults) return;
    const controller = new AbortController();
    csvRequest.current = controller;
    setDownloading(true); setDownloadMessage('');
    try {
      const response = await fetch('/api/results.csv', { headers: activityHeaders(session, credential), signal: controller.signal });
      if (!response.ok) {
        const error = await readError(response);
        if (controller.signal.aborted) return;
        if (response.status === 401 || error.code === 'FORBIDDEN') onExpired('authorization');
        else if (response.status === 409 && error.code === 'ACTIVITY_EXPIRED') onExpired('activity');
        else setDownloadMessage(error.message);
        return;
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'classroom-results.csv'; link.click(); URL.revokeObjectURL(url);
      setDownloadMessage('CSV 已下載。');
    } catch {
      if (!controller.signal.aborted) setDownloadMessage('下載失敗，請確認連線後重試。');
    } finally {
      if (csvRequest.current === controller) csvRequest.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  }
  return <section className="round-panel">
    <h2>回填與匯出</h2>
    {!hasResults && <p className="muted">目前沒有可回填的答案，也沒有已定案的結果可匯出。</p>}
    {hasResults && (source?.kind === 'google'
      ? <p className="muted">回填前會重新比對每個題號與原稿內容；衝突時整批不寫入。回填期間請暫停共同編輯。</p>
      : <p className="muted">{source?.kind === 'xlsx' ? '本機 XLSX 學習單不支援回填原檔，請下載活動 CSV。' : '目前沒有可回填的 Google 原稿，請下載活動 CSV。'}</p>)}
    <div className="actions-row">
      <button className="secondary-button" disabled={disabled || busy || !hasResults || source?.kind !== 'google'}
        onClick={() => { setDownloadMessage(''); void writeback.run(); }}>將勝組答案回填原稿</button>
      <button className="primary" disabled={disabled || busy || !hasResults} onClick={() => void download()}>下載活動 CSV</button>
    </div>
    {(downloadMessage || writeback.message) && <p className="muted" role="status">{downloadMessage || writeback.message}</p>}
    {writeback.conflicts.map(conflict => <article className="conflict-card" key={conflict.questionId}>
      <strong>{conflict.questionId}</strong><p>原稿目前內容：{conflict.currentValue}</p><p>勝組答案：{conflict.winningAnswer}</p>
    </article>)}
  </section>;
}
