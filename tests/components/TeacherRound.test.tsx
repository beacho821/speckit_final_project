// @vitest-environment jsdom
import {it,expect} from 'vitest';import {act} from 'react';import TeacherRound from '../../frontend/src/TeacherRound';import type {ActivityView} from '../../shared/api';import {render,host} from '../helpers/ui';
it('成功換來源清選題、不自動選首題；未確認時禁準備及開始',async()=>{const session={role:'teacher' as const,activityId:'a'},view:ActivityView={phase:'idle',roundId:null,unit:null,closedRoundIds:[],version:1,availableUnits:[{unitId:'u',questionIds:['1']}]};await render(<TeacherRound session={session} credential="test" view={view}/>);const select=host.querySelector('select')!;await act(async()=>{select.value='u';select.dispatchEvent(new Event('change',{bubbles:true}));});expect(host.querySelector('button')?.disabled).toBe(false);await render(<TeacherRound session={session} credential="test" view={{...view,worksheetPreview:{source:{kind:'xlsx',fileName:'新.xlsx',sheetId:1,sheetTitle:'新',importedAt:2},mainQuestionCount:1,unitCount:1,fillCount:1,units:[]}}} blocked/>);expect(host.querySelector('select')?.value).toBe('');expect(host.querySelector('button')?.disabled).toBe(true);await render(<TeacherRound session={session} credential="test" view={{...view,phase:'preparing',roundId:'r',groups:[{id:'g',name:'甲',received:false}]}} blocked/>);expect([...host.querySelectorAll('button')].find(b=>b.textContent==='開始搶答')?.disabled).toBe(true);});

it('老師在準備畫面看完整題幹及逐題標準答案欄', async () => {
  const question = { questionKey:'q', unitId:'u', questionId:'1', origin:'worksheet' as const, prompt:'請說明裝置的用途。', missingPrompt:false, acceptedAnswers:['甲','乙'], questionRevision:1 };
  const view: ActivityView = { phase:'preparing', roundId:'r', unit:{id:'u', name:'1', questionIds:['1'], fillBlankIds:[],questions:[question]}, editableQuestions:[question], closedRoundIds:[], version:1 };
  await render(<TeacherRound session={{role:'teacher',activityId:'a'}} credential="test" view={view}/>);
  expect(host.textContent).toContain(question.prompt);
  const input = [...host.querySelectorAll('textarea')].find(field => field.value === '甲\n乙');
  expect(input?.labels?.[0]?.textContent).toContain('標準答案');
});

it.each(['new-round','new-source'] as const)('跨分頁更新後可複製舊題草稿，且新題可獨立開題（%s）', async change => {
  const session = {role:'teacher' as const,activityId:'a'};
  const question = {questionKey:'q1',unitId:'u',questionId:'1',origin:'worksheet' as const,prompt:'來源題幹',missingPrompt:false,acceptedAnswers:['甲'],questionRevision:0};
  const source = {kind:'xlsx' as const,fileName:'學習單.xlsx',sheetId:1,sheetTitle:'學習單',importedAt:1};
  const view: ActivityView = {
    phase:'preparing',roundId:'r1',unit:{id:'u',name:'題組',questionIds:['1'],fillBlankIds:[],questions:[question]},editableQuestions:[question],
    groups:[{id:'g',name:'甲組',received:false}],closedRoundIds:[],version:1,
    worksheetPreview:{source,mainQuestionCount:1,unitCount:1,fillCount:1,units:[]},
  };
  const show = (current: ActivityView) => render(<TeacherRound session={session} credential="test" view={current}/>);
  await show(view);
  const setText = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;
  await act(async () => {
    const fields = [...host.querySelectorAll('fieldset.question-editor textarea')];
    for (const [field,value] of [[fields[0],'舊題未存題幹'],[fields[1],'舊題未存答案']] as const) {
      setText.call(field,value);
      field.dispatchEvent(new Event('input',{bubbles:true}));
    }
  });
  expect([...host.querySelectorAll('button')].find(b=>b.textContent==='開始搶答')?.disabled).toBe(true);
  const replacement = change === 'new-source'
    ? {...question,questionKey:'q2',prompt:'替換來源題幹',acceptedAnswers:['乙']}
    : question;
  await show({...view,roundId:'r2',version:2,editableQuestions:[replacement],
    worksheetPreview:{...view.worksheetPreview!,source:{...source,importedAt:change==='new-source'?2:1}}});
  const fields = [...host.querySelectorAll('textarea')];
  expect(fields.filter(f=>f.readOnly).map(f=>f.value)).toEqual(['舊題未存題幹','舊題未存答案']);
  expect(fields.some(f=>!f.readOnly && f.value==='舊題未存題幹')).toBe(false);
  expect([...host.querySelectorAll('button')].find(b=>b.textContent==='儲存第 1 題')?.disabled).toBe(true);
  expect([...host.querySelectorAll('button')].find(b=>b.textContent==='開始搶答')?.disabled).toBe(false);
});
