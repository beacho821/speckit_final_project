import AnswerSuggestions, { fillBlankAnswer } from './AnswerSuggestions';
import type { SessionResponse } from '../../shared/api';
import { useId, useRef, useState, type FormEvent } from 'react';

export default function ManualQuestion({ disabled, onAdd, error, session, credential }: {
  session?: SessionResponse; credential?: string;
  disabled: boolean;
  onAdd: (prompt: string, acceptedAnswersText: string) => Promise<boolean>;
  error?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const title = useId();
  const [prompt, setPrompt] = useState('');
  const [answers, setAnswers] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  function reset() {
    setPrompt(''); setAnswers(''); setAttempted(false); setFailed(false);
    launcher.current?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (disabled || saving || !prompt.trim()) {
      const field = event.currentTarget.querySelector<HTMLTextAreaElement>(!prompt.trim() ? '[name="prompt"]' : '[name="answers"]');
      field?.focus();
      return;
    }
    setSaving(true); setFailed(false);
    try {
      if (await onAdd(prompt, answers)) dialog.current?.close();
      else setFailed(true);
    } finally { setSaving(false); }
  }

  return <>
    <button ref={launcher} className="primary" disabled={disabled} onClick={() => dialog.current?.showModal()}>新增題目</button>
    <dialog ref={dialog} className="work-dialog" aria-labelledby={title} onClose={reset}
      onCancel={event => { if (saving) event.preventDefault(); }}>
      <h2 id={title}>新增題目</h2>
      <form className="form-stack" noValidate onSubmit={event => void submit(event)}>
        <label>題幹<textarea name="prompt" autoFocus required rows={3} value={prompt} aria-invalid={attempted && !prompt.trim()}
          onChange={event => setPrompt(event.target.value)} /></label>
        {attempted && !prompt.trim() && <p className="error" role="alert">請填寫題幹。</p>}
        {session && credential && <AnswerSuggestions {...{ session, credential }} disabled={disabled || saving}
          targets={[{ id: 'manual', label: '新增題目', prompt, text: answers }]}
          onAccept={suggestions => setAnswers(previous => fillBlankAnswer(suggestions, 'manual', prompt, previous))} />}
        <label>標準答案（選填，一行一種答案）<textarea name="answers" rows={3} value={answers}
          onChange={event => setAnswers(event.target.value)} /></label>

        {failed && <p className="error" role="alert">{error || '題目未能儲存，請核對目前資料後再試。'}</p>}
        <div className="row-actions">
          <button type="button" className="secondary-button" disabled={saving} onClick={() => dialog.current?.close()}>取消</button>
          <button className="primary" disabled={disabled || saving}>{saving ? '儲存中…' : '儲存題目'}</button>
        </div>
      </form>
    </dialog>
  </>;
}
