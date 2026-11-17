import { useState } from 'react';
import type { SessionResponse } from '../../shared/api';
import { activityHeaders, readError } from './api';

interface Candidate { sheetId: number; title: string }
interface Preview { unitCount: number; fillCount: number; units: Array<{ id: string; name: string; questionIds: string[] }> }

export default function WorksheetImport({ session, credential }: { session: SessionResponse; credential: string }) {
  const [url, setUrl] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function importSheet(sheetId?: number) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/worksheet/import', { method: 'POST', headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/json' }, body: JSON.stringify({ url, ...(sheetId === undefined ? {} : { sheetId }) }) });
      const body = await response.json();
      if (!response.ok) { const issue = await readError(new Response(JSON.stringify(body))); setError(issue.message); return; }
      if (Array.isArray(body.candidates)) { setCandidates(body.candidates); return; }
      setCandidates([]); setPreview(body as Preview);
    } catch { setError('連線中斷，原有預覽保留。請確認本機服務後重試。'); }
    finally { setBusy(false); }
  }
  return <section className="round-panel">
    <p className="eyebrow">備課</p><h2>匯入學習單</h2><p className="muted">輸入 Google 試算表網址，系統會辨識題號與填空，不需查找儲存格位置。</p>
    <form className="form-stack" onSubmit={event => { event.preventDefault(); void importSheet(); }}><label htmlFor="sheet-url">Google 試算表網址</label><input id="sheet-url" type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" /><button className="primary" disabled={busy}>{busy ? '正在匯入…' : '匯入並預覽'}</button></form>
    {candidates.length > 0 && <div className="form-stack"><label htmlFor="sheet-choice">選擇工作表</label><select id="sheet-choice" defaultValue="" onChange={event => { if (event.target.value) void importSheet(Number(event.target.value)); }}><option value="">請選擇分頁</option>{candidates.map(candidate => <option key={candidate.sheetId} value={candidate.sheetId}>{candidate.title}</option>)}</select></div>}
    {error && <p className="error" role="alert">{error}</p>}
    {preview && <div className="preview-summary"><strong>目前預覽</strong><span>{preview.unitCount} 個搶答單位 · {preview.fillCount} 個填空</span><div>{preview.units.map(unit => <span className="preview-chip" key={unit.id}>{unit.name}：{unit.questionIds.join('、')}</span>)}</div></div>}
  </section>;
}
