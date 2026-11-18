import { useState } from 'react';
import type { SessionResponse, WorksheetSource } from '../../shared/api';
import { activityHeaders, readError } from './api';

export default function TeacherResults({ session, credential, source }: { session: SessionResponse; credential: string; source?: WorksheetSource }) {
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<Array<{ questionId: string; currentValue: string; winningAnswer: string }>>([]);
  async function writeback() {
    setBusy(true); setMessage(''); setConflicts([]);
    try {
      const response = await fetch('/api/worksheet/writeback', { method: 'POST', headers: activityHeaders(session, credential) });
      const body = await response.json();
      if (!response.ok) { setMessage(body.message ?? '回填未完成，請確認後重試。'); if (Array.isArray(body.details)) setConflicts(body.details); return; }
      if (!body.written.length && !body.alreadyMatched.length) {
        setMessage('沒有可回填的答案。');
        return;
      }
      setMessage(`回填完成：寫入 ${body.written.length} 格、已相符 ${body.alreadyMatched.length} 格、無勝組 ${body.noWinner.length} 格。`);
    } catch { setMessage('寫回結果待確認。請檢查原工作表後再操作。'); }
    finally { setBusy(false); }
  }
  async function download() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/results.csv', { headers: activityHeaders(session, credential) });
      if (!response.ok) { setMessage((await readError(response)).message); return; }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = 'classroom-results.csv'; link.click(); URL.revokeObjectURL(url); setMessage('CSV 已下載。');
    } catch { setMessage('下載失敗，請確認連線後重試。'); }
    finally { setBusy(false); }
  }
  return <section className="round-panel"><p className="eyebrow">課後整理</p><h2>回填與匯出</h2><p className="muted">回填前會重新比對每個題號與原稿內容；衝突時整批不寫入。回填期間請暫停共同編輯。</p>{source?.kind !== 'google' && <p className="muted">{source?.kind === 'xlsx' ? '本機 XLSX 學習單不支援回填原檔，請下載活動 CSV。' : '目前沒有可回填的 Google 原稿，請下載活動 CSV。'}</p>}<div className="actions-row"><button className="secondary-button" disabled={busy || source?.kind !== 'google'} onClick={() => void writeback()}>將勝組答案回填原稿</button><button className="primary" disabled={busy} onClick={() => void download()}>下載活動 CSV</button></div>{message && <p className="muted" role="status">{message}</p>}{conflicts.map(conflict => <article className="conflict-card" key={conflict.questionId}><strong>{conflict.questionId}</strong><p>原稿目前內容：{conflict.currentValue}</p><p>勝組答案：{conflict.winningAnswer}</p></article>)}</section>;
}
