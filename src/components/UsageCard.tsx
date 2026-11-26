import {type MonUsage, moveName, itemName, abilityName, gen, toID} from '../lib/data';
import {spreadLabel, type PokeSet} from '../lib/sets';
import {effectiveSpeed} from '../lib/damage';
import {Bar, Sprite, Types, TypeBadge} from './ui';
import type {FormOption} from '../lib/analysis';

const moveType = (id: string) => gen.moves.get(toID(id) as never)?.type ?? '';

export function UsageCard({set, usage, forms, onForm, extra, compact}: {
  set: PokeSet; usage?: MonUsage; forms?: FormOption[]; onForm?: (f: string) => void; extra?: React.ReactNode; compact?: boolean;
}) {
  const scarf = usage?.items.find(i => i[0] === 'choicescarf')?.[1] ?? 0;
  // velocidad sin objeto; el Pañuelo Elección se muestra aparte con su % de uso
  const spe = effectiveSpeed({...set, item: ''});
  return (
    <article className="mon-card">
      <header className="mon-head">
        <Sprite name={set.species} size={64} />
        <div className="mon-title">
          <h3>{set.species}</h3>
          <Types name={set.species} />
          {usage && <div className="muted small">#{usage.rank} · uso {usage.usage.toFixed(1)}%</div>}
        </div>
        <div className="speed-pill" title="Velocidad con el reparto más usado">
          <span className="muted small">Vel</span><strong>{spe}</strong>
          {scarf >= 3 && <span className="small warn">Scarf {scarf.toFixed(0)}% → {Math.floor(spe * 1.5)}</span>}
        </div>
      </header>
      {forms && forms.length > 1 && (
        <div className="forms">
          {forms.map(f => (
            <button key={f.species} className={`chip ${f.species === set.species ? 'active' : ''}`} onClick={() => onForm?.(f.species)}>
              {f.species} · {(f.prob * 100).toFixed(0)}%
            </button>
          ))}
        </div>
      )}
      {!usage && <p className="muted small">Sin datos de uso en este formato: se usa un set genérico. Puedes editarlo en la calculadora.</p>}
      {usage && (
        <div className={`usage-grid ${compact ? 'compact' : ''}`}>
          <div>
            <h4>Movimientos</h4>
            {usage.moves.slice(0, compact ? 6 : 10).map(([m, p]) => (
              <Bar key={m} pct={p} label={<><TypeBadge type={moveType(m)} /> {moveName(m)}</>} />
            ))}
          </div>
          <div>
            <h4>Objetos</h4>
            {usage.items.slice(0, compact ? 4 : 6).map(([m, p]) => <Bar key={m} pct={p} label={itemName(m)} color="#7c5cff55" />)}
            <h4>Habilidad</h4>
            {usage.abilities.slice(0, 3).map(([m, p]) => <Bar key={m} pct={p} label={abilityName(m)} color="#2bb67355" />)}
          </div>
          <div>
            <h4>Repartos (SP)</h4>
            {usage.spreads.slice(0, compact ? 3 : 5).map(([m, p]) => <Bar key={m} pct={p} label={<span className="small">{spreadLabel(m)}</span>} color="#f5a52455" />)}
            {!compact && (
              <>
                <h4>Compañeros frecuentes</h4>
                <div className="chips">{usage.teammates.slice(0, 8).map(([m, p]) => <span key={m} className="chip static">{m} {p.toFixed(0)}%</span>)}</div>
                {usage.checks.length > 0 && <>
                  <h4>Le ganan (checks & counters)</h4>
                  <div className="chips">{usage.checks.slice(0, 6).map(([m, s]) => <span key={m} className="chip static" title="Puntuación Smogon (KO o le obliga a cambiar)">{m} {s.toFixed(0)}</span>)}</div>
                </>}
              </>
            )}
          </div>
        </div>
      )}
      {extra}
    </article>
  );
}
