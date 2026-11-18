import { useState, type FormEvent } from 'react';

export default function ManualQuestion({ disabled, onAdd }: {
  disabled: boolean;
  onAdd: (questionId: string, prompt: string) => Promise<boolean>;
}) {
  const [questionId, setQuestionId] = useState('');
  const [prompt, setPrompt] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || !questionId.trim() || !prompt.trim()) return;
    if (await onAdd(questionId, prompt)) {
      setQuestionId('');
      setPrompt('');
    }
  }

  return <form className="form-stack question-editor" onSubmit={event => void submit(event)}>
    <fieldset className="form-stack" disabled={disabled}>
      <legend>手動新增單題</legend>
      <label>題號<input required value={questionId} onChange={event => setQuestionId(event.target.value)} /></label>
      <label>題目<textarea rows={3} required value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
      <button className="secondary-button" disabled={!questionId.trim() || !prompt.trim()}>新增題目</button>
    </fieldset>
  </form>;
}
