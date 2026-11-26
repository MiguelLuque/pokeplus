import {useMemo, useState} from 'react';
import type {Dataset} from '../lib/data';
import type {PokeSet} from '../lib/sets';
import {vsMeta, metaThreats} from '../lib/analysis';
import type {FieldOpts} from '../lib/damage';
import {SetEditor} from '../components/SetEditor';
import {Card, KoBadge, Sprite} from '../components/ui';

export function MetaKOPage({ds, set, setSet, myTeam}: {ds: Dataset; set: PokeSet; setSet: (s: PokeSet) => void; myTeam: PokeSet[]}) {
  const [mode, setMode] = useState<'attack' | 'defend'>('attack');
  const [n, setN] = useState(30);
  const [onlyKO, setOnlyKO] = useState(false);
  const [weather, setWeather] = useState<FieldOpts['weather']>('');
  const field: FieldOpts = {weather};
  const rows = useMemo(
    () => (mode === 'attack' ? vsMeta(set, ds, n, field) : metaThreats(set, ds, n, field)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set, ds, n, mode, weather]
  );
  const shown = onlyKO ? rows.filter(r => r.best && r.best.hits && r.best.hits <= 2) : rows;
  const count = (h: number) => rows.filter(r => r.best?.hits === h && (h > 1 || r.best.chance >= 1)).length;
  const team = myTeam.filter(t => t.species);

  return (
    <div className="page">
      <div className="calc-layout">
        <Card title={mode === 'attack' ? 'Tu atacante' : 'Tu Pokémon (defensor)'}>
          {team.length > 0 && (
            <div className="chips">
              {team.map((t, i) => <button key={i} className={`chip ${t.species === set.species ? 'active' : ''}`} onClick={() => setSet(t)}>{t.species}</button>)}
            </div>
          )}
          <SetEditor set={set} onChange={setSet} ds={ds} compact />
        </Card>
        <Card title="Opciones">
          <div className="seg">
            <button className={mode === 'attack' ? 'active' : ''} onClick={() => setMode('attack')}>⚔️ ¿A quién hago KO?</button>
            <button className={mode === 'defend' ? 'active' : ''} onClick={() => setMode('defend')}>🛡️ ¿Quién me hace KO?</button>
          </div>
          <label className="row gap">Top del meta: <select className="input" value={n} onChange={e => setN(+e.target.value)}>{[15, 30, 50, 75].map(x => <option key={x}>{x}</option>)}</select></label>
          <label className="row gap">Clima: <select className="input" value={weather} onChange={e => setWeather(e.target.value as FieldOpts['weather'])}>
            <option value="">Ninguno</option><option value="Sun">Sol</option><option value="Rain">Lluvia</option><option value="Sand">Arena</option><option value="Snow">Nieve</option>
          </select></label>
          <label className="check"><input type="checkbox" checked={onlyKO} onChange={e => setOnlyKO(e.target.checked)} />Solo OHKO / 2HKO</label>
          <div className="stats-row">
            <div><strong className="good">{count(1)}</strong><span className="small muted">OHKO seguros</span></div>
            <div><strong>{count(2)}</strong><span className="small muted">2HKO seguros</span></div>
            <div><strong>{rows.length}</strong><span className="small muted">analizados</span></div>
          </div>
          <p className="small muted">Cada rival usa su set más común (reparto de SP, naturaleza, objeto y habilidad más usados). En modo defensa se prueban los 6 ataques ofensivos más usados por cada rival.</p>
        </Card>
      </div>
      <Card title={mode === 'attack' ? `${set.species} contra el meta` : `Amenazas del meta para ${set.species}`}>
        <div className="table-wrap">
          <table className="ko-table">
            <thead><tr><th>#</th><th>Pokémon</th><th>Mejor</th><th>Todos los ataques</th></tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.species}>
                  <td className="muted small">{i + 1}</td>
                  <td><div className="row gap"><Sprite name={r.species} size={36} /><div><div>{r.species}</div><div className="small muted">{r.usage.toFixed(1)}% · {r.set.item || 'sin objeto'}</div></div></div></td>
                  <td>{r.best ? <div><KoBadge hits={r.best.hits} chance={r.best.chance} /><div className="small">{r.best.move}</div><div className="small muted">{r.best.minPct}–{r.best.maxPct}%</div></div> : '—'}</td>
                  <td>
                    <div className="mini-results">
                      {r.results.map(x => (
                        <span key={x.move} className="mini" title={x.desc}>
                          <span className="small">{x.move}</span> <span className="small muted">{x.minPct}–{x.maxPct}%</span> <KoBadge hits={x.hits} chance={x.chance} />
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
