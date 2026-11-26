import {useMemo, useState} from 'react';
import type {Dataset} from '../lib/data';
import {commonSet, type PokeSet, attacksOf} from '../lib/sets';
import {calcMove, noBoosts, type Boosts, type FieldOpts, type SideOpts} from '../lib/damage';
import {SetEditor} from '../components/SetEditor';
import {Card, KoBadge} from '../components/ui';

const BOOST_STATS: (keyof Boosts)[] = ['atk', 'def', 'spa', 'spd', 'spe'];
const BOOST_LABEL: Record<keyof Boosts, string> = {atk: 'Ata', def: 'Def', spa: 'AtE', spd: 'DfE', spe: 'Vel'};

export function CalcPage({ds, attacker, setAttacker, defender, setDefender}: {
  ds: Dataset; attacker: PokeSet; setAttacker: (s: PokeSet) => void; defender: PokeSet; setDefender: (s: PokeSet) => void;
}) {
  const [field, setField] = useState<FieldOpts>({weather: '', terrain: '', attacker: {}, defender: {}, spreadTargets: true});
  const [ab, setAb] = useState<Boosts>(noBoosts());
  const [db, setDb] = useState<Boosts>(noBoosts());
  const [crit, setCrit] = useState(false);
  const [hp, setHp] = useState(100);

  const results = useMemo(() => {
    const out = [];
    for (const [a, d, dir, abo, dbo] of [[attacker, defender, '→', ab, db], [defender, attacker, '←', db, ab]] as const) {
      const f: FieldOpts = dir === '→' ? field : {...field, attacker: field.defender, defender: field.attacker};
      out.push({dir, a, d, rows: attacksOf(a).map(m => calcMove(a, d, m, f, {attackerBoosts: abo, defenderBoosts: dbo, crit, defenderHP: dir === '→' ? hp : 100}))});
    }
    return out;
  }, [attacker, defender, field, ab, db, crit, hp]);

  const side = (k: 'attacker' | 'defender', key: keyof SideOpts) => (
    <label className="check" key={key}>
      <input type="checkbox" checked={!!field[k]?.[key]} onChange={e => setField({...field, [k]: {...field[k], [key]: e.target.checked}})} />
      {{reflect: 'Reflejo', lightScreen: 'Pantalla Luz', auroraVeil: 'Velo Aurora', helpingHand: 'Refuerzo', friendGuard: 'Compiescolta', tailwind: 'Viento Afín'}[key]}
    </label>
  );

  return (
    <div className="page">
      <div className="calc-layout">
        <Card title="Atacante" right={<button className="btn ghost small" onClick={() => { setAttacker(defender); setDefender(attacker); }}>⇄ Intercambiar</button>}>
          <SetEditor set={attacker} onChange={setAttacker} ds={ds} />
          <Boost value={ab} onChange={setAb} />
        </Card>
        <Card title="Defensor">
          <SetEditor set={defender} onChange={setDefender} ds={ds} />
          <Boost value={db} onChange={setDb} />
          <label className="row gap small">PS actuales: <input type="range" min={1} max={100} value={hp} onChange={e => setHp(+e.target.value)} /> {hp}%</label>
        </Card>
      </div>
      <Card title="Campo (combate doble)">
        <div className="row wrap gap">
          <label>Clima <select className="input" value={field.weather} onChange={e => setField({...field, weather: e.target.value as FieldOpts['weather']})}>
            <option value="">Ninguno</option><option value="Sun">Sol</option><option value="Rain">Lluvia</option><option value="Sand">Tormenta de arena</option><option value="Snow">Nieve</option>
          </select></label>
          <label>Campo <select className="input" value={field.terrain} onChange={e => setField({...field, terrain: e.target.value as FieldOpts['terrain']})}>
            <option value="">Ninguno</option><option value="Electric">Eléctrico</option><option value="Grassy">Hierba</option><option value="Psychic">Psíquico</option><option value="Misty">Niebla</option>
          </select></label>
          <label className="check"><input type="checkbox" checked={field.spreadTargets !== false} onChange={e => setField({...field, spreadTargets: e.target.checked})} />Ataques de área a 2 objetivos (×0.75)</label>
          <label className="check"><input type="checkbox" checked={crit} onChange={e => setCrit(e.target.checked)} />Golpe crítico</label>
        </div>
        <div className="grid2">
          <div><h4>Lado atacante</h4><div className="row wrap gap">{(['helpingHand', 'tailwind'] as const).map(k => side('attacker', k))}</div></div>
          <div><h4>Lado defensor</h4><div className="row wrap gap">{(['reflect', 'lightScreen', 'auroraVeil', 'friendGuard'] as const).map(k => side('defender', k))}</div></div>
        </div>
      </Card>
      {results.map(({dir, a, d, rows}) => (
        <Card key={dir} title={`${a.species} ${dir === '→' ? '→' : '→'} ${d.species}`}>
          {rows.every(r => !r) && <p className="muted small">Sin ataques ofensivos en el set.</p>}
          <div className="results">
            {rows.map((r, i) => r && (
              <div className="result" key={i}>
                <div className="result-head">
                  <strong>{r.move}</strong>{r.spread && field.spreadTargets !== false && <span className="small muted">(área)</span>}
                  <span className="dmg">{r.minPct}% – {r.maxPct}%</span>
                  <KoBadge hits={r.hits} chance={r.chance} />
                </div>
                <div className="hpbar"><div className="hp-max" style={{width: `${Math.min(100, r.maxPct)}%`}} /><div className="hp-min" style={{width: `${Math.min(100, r.minPct)}%`}} /></div>
                <div className="small muted desc">{r.desc}</div>
              </div>
            ))}
          </div>
        </Card>
      ))}
      <p className="small muted">Motor de cálculo: @smogon/calc (el mismo que usa la calculadora de Pokémon Showdown) con mecánicas de Pokémon Champions: nivel 50, 32 SP máx. por stat y 66 en total.</p>
    </div>
  );
}

function Boost({value, onChange}: {value: Boosts; onChange: (b: Boosts) => void}) {
  return (
    <div className="boosts">
      {BOOST_STATS.map(s => (
        <label key={s}>{BOOST_LABEL[s]}
          <select className="input" value={value[s]} onChange={e => onChange({...value, [s]: +e.target.value})}>
            {[6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6].map(n => <option key={n} value={n}>{n > 0 ? `+${n}` : n}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

export const defaultCalcSets = (ds: Dataset): [PokeSet, PokeSet] => {
  const top = Object.entries(ds.pokemon).sort((a, b) => a[1].rank - b[1].rank);
  return [commonSet(top[0][0], top[0][1]), commonSet(top[1][0], top[1][1])];
};
