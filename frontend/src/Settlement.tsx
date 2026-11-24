import type { ActivitySettlement } from '../../shared/api';

export default function Settlement({ settlement, ownGroupId }: { settlement: ActivitySettlement; ownGroupId?: string }) {
  const ownGroup = settlement.groups.find(group => group.id === ownGroupId);
  return <section className="settlement-summary" aria-labelledby="settlement-title">
    <h2 id="settlement-title">活動結算</h2>
    <p>已定案 {settlement.roundCount} 回合</p>
    {ownGroup && <div className="settlement-own">
      <div><span>本組</span><strong>{ownGroup.name}</strong></div>
      <div><strong>{ownGroup.wins}</strong><span>勝</span></div>
    </div>}
    {ownGroup && <h3 className="settlement-list-heading">各組勝場</h3>}
    <ul>{settlement.groups.map(group => <li key={group.id}>
      <strong>{group.name}{group.id === ownGroupId && '（本組）'}</strong>
      <span>{group.wins} 勝</span>
    </li>)}</ul>
  </section>;
}
