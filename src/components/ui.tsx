import {useState, type ReactNode} from 'react';
import {spriteUrl, baseSpriteUrl, typesOf, TYPE_COLORS, TYPE_ES, ALL_SPECIES} from '../lib/data';

export function Sprite({name, size = 56}: {name: string; size?: number}) {
  const [src, setSrc] = useState(spriteUrl(name));
  const [hidden, setHidden] = useState(false);
  if (hidden) return <div className="sprite placeholder" style={{width: size, height: size}}>{name.slice(0, 2)}</div>;
  return (
    <img
      className="sprite" src={src} width={size} height={size} alt={name} loading="lazy"
      onError={() => (src !== baseSpriteUrl(name) ? setSrc(baseSpriteUrl(name)) : setHidden(true))}
    />
  );
}

export function TypeBadge({type}: {type: string}) {
  return <span className="type" style={{background: TYPE_COLORS[type] ?? '#777'}}>{TYPE_ES[type] ?? type}</span>;
}

export function Types({name}: {name: string}) {
  return <span className="types">{typesOf(name).map(t => <TypeBadge key={t} type={t} />)}</span>;
}

export function Bar({label, pct, sub, color}: {label: ReactNode; pct: number; sub?: ReactNode; color?: string}) {
  return (
    <div className="bar">
      <div className="bar-fill" style={{width: `${Math.min(100, pct)}%`, background: color}} />
      <span className="bar-label">{label}</span>
      <span className="bar-pct">{sub ?? `${pct.toFixed(1)}%`}</span>
    </div>
  );
}

export function SpeciesInput({value, onChange, placeholder, list = 'species-list'}: {
  value: string; onChange: (v: string) => void; placeholder?: string; list?: string;
}) {
  return (
    <input className="input" list={list} value={value} placeholder={placeholder ?? 'Pokémon'}
      onChange={e => onChange(e.target.value)} spellCheck={false} autoCapitalize="off" />
  );
}

export function SpeciesDatalist() {
  return <datalist id="species-list">{ALL_SPECIES.map(n => <option key={n} value={n} />)}</datalist>;
}

export function KoBadge({hits, chance}: {hits: number; chance: number}) {
  if (!hits) return <span className="ko ko-none">—</span>;
  const cls = hits === 1 ? (chance >= 1 ? 'ko-1' : 'ko-1p') : hits === 2 ? (chance >= 1 ? 'ko-2' : 'ko-2p') : hits === 3 ? 'ko-3' : 'ko-4';
  const txt = hits === 1 ? 'OHKO' : `${hits}HKO`;
  return <span className={`ko ${cls}`} title={chance < 1 ? `${Math.round(chance * 100)}% de probabilidad` : 'garantizado'}>
    {chance > 0 && chance < 1 ? `${Math.round(chance * 100)}% ` : ''}{txt}
  </span>;
}

export function Card({title, children, right, className}: {title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || right) && <header className="card-head"><h3>{title}</h3>{right}</header>}
      {children}
    </section>
  );
}
