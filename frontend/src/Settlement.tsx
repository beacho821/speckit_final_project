import { useId } from 'react';
import type { ActivitySettlement } from '../../shared/api';
import Standings from './Standings';

export default function Settlement({ settlement, ownGroupId, preview = false }: {
  settlement: ActivitySettlement; ownGroupId?: string; preview?: boolean;
}) {
  const title = useId();
  const ownGroup = settlement.groups.find(group => group.id === ownGroupId);
  const top = settlement.groups.filter(group => group.rank <= 3);
  const others = settlement.groups.filter(group => group.rank > 3);
  return <section className="settlement-summary" aria-labelledby={title}>
    <h2 id={title}>{preview ? '最終排名預覽' : '活動結算'}</h2>
    <p>已定案 {settlement.roundCount} 回合</p>
    {ownGroup && <div className="settlement-own">
      <div><strong>{ownGroup.name}</strong><span>本組 · 第 {ownGroup.rank} 名</span></div>
      <div><strong>{ownGroup.points}</strong><span>分</span></div>
    </div>}
    <div className="settlement-top">
      <h3 className="settlement-list-heading">前三名</h3>
      <Standings groups={top} ownGroupId={ownGroupId} />
    </div>
    {others.length > 0 && <>
      <h3 className="settlement-list-heading">其他組別</h3>
      <Standings groups={others} ownGroupId={ownGroupId} />
    </>}
  </section>;
}
