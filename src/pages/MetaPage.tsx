import {useMemo, useState} from 'react';
import {toID, type Dataset} from '../lib/data';
import {commonSet} from '../lib/sets';
import {UsageCard} from '../components/UsageCard';
import {Card, Sprite, Types} from '../components/ui';

export function MetaPage({ds}: {ds: Dataset}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const list = useMemo(() => Object.entries(ds.pokemon).sort((a, b) => a[1].rank - b[1].rank), [ds]);
  const filtered = list.filter(([n]) => toID(n).includes(toID(q)));
  const current = sel && ds.pokemon[sel] ? sel : list[0]?.[0];

  return (
    <div className="page meta-layout">
      <Card title={`Ranking de uso (${list.length})`} className="meta-list">
        <input className="input" placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} />
        <ol className="rank">
          {filtered.map(([n, u]) => (
            <li key={n} className={n === current ? 'active' : ''} onClick={() => setSel(n)}>
              <span className="muted small rank-n">{u.rank}</span>
              <Sprite name={n} size={36} />
              <span className="rank-name">{n}<Types name={n} /></span>
              <span className="rank-pct">{u.usage.toFixed(1)}%</span>
            </li>
          ))}
        </ol>
      </Card>
      <div className="meta-detail">
        {current && <UsageCard set={commonSet(current, ds.pokemon[current])} usage={ds.pokemon[current]} />}
      </div>
    </div>
  );
}
