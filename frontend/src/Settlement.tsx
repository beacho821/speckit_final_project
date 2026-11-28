import { useEffect, useId, useState, type CSSProperties } from 'react';
import type { ActivitySettlement } from '../../shared/api';
import { AwardEmblem } from './AwardEmblem';
import Standings from './Standings';
import './awards.css';

type Props = { settlement: ActivitySettlement; ownGroupId?: string; preview?: boolean };
const places = { 1: '第一名', 2: '第二名', 3: '第三名' } as const;
const revealOrder = [3, 2, 1] as const;

function Celebration() {
  return <div className="award-effects" aria-hidden="true">
    <i className="award-firework" /><i className="award-firework" />
    {Array.from({ length: 32 }, (_, i) => <i className="award-confetti" key={i} style={{
      '--x': (i * 37 % 100) + '%', '--delay': (i % 9) * .105 + 's',
      '--drift': ((i * 29 % 110) - 55) + 'px', '--turn': (i % 2 ? -1 : 1) * (145 + i * 11) + 'deg',
    } as CSSProperties} />)}
  </div>;
}

export default function Settlement(props: Props) {
  // 公布時從序幕開始；同一份結算的輪詢更新保留播放進度。
  return <AwardStage key={props.preview ? 'preview' : 'published'} {...props} />;
}

function AwardStage({ settlement, ownGroupId, preview = false }: Props) {
  const title = useId();
  const tiers = revealOrder.map(rank => ({ rank, groups: settlement.groups.filter(group => group.rank === rank) }))
    .filter(tier => tier.groups.length);
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const count = tiers.length;
  const shown = preview ? count : Math.min(step, count);
  const complete = shown === count;
  const lastTier = tiers[shown - 1];
  const ownGroup = settlement.groups.find(group => group.id === ownGroupId);
  const others = settlement.groups.filter(group => group.rank > 3);
  useEffect(() => {
    if (preview || step >= count) return;
    const timer = window.setTimeout(() => setStep(value => value + 1), step === 0 ? 650 : 1850);
    return () => window.clearTimeout(timer);
  }, [count, preview, step]);

  function controlPlayback() {
    setSkipped(!complete);
    setStep(complete ? 0 : count);
  }

  return <section className="settlement-summary" aria-labelledby={title}>
    <div className="award-stage" data-still={preview || skipped}>
      <header className="award-heading">
        <p>已定案 {settlement.roundCount} 回合</p>
        <h2 id={title}>{preview ? '最終排名預覽' : '活動結算'}</h2>
      </header>
      {count > 0 ? <>
        <div className="award-podium" aria-label="前三名">
          {tiers.map(({ rank, groups }, index) => {
            const visible = index < shown;
            return <section className="award-slot" key={rank} data-rank={rank} data-revealed={visible}
              aria-label={places[rank]}>
              {visible ? <div className="award-winner">
                <AwardEmblem rank={rank} />
                <div className="award-step">
                  <h3>{groups.length > 1 ? '並列' : ''}{places[rank]}</h3>
                  <ul>{groups.map(group => <li key={group.id}><strong>{group.name}</strong>{group.id === ownGroupId && <span className="award-own-mark">本組</span>}</li>)}</ul>
                  <p>總積分 <b>{groups[0].points}</b> 分</p>
                </div>
              </div> : <div className="award-sealed" aria-hidden="true"><span>{places[rank]}</span>待揭曉</div>}
            </section>;
          })}
        </div>
        {!preview && <div className="award-controls">
          <span className={complete ? 'sr-only' : undefined} role="status" aria-live="polite" aria-atomic="true">{lastTier
            ? `${lastTier.groups.length > 1 ? '並列' : ''}${places[lastTier.rank]} · ${lastTier.groups.map(group => group.name).join('、')}`
            : '即將揭曉' + places[tiers[0].rank]}</span>
          <button type="button" onClick={controlPlayback}>{complete ? '重播頒獎' : '略過動畫'}</button>
        </div>}
        {complete && !preview && !skipped && lastTier?.rank === 1 && <Celebration />}
      </> : <p className="award-empty">本場沒有可頒獎的組別。</p>}
    </div>
    {complete && ownGroup && <div className="settlement-own">
      <div><strong>{ownGroup.name}</strong><span>本組 · 第 {ownGroup.rank} 名</span></div>
      <div><strong>{ownGroup.points}</strong><span>分</span></div>
    </div>}
    {complete && others.length > 0 && <>
      <h3 className="settlement-list-heading">其他組別</h3>
      <Standings groups={others} ownGroupId={ownGroupId} />
    </>}
  </section>;
}
