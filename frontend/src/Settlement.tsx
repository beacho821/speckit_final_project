import type { ActivitySettlement } from '../../shared/api';

export default function Settlement({ settlement, ownGroupId }: { settlement: ActivitySettlement; ownGroupId?: string }) {
  return <section className="settlement-summary" aria-labelledby="settlement-title">
    <h2 id="settlement-title">活動結算</h2>
    <p>已定案 {settlement.roundCount} 回合</p>
    <ul>{settlement.groups.map(group => <li key={group.id}>
      <strong>{group.name}{group.id === ownGroupId && '（本組）'}</strong>
      <span>{group.wins} 勝</span>
    </li>)}</ul>
  </section>;
}
