import {useEffect, useState} from 'react';
import {loadUsage, currentRegulation, type UsageFile} from './lib/data';
import type {PokeSet} from './lib/sets';
import {RivalPage, type BattleMon} from './pages/RivalPage';
import {CalcPage, defaultCalcSets} from './pages/CalcPage';
import {MetaKOPage} from './pages/MetaKOPage';
import {MetaPage} from './pages/MetaPage';
import {TeamPage} from './pages/TeamPage';
import {SpeciesDatalist} from './components/ui';
import {EditorDatalists} from './components/SetEditor';

type Tab = 'rival' | 'calc' | 'ko' | 'meta' | 'team';
const TABS: [Tab, string, string][] = [
  ['rival', '🎯', 'Rival'],
  ['ko', '💥', 'KO vs meta'],
  ['calc', '🧮', 'Calculadora'],
  ['meta', '📊', 'Meta'],
  ['team', '🧩', 'Mi equipo'],
];

function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch { return initial; }
  });
  const set = (x: T) => {
    setV(x);
    try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* sin almacenamiento */ }
  };
  return [v, set];
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthLabel = (m: string) => { const [y, mm] = m.split('-'); return `${MONTHS[+mm - 1]} ${y}`; };

export default function App() {
  const [data, setData] = useState<UsageFile | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = usePersisted<Tab>('pp.tab', 'rival');
  const [dsKey, setDsKey] = usePersisted<string>('pp.ds', 'bo3');
  const [team, setTeam] = usePersisted<PokeSet[]>('pp.team', []);
  const [names, setNames] = usePersisted<string>('pp.rival', '');
  const [battleOwn, setBattleOwn] = usePersisted<BattleMon[]>('pp.battleOwn', []);
  const [att, setAtt] = usePersisted<PokeSet | null>('pp.att', null);
  const [def, setDef] = usePersisted<PokeSet | null>('pp.def', null);
  const [koSet, setKoSet] = usePersisted<PokeSet | null>('pp.ko', null);

  useEffect(() => { loadUsage().then(setData).catch(e => setError(String(e.message || e))); }, []);

  if (error) return <div className="center"><p className="bad">{error}</p></div>;
  if (!data) return <div className="center"><div className="spinner" /><p className="muted">Cargando estadísticas…</p></div>;

  const ds = data.datasets[dsKey] ?? Object.values(data.datasets)[0];
  const [d0, d1] = defaultCalcSets(ds);

  return (
    <div className="app">
      <SpeciesDatalist />
      <EditorDatalists />
      <header className="topbar">
        <div className="brand">
          <span className="logo">P+</span>
          <div>
            <h1>PokePlus</h1>
            <div className="small muted">VGC · Pokémon Champions · Regulación {data.regulation}</div>
          </div>
        </div>
        <div className="data-info">
          <select className="input small" value={dsKey} onChange={e => setDsKey(e.target.value)} title="Fuente de estadísticas">
            {Object.entries(data.datasets).map(([k, d]) => (
              <option key={k} value={k}>{k === 'bo3' ? 'Bo3 (estilo torneo)' : 'Ladder Bo1'} · {d.battles.toLocaleString('es-ES')} combates</option>
            ))}
          </select>
          <a className="small muted" href={ds.source} target="_blank" rel="noreferrer">Smogon · {monthLabel(data.month)} · ≥{ds.cutoff}</a>
        </div>
      </header>
      <nav className="tabs">
        {TABS.map(([k, icon, label]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            <span className="tab-icon">{icon}</span><span className="tab-label">{label}</span>
            {k === 'team' && team.length > 0 && <span className="badge">{team.length}</span>}
          </button>
        ))}
      </nav>
      {currentRegulation() && currentRegulation() !== data.regulation && (
        <div className="notice small">
          Ya está activa la Regulación {currentRegulation()}, pero Smogon aún no ha publicado sus estadísticas mensuales:
          se muestran las de la Regulación {data.regulation}. Se actualizarán solas en cuanto estén disponibles.
        </div>
      )}
      <main>
        {tab === 'rival' && <RivalPage ds={ds} myTeam={team} setMyTeam={setTeam} names={names} setNames={setNames} battleOwn={battleOwn} setBattleOwn={setBattleOwn} />}
        {tab === 'calc' && <CalcPage ds={ds} attacker={att ?? d0} setAttacker={setAtt} defender={def ?? d1} setDefender={setDef} />}
        {tab === 'ko' && <MetaKOPage ds={ds} set={koSet ?? team[0] ?? d0} setSet={setKoSet} myTeam={team} />}
        {tab === 'meta' && <MetaPage ds={ds} />}
        {tab === 'team' && <TeamPage ds={ds} team={team} setTeam={setTeam} />}
      </main>
      <footer className="small muted">
        Datos de uso reales de Pokémon Showdown (Smogon, rating ≥{ds.cutoff}), formato <code>{ds.id}</code>. Actualizados automáticamente cada mes ·
        cálculos con @smogon/calc. PokePlus no está afiliado a Nintendo, Game Freak ni The Pokémon Company.
      </footer>
    </div>
  );
}
