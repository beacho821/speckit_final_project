import {useEffect,useRef,useState} from 'react';
import type {SessionResponse,WorksheetPreview} from '../../shared/api';
import {activityHeaders} from './api';
interface Candidate{sheetId:number;title:string}
interface Props{session:SessionResponse;credential:string;preview?:WorksheetPreview|null;locked?:boolean;unconfirmed?:boolean;onBusy?:(busy:boolean)=>void;onPublished?:()=>void;onUnconfirmed?:()=>void;onExpired?:()=>void}
export default function WorksheetImport({session,credential,preview=null,locked=false,unconfirmed=false,onBusy,onPublished,onUnconfirmed,onExpired}:Props){
  const [mode,setMode]=useState<'google'|'xlsx'>('google'),[url,setUrl]=useState(''),[file,setFile]=useState<File|null>(null),[candidates,setCandidates]=useState<Candidate[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const operation=useRef(0),running=useRef(false),controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{operation.current++;controller.current?.abort();},[]);
  useEffect(()=>{if(!unconfirmed){setUncertain(false);if(uncertain)setError('');}},[unconfirmed,preview?.source.importedAt]);
  const disabled=busy||unconfirmed||uncertain||locked;
  async function importSheet(sheetId?:number){
    if(running.current||disabled)return;
    if(mode==='xlsx'&&(!file||!file.name.toLowerCase().endsWith('.xlsx')||file.size>10485760)){setError('請選擇不超過 10 MB 的 .xlsx 學習單。');return;}
    const id=++operation.current;running.current=true;setBusy(true);onBusy?.(true);setError('');controller.current=new AbortController();
    try{const response=await fetch(mode==='xlsx'?`/api/worksheet/import/xlsx${sheetId===undefined?'':`?sheetId=${sheetId}`}`:'/api/worksheet/import',{method:'POST',headers:{...activityHeaders(session,credential),'Content-Type':mode==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/json',...(mode==='xlsx'?{'X-File-Name':encodeURIComponent(file!.name)}:{})},body:mode==='xlsx'?file:JSON.stringify({url,...(sheetId===undefined?{}:{sheetId})}),signal:controller.current.signal});
      const body=await response.json();if(id!==operation.current)return;
      if(!response.ok){if(response.status===401||body.code==='ACTIVITY_EXPIRED'){onExpired?.();return;}setError(body.message??'匯入未完成，請檢查學習單。');return;}
      if(Array.isArray(body.candidates)){setCandidates(body.candidates);return;}
      setCandidates([]);setFile(null);onPublished?.();
    }catch{if(id!==operation.current)return;setUncertain(true);setError('匯入結果待確認，正在取得最新課堂資料。請先等待確認，不要重送。');onUnconfirmed?.();}
    finally{if(id===operation.current){running.current=false;setBusy(false);onBusy?.(false);}}
  }
  function switchMode(next:'google'|'xlsx'){if(disabled)return;operation.current++;setMode(next);setCandidates([]);setError('');setFile(null);}
  return <section className="round-panel"><p className="eyebrow">備課</p><h2>匯入學習單</h2>
    {locked?<p className="muted">已有回合開始，學習單已鎖定。</p>:<><p className="muted">選擇本機 XLSX，或貼上 Google 試算表網址。先預覽題號，再選題開啟回合。</p><div className="role-switch" role="group" aria-label="學習單來源"><button aria-pressed={mode==='google'} disabled={disabled} className={mode==='google'?'active':''} onClick={()=>switchMode('google')}>Google 試算表</button><button aria-pressed={mode==='xlsx'} disabled={disabled} className={mode==='xlsx'?'active':''} onClick={()=>switchMode('xlsx')}>本機 XLSX</button></div>
    <form className="form-stack" onSubmit={e=>{e.preventDefault();void importSheet();}}>
      {mode==='google'&&<><label htmlFor="sheet-url">Google 試算表網址</label><input id="sheet-url" aria-label="Google 試算表網址" type="url" required disabled={disabled} value={url} onChange={e=>{setUrl(e.target.value);setCandidates([]);}}/></>}
      <label htmlFor="xlsx-file">XLSX 學習單（上限 10 MB）</label><input id="xlsx-file" type="file" accept=".xlsx" disabled={disabled} onChange={e=>{const selected=e.target.files?.[0];if(selected){setFile(selected);setMode('xlsx');setCandidates([]);setError('');}e.target.value='';}}/>
      {mode==='xlsx'&&file&&<p className="muted">已選擇：{file.name}</p>}<button className="primary" disabled={disabled||(mode==='xlsx'&&!file)}>{busy?'正在匯入…':'匯入並預覽'}</button></form>
      {candidates.length>0&&<div className="form-stack"><label htmlFor="sheet-choice">選擇工作表（尚未發布）</label><select id="sheet-choice" disabled={disabled} value="" onChange={e=>{if(e.target.value)void importSheet(Number(e.target.value));}}><option value="">請選擇分頁</option>{candidates.map(c=><option key={c.sheetId} value={c.sheetId}>{c.title}</option>)}</select><button className="quiet" disabled={disabled} onClick={()=>{setCandidates([]);setFile(null);}}>取消選擇</button></div>}</>}
    {(error||unconfirmed||uncertain)&&<p className="error" role="status">{unconfirmed||uncertain?'匯入結果待確認，正在同步最新課堂資料；確認前暫停匯入與開題。':error}</p>}
    {preview&&<div className="preview-summary"><strong>已發布學習單</strong><span>{preview.source.kind==='xlsx'?preview.source.fileName:preview.source.sheetTitle} · {preview.mainQuestionCount} 個主題 · {preview.unitCount} 個搶答單位 · {preview.fillCount} 個填空</span><div>{preview.units.map(u=><span className="preview-chip" key={u.id}>{u.name}：{u.questionIds.join('、')}</span>)}</div></div>}
  </section>;
}
