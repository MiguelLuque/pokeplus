import {useMemo, useRef, useState} from 'react';
import type {Dataset} from '../lib/data';
import {parseNameList, type PokeSet} from '../lib/sets';
import {buildRival, plan, suggest, rolesOf, roleTags, type RivalMon} from '../lib/analysis';
import {recognizeTeam} from '../lib/ocr';
import {UsageCard} from '../components/UsageCard';
import {Card, KoBadge, Sprite} from '../components/ui';
import {koLabel} from '../lib/damage';

const EXAMPLE = 'Incineroar, Rillaboom, Sneasler, Kingambit, Charizard, Garchomp';

export function RivalPage({ds, myTeam, names, setNames}: {
  ds: Dataset; myTeam: PokeSet[]; names: string; setNames: (s: string) => void;
}) {
  const [forms, setForms] = useState<Record<string, string>>({});
  const [ocr, setOcr] = useState<{busy: boolean; msg: string; p: number; raw?: string}>({busy: false, msg: '', p: 0});
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseNameList(names), [names]);
  const rivals: RivalMon[] = useMemo(
    () => parsed.found.slice(0, 6).map(n => buildRival(n, ds, forms[n])),
    [parsed, ds, forms]
  );
  const team = useMemo(() => myTeam.filter(s => s.species), [myTeam]);
  const result = useMemo(() => (rivals.length && team.length >= 2 ? plan(team, rivals) : null), [rivals, team]);
  const suggestions = useMemo(() => (rivals.length && !result ? suggest(rivals, ds).slice(0, 8) : []), [rivals, ds, result]);

  async function onFile(f?: File | null) {
    if (!f) return;
    setOcr({busy: true, msg: 'Preparando imagen…', p: 0});
    try {
      const {species, text} = await recognizeTeam(f, (p, msg) => setOcr(o => ({...o, p, msg})));
      if (species.length) {
        setNames(species.slice(0, 6).join(', '));
        setOcr({busy: false, msg: `Detectados ${species.length} Pokémon. Revisa la lista y corrige si falta alguno.`, p: 1, raw: text});
      } else {
        setOcr({busy: false, msg: 'No se reconoció ningún nombre. Prueba con una captura más nítida o escribe los nombres.', p: 1, raw: text});
      }
    } catch (e) {
      setOcr({busy: false, msg: `Error en el OCR: ${(e as Error).message}`, p: 0});
    }
  }

  return (
    <div className="page">
      <Card title="Equipo rival" right={<button className="btn ghost small" onClick={() => setNames(EXAMPLE)}>Ejemplo</button>}>
        <p className="muted small">Escribe los 6 Pokémon de la vista previa (separados por comas o en líneas), o sube una captura del equipo rival.</p>
        <textarea className="input textarea" rows={3} value={names} onChange={e => setNames(e.target.value)}
          placeholder="Incineroar, Rillaboom, Sneasler…" spellCheck={false} />
        <div className="row wrap gap">
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={ocr.busy}>📷 Subir captura</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => onFile(e.target.files?.[0])} />
          {ocr.busy && <div className="progress"><div style={{width: `${ocr.p * 100}%`}} /></div>}
          {ocr.msg && <span className="small muted">{ocr.msg}</span>}
        </div>
        <div
          className="dropzone small muted"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
          onPaste={e => onFile([...e.clipboardData.items].find(i => i.type.startsWith('image/'))?.getAsFile())}
          tabIndex={0}
        >
          …o arrastra / pega (Ctrl+V) la captura aquí
        </div>
        {parsed.unknown.length > 0 && <p className="warn small">No reconocidos: {parsed.unknown.join(', ')}</p>}
        {parsed.found.length > 6 && <p className="warn small">Solo se usan los 6 primeros.</p>}
        {ocr.raw && <details className="small muted"><summary>Texto leído por el OCR</summary><pre>{ocr.raw}</pre></details>}
      </Card>

      {rivals.length > 0 && result && (
        <Card title="Recomendación" className="highlight">
          <div className="plan">
            <div>
              <h4>Lead</h4>
              <div className="row gap">{result.lead.map(i => <MonChip key={i} set={team[i]} />)}</div>
            </div>
            <div>
              <h4>Atrás</h4>
              <div className="row gap">{result.back.map(i => <MonChip key={i} set={team[i]} />)}</div>
            </div>
            <div>
              <h4>Lead probable del rival</h4>
              <div className="row gap">{result.rivalLead.map(j => <MonChip key={j} set={rivals[j].set} note={`${Math.round(Math.min(1, result.leadW[j]) * 100)}%`} />)}</div>
            </div>
          </div>
          <ul className="reasons">{result.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <p className="muted small">Estimación basada en cálculos de daño con los sets más usados del rival, velocidad, roles (Fake Out, Tailwind, Trick Room, clima, Intimidación) y uso real. Úsalo como guía, no como verdad absoluta.</p>
          <MatchupTable team={team} rivals={rivals} matrix={result.matrix} bring={result.bring} />
        </Card>
      )}

      {rivals.length > 0 && !result && (
        <Card title="¿Qué Pokémon le gana a este equipo?">
          <p className="muted small">Añade tu equipo en «Mi equipo» para obtener la lead y los 4 recomendados. Mientras, estos son los Pokémon del meta (con su set más usado) que mejor se enfrentan a este equipo:</p>
          <div className="suggest-grid">
            {suggestions.map(s => (
              <div key={s.species} className="suggest">
                <div className="row gap"><Sprite name={s.species} size={48} /><div><strong>{s.species}</strong><div className="small muted">{roleTags(rolesOf(s.set)).join(' · ')}</div></div></div>
                {s.kos.length > 0 && <div className="small"><span className="good">KO:</span> {s.kos.map(k => `${k.rival} (${koLabel(k.d)} ${k.d.move})`).join(', ')}</div>}
                {s.threatenedBy.length > 0 && <div className="small"><span className="bad">Cuidado con:</span> {s.threatenedBy.map(k => `${k.rival} (${k.d.move})`).join(', ')}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {rivals.length > 0 && (
        <div className="cards-grid">
          {rivals.map(r => (
            <UsageCard key={r.input} set={r.set} usage={r.usage} forms={r.forms} compact
              onForm={f => setForms(x => ({...x, [r.input]: f}))} />
          ))}
        </div>
      )}
    </div>
  );
}

function MonChip({set, note}: {set: PokeSet; note?: string}) {
  return <div className="mon-chip"><Sprite name={set.species} size={48} /><span>{set.species}</span>{note && <span className="small muted">{note}</span>}</div>;
}

function MatchupTable({team, rivals, matrix, bring}: {team: PokeSet[]; rivals: RivalMon[]; matrix: ReturnType<typeof plan>['matrix']; bring: number[]}) {
  return (
    <div className="table-wrap">
      <table className="matrix">
        <thead>
          <tr><th>Tú ↓ / Rival →</th>{rivals.map(r => <th key={r.input}><Sprite name={r.set.species} size={40} /><div className="small">{r.set.species}</div></th>)}</tr>
        </thead>
        <tbody>
          {team.map((m, i) => (
            <tr key={i} className={bring.includes(i) ? 'brought' : ''}>
              <th><div className="row gap"><Sprite name={m.species} size={36} /><span className="small">{m.species}</span></div></th>
              {matrix[i].map((c, j) => (
                <td key={j} title={`${c.offense?.desc ?? ''}\n${c.threat?.desc ?? ''}`}>
                  <div className="cell">
                    <span className="small">⚔️ {c.offense ? <><KoBadge hits={c.offense.hits} chance={c.offense.chance} /> <span className="muted">{c.offense.move}</span></> : '—'}</span>
                    <span className="small">🛡️ {c.threat ? <><KoBadge hits={c.threat.hits} chance={c.threat.chance} /> <span className="muted">{c.threat.move}</span></> : '—'}</span>
                    <span className={`small ${c.mySpeed > c.rivalSpeed ? 'good' : c.mySpeed < c.rivalSpeed ? 'bad' : 'muted'}`}>
                      {c.mySpeed > c.rivalSpeed ? '▲ más rápido' : c.mySpeed < c.rivalSpeed ? '▼ más lento' : '= empate'} ({c.mySpeed} vs {c.rivalSpeed})
                    </span>
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">⚔️ tu mejor ataque contra él · 🛡️ su ataque más peligroso (entre los que usa ≥15%) contra ti. Filas resaltadas = los 4 recomendados.</p>
    </div>
  );
}
