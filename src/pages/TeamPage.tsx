import {useState} from 'react';
import type {Dataset} from '../lib/data';
import {parsePaste, exportSet, commonSet, parseNameList, type PokeSet} from '../lib/sets';
import {SetEditor} from '../components/SetEditor';
import {Card} from '../components/ui';

export function TeamPage({ds, team, setTeam}: {ds: Dataset; team: PokeSet[]; setTeam: (t: PokeSet[]) => void}) {
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState('');

  function importPaste() {
    const sets = parsePaste(paste);
    if (sets.length && /\n-/.test(paste)) {
      setTeam(sets.slice(0, 6));
      setMsg(`Importados ${Math.min(6, sets.length)} Pokémon.`);
      return;
    }
    // Lista de nombres sin sets: usar el set más común de cada uno
    const {found, unknown} = parseNameList(paste);
    if (found.length) {
      setTeam(found.slice(0, 6).map(n => commonSet(n, ds.pokemon[n])));
      setMsg(`Creado equipo con los sets más usados.${unknown.length ? ` No reconocidos: ${unknown.join(', ')}` : ''}`);
    } else setMsg('No se reconoció ningún Pokémon.');
  }

  const update = (i: number, s: PokeSet) => setTeam(team.map((t, j) => (j === i ? s : t)));

  return (
    <div className="page">
      <Card title="Importar equipo">
        <p className="muted small">Pega tu equipo en formato Showdown (las líneas «EVs:» se interpretan como Stat Points de Champions) o simplemente una lista de nombres.</p>
        <textarea className="input textarea" rows={6} value={paste} onChange={e => setPaste(e.target.value)} spellCheck={false}
          placeholder={'Incineroar @ Sitrus Berry\nAbility: Intimidate\nEVs: 32 HP / 2 Atk / 32 SpD\nCareful Nature\n- Fake Out\n- Flare Blitz\n- Parting Shot\n- Knock Off'} />
        <div className="row gap wrap">
          <button className="btn" onClick={importPaste}>Importar</button>
          <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(team.map(exportSet).join('\n\n')); setMsg('Equipo copiado al portapapeles.'); }}>Exportar / copiar</button>
          {team.length < 6 && <button className="btn ghost" onClick={() => setTeam([...team, commonSet('Incineroar', ds.pokemon.Incineroar)])}>+ Añadir Pokémon</button>}
          {team.length > 0 && <button className="btn ghost danger" onClick={() => setTeam([])}>Vaciar</button>}
          {msg && <span className="small muted">{msg}</span>}
        </div>
      </Card>
      <div className="cards-grid">
        {team.map((s, i) => (
          <Card key={i} title={`#${i + 1}`} right={<button className="btn ghost small danger" onClick={() => setTeam(team.filter((_, j) => j !== i))}>Quitar</button>}>
            <SetEditor set={s} onChange={x => update(i, x)} ds={ds} />
          </Card>
        ))}
      </div>
    </div>
  );
}
