import type { GroupStanding } from '../../shared/api';

export default function Standings({ groups, ownGroupId, receivedByGroup }: {
  groups: readonly GroupStanding[];
  ownGroupId?: string;
  receivedByGroup?: ReadonlySet<string>;
}) {
  return <ol className="standings-list" role="list">{groups.map(group => <li key={group.id}
    className={group.id === ownGroupId ? 'standing-own' : undefined}>
    <span className="standing-rank">第 {group.rank} 名</span>
    <strong>{group.name}{group.id === ownGroupId && '（本組）'}</strong>
    <span className="standing-points">{group.points} 分</span>
    {receivedByGroup && <span className="standing-receipt">{receivedByGroup.has(group.id) ? '已送出' : '尚未送出'}</span>}
  </li>)}</ol>;
}
