import {useMemo} from 'react';
import {gen, toID, speciesName, type Dataset} from '../lib/data';
import {STATS, STAT_LABEL, SP_MAX, SP_TOTAL, commonSet, type PokeSet, defaultAbility, spreadLabel, parseSpread} from '../lib/sets';
import {statsOf} from '../lib/damage';
import {Sprite, Types, SpeciesInput} from './ui';

const NATURES = [...gen.natures].map(n => n.name).sort();
const ITEMS = [...gen.items].map(i => i.name).sort();
const ABILITIES = [...gen.abilities].map(a => a.name).sort();
const MOVES = [...gen.moves].filter(m => m.name !== '(No Move)').map(m => m.name).sort();

const NATURE_HINT: Record<string, string> = Object.fromEntries([...gen.natures].map(n => [n.name,
  n.plus && n.plus !== n.minus ? `+${STAT_LABEL[n.plus as keyof typeof STAT_LABEL]} −${STAT_LABEL[n.minus as keyof typeof STAT_LABEL]}` : 'neutra']));

export function EditorDatalists() {
  return (
    <>
      <datalist id="items-list">{ITEMS.map(n => <option key={n} value={n} />)}</datalist>
      <datalist id="abilities-list">{ABILITIES.map(n => <option key={n} value={n} />)}</datalist>
      <datalist id="moves-list">{MOVES.map(n => <option key={n} value={n} />)}</datalist>
    </>
  );
}

function SetBody({set, onChange, usage, stats, total, setSP}: {
  set: PokeSet; onChange: (s: PokeSet) => void; usage?: Dataset['pokemon'][string]; stats: ReturnType<typeof statsOf> | null; total: number;
  setSP: (s: keyof PokeSet['sp'], v: number) => void;
}) {
  return (
    <>
      <div className="grid2">
        <label>Objeto<input className="input" list="items-list" value={set.item} onChange={e => onChange({...set, item: e.target.value, origin: 'manual'})} /></label>
        <label>Habilidad<input className="input" list="abilities-list" value={set.ability} onChange={e => onChange({...set, ability: e.target.value, origin: 'manual'})} /></label>
        <label>Naturaleza
          <select className="input" value={set.nature} onChange={e => onChange({...set, nature: e.target.value, origin: 'manual'})}>
            {NATURES.map(n => <option key={n} value={n}>{n} ({NATURE_HINT[n]})</option>)}
          </select>
        </label>
        {usage && usage.spreads.length > 0 && (
          <label>Reparto común
            <select className="input" value="" onChange={e => {
              if (!e.target.value) return;
              const {nature, sp} = parseSpread(e.target.value);
              onChange({...set, nature, sp, origin: 'usage'});
            }}>
              <option value="">Elegir…</option>
              {usage.spreads.map(([s, p]) => <option key={s} value={s}>{spreadLabel(s)} · {p}%</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="sp-table">
        <div className="sp-row sp-header"><span /><span>SP</span><span>Stat</span></div>
        {STATS.map(s => (
          <div className="sp-row" key={s}>
            <span className="sp-label">{STAT_LABEL[s]}</span>
            <span className="sp-input">
              <input type="range" min={0} max={SP_MAX} value={set.sp[s]} onChange={e => setSP(s, +e.target.value)} />
              <input className="input num" type="number" min={0} max={SP_MAX} value={set.sp[s]} onChange={e => setSP(s, +e.target.value)} />
            </span>
            <span className="sp-stat">{stats?.[s] ?? '—'}</span>
          </div>
        ))}
        <div className={`sp-total ${total > SP_TOTAL ? 'over' : ''}`}>Total SP: {total}/{SP_TOTAL}{total > SP_TOTAL && ' · excede el máximo'}</div>
      </div>
      <div className="moves-grid">
        {[0, 1, 2, 3].map(i => (
          <input key={i} className="input" list="moves-list" placeholder={`Movimiento ${i + 1}`} value={set.moves[i] ?? ''}
            onChange={e => {
              const moves = [...set.moves];
              moves[i] = e.target.value;
              onChange({...set, moves: moves.slice(0, 4), origin: 'manual'});
            }} />
        ))}
      </div>
    </>
  );
}

export function SetEditor({set, onChange, ds, compact}: {set: PokeSet; onChange: (s: PokeSet) => void; ds?: Dataset; compact?: boolean}) {
  const valid = !!gen.species.get(toID(set.species) as never);
  const stats = useMemo(() => (valid ? statsOf(set) : null), [set, valid]);
  const total = STATS.reduce((a, s) => a + set.sp[s], 0);
  const usage = ds?.pokemon[set.species];

  const setSpecies = (v: string) => {
    const name = speciesName(v);
    if (name && name !== set.species) {
      onChange(ds?.pokemon[name] ? commonSet(name, ds.pokemon[name]) : {...set, species: name, ability: defaultAbility(name)});
    } else onChange({...set, species: v});
  };
  const setSP = (s: keyof PokeSet['sp'], v: number) => {
    const n = Math.max(0, Math.min(SP_MAX, Math.round(v) || 0));
    onChange({...set, sp: {...set.sp, [s]: n}, origin: 'manual'});
  };

  return (
    <div className={`set-editor ${compact ? 'compact' : ''}`}>
      <div className="set-head">
        {valid && <Sprite name={set.species} />}
        <div className="set-head-fields">
          <SpeciesInput value={set.species} onChange={setSpecies} />
          {valid && <Types name={set.species} />}
        </div>
      </div>
      {compact ? (
        <details className="set-details">
          <summary className="small">{set.item || 'Sin objeto'} · {set.ability} · {set.nature} · {set.moves.filter(Boolean).join(' / ')} <span className="muted">(editar)</span></summary>
          <SetBody set={set} onChange={onChange} usage={usage} stats={stats} total={total} setSP={setSP} />
        </details>
      ) : <SetBody set={set} onChange={onChange} usage={usage} stats={stats} total={total} setSP={setSP} />}
      {usage && (
        <button className="btn ghost small" onClick={() => onChange(commonSet(set.species, usage))}>
          Cargar set más usado
        </button>
      )}
    </div>
  );
}
