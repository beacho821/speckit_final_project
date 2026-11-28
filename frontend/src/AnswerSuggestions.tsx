import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SessionResponse } from '../../shared/api';
import { activityHeaders, readError, ApiRequestError, requestMessage } from './api';

type Target = { id: string; label: string; prompt: string; text: string; part?: string };
type Suggestion = { prompt: string; answers: string[]; message?: string };
type Suggestions = Map<string, Suggestion>;
type Props = {
  targets: Target[]; session: SessionResponse; credential: string; disabled?: boolean;
  onAccept: (suggestions: Suggestions) => void;
};

export function fillBlankAnswer(suggestions: Suggestions, id: string, prompt: string, text: string) {
  const result = suggestions.get(id);
  return !text.trim() && result?.prompt === prompt && result.answers.length ? result.answers.join('\n') : text;
}

export default function AnswerSuggestions({ targets, disabled, ...props }: Props) {
  const [open, setOpen] = useState(false);
  const eligible = targets.filter(q => q.prompt.trim() && !q.text.trim());
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <>
    <button type="button" className="secondary-button" aria-haspopup="dialog" disabled={disabled || !eligible.length}
      onClick={() => setOpen(true)}>AI 產生建議答案</button>
    {open && !disabled && <SuggestionDialog key={props.session.activityId} {...props} targets={eligible} close={() => setOpen(false)} />}
  </>;
}

function SuggestionDialog({ targets, session, credential, onAccept, close }: Props & { close: () => void }) {
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const latest = useRef(targets);
  useLayoutEffect(() => { latest.current = targets; }, [targets]);
  const [selected, setSelected] = useState(() => new Set(targets.map(q => q.id)));
  const [results, setResults] = useState<Suggestions>(() => new Map());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => request.current?.abort();
  }, []);
  const chosen = targets.filter(q => selected.has(q.id));
  const accepted: Suggestions = new Map();
  for (const q of chosen) {
    const result = results.get(q.id);
    if (result?.prompt === q.prompt && result.answers.length) accepted.set(q.id, result);
  }
  const pending = chosen.filter(q => !accepted.has(q.id));

  async function generate() {
    if (request.current || !pending.length) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      for (const q of pending) {
        if (controller.signal.aborted) break;
        if (!latest.current.some(current => current.id === q.id && current.prompt === q.prompt)) continue;
        let result: Suggestion;
        let stopBatch = false;
        try {
          const response = await fetch('/api/questions/suggest-answers', {
            method: 'POST', signal: controller.signal,
            headers: { ...activityHeaders(session, credential), 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: q.prompt, ...(q.part ? { part: q.part } : {}) }),
          });
          if (!response.ok) {
            const issue = await readError(response);
            stopBatch = issue.details?.stopBatch === true;
            throw new ApiRequestError(issue.message);
          }
          const { answers } = await response.json();
          if (!Array.isArray(answers) || !answers.every(value => typeof value === 'string' && value.trim())) throw new Error();
          result = { prompt: q.prompt, answers, message: answers.length ? undefined : '這一題沒有可採用的建議。' };
        } catch (error) {
          result = { prompt: q.prompt, answers: [], message: requestMessage(error, '無法取得建議，可重試或手動填寫。') };
        }
        if (!controller.signal.aborted) setResults(current => new Map(current).set(q.id, result));
        if (stopBatch) break;
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      request.current = null;
    }
  }

  return <dialog ref={dialog} className="work-dialog ai-answer-dialog" aria-labelledby={title}
    onCancel={event => event.stopPropagation()} onClose={event => { event.stopPropagation(); close(); }}>
    <h2 id={title}>AI 建議答案</h2>
    <p>勾選要補答案的題目，確認建議後再填入。</p>
    <ul className="ai-answer-list">{targets.map(q => {
      const result = results.get(q.id);
      return <li key={q.id}>
        <label><input type="checkbox" checked={selected.has(q.id)} disabled={busy} onChange={event => {
          const next = new Set(selected);
          if (event.target.checked) next.add(q.id); else next.delete(q.id);
          setSelected(next);
        }} /><span><strong>{q.label}</strong><br />{q.prompt}</span></label>
        {result?.prompt === q.prompt && (result.message ? <p role="status">{result.message}</p> : <dl>
          <dt>標準答案</dt><dd>{result.answers[0]}</dd>
          {result.answers.length > 1 && <><dt>其他可接受答案</dt><dd>{result.answers.slice(1).join('、')}</dd></>}
        </dl>)}
      </li>;
    })}</ul>
    {!targets.length && <p role="status">目前沒有可補答案的題目。</p>}
    <div className="row-actions">
      <button type="button" className="quiet" onClick={() => dialog.current?.close()}>關閉</button>
      <button type="button" className="secondary-button" disabled={busy || !pending.length} onClick={() => void generate()}>{busy ? '正在產生…' : '產生建議'}</button>
      <button type="button" className="primary" disabled={busy || !accepted.size} onClick={() => {
        onAccept(accepted); dialog.current?.close();
      }}>加入標準答案</button>
    </div>
  </dialog>;
}
