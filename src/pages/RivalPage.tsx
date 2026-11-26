import {useEffect, useMemo, useRef, useState} from 'react';
import {gen, toID, moveName, itemName, abilityName, TYPE_ES, TYPE_COLORS, type Dataset} from '../lib/data';
import {parseNameList, battleTeam, type PokeSet, type BattleMon} from '../lib/sets';
import {buildRival, plan, suggest, rolesOf, roleTags, type RivalMon, type Plan} from '../lib/analysis';
import {MODE_ES} from '../lib/leads';
import {recognizeTeamPreview, loadRefIndex, type SlotGuess, type OwnGuess} from '../lib/screen';
import {effectiveSpeed, koLabel} from '../lib/damage';
import {UsageCard} from '../components/UsageCard';
import {Card, KoBadge, Sprite} from '../components/ui';
import '../scan.css';

const EXAMPLE = 'Incineroar, Rillaboom, Sneasler, Kingambit, Charizard, Garchomp';

/** Tu equipo tal y como sale en la captura (especie + objeto). */
export {battleTeam, type BattleMon} from '../lib/sets';

interface ScanState {
  busy: boolean;
  msg: string;
  rival?: SlotGuess[];
  own?: OwnGuess[];
  preview?: string;
  width?: number;
}

export function RivalPage({ds, myTeam, setMyTeam, names, setNames, battleOwn, setBattleOwn}: {
  ds: Dataset; myTeam: PokeSet[]; setMyTeam: (t: PokeSet[]) => void;
  names: string; setNames: (s: string) => void;
  battleOwn: BattleMon[]; setBattleOwn: (t: BattleMon[]) => void;
}) {
  const [forms, setForms] = useState<Record<string, string>>({});
  const [scan, setScan] = useState<ScanState>({busy: false, msg: ''});
  const [open, setOpen] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // precarga las imágenes de referencia para que el análisis sea inmediato
  useEffect(() => { loadRefIndex().catch(() => { /* se reintenta al analizar */ }); }, []);

  const parsed = useMemo(() => parseNameList(names), [names]);
  const rivals: RivalMon[] = useMemo(
    () => parsed.found.slice(0, 6).map(n => buildRival(n, ds, forms[n])),
    [parsed, ds, forms]
  );
  const fromShot = battleOwn.filter(m => m.species).length >= 2;
  const team = useMemo(
    () => (fromShot ? battleTeam(battleOwn, myTeam, ds) : myTeam.filter(s => s.species)),
    [fromShot, battleOwn, myTeam, ds]
  );
  const result = useMemo(() => (rivals.length && team.length >= 2 ? plan(team, rivals, undefined, ds) : null), [rivals, team, ds]);
  const suggestions = useMemo(() => (rivals.length && !result ? suggest(rivals, ds).slice(0, 6) : []), [rivals, ds, result]);

  async function onFile(f?: File | null) {
    if (!f) return;
    if (scan.preview) URL.revokeObjectURL(scan.preview);
    setScan({busy: true, msg: 'Analizando…'});
    try {
      const res = await recognizeTeamPreview(f, ds);
      const rival = res.rival.filter(s => s.species);
      const own = res.own.filter(s => s.species);
      const preview = URL.createObjectURL(f);
      if (!rival.length && !own.length) {
        setScan({busy: false, preview, msg: 'No encuentro los equipos en la imagen. Sube una captura de la pantalla «Selecciona 4 Pokémon para el combate».'});
        return;
      }
      setForms({});
      setOpen(null);
      if (rival.length) setNames(rival.map(s => s.species).join(', '));
      if (own.length >= 2) setBattleOwn(own.map(o => ({species: o.species, item: o.item})));
      setScan({busy: false, rival, own, preview, width: res.width, msg: ''});
    } catch (e) {
      setScan({busy: false, msg: `No se pudo analizar la imagen: ${(e as Error).message}`});
    }
  }

  // pegar (Ctrl+V / Cmd+V) una captura en cualquier parte de la página
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))?.getAsFile();
      if (file) { e.preventDefault(); onFile(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  function pickRival(slot: number, species: string) {
    if (!scan.rival) return;
    const rival = scan.rival.map((s, i) => (i === slot ? {...s, species, confidence: 1} : s));
    setScan({...scan, rival});
    setNames(rival.map(s => s.species).join(', '));
  }
  function pickOwn(slot: number, patch: Partial<BattleMon>) {
    setBattleOwn(battleOwn.map((m, i) => (i === slot ? {...m, ...patch} : m)));
    if (scan.own) setScan({...scan, own: scan.own.map((s, i) => (i === slot ? {...s, ...patch,
      confidence: patch.species ? 1 : s.confidence, itemConfidence: patch.item !== undefined ? 1 : s.itemConfidence} : s))});
  }

  const doubts = (scan.rival?.filter(s => s.confidence < 0.5).length ?? 0) +
    (scan.own?.filter(s => s.confidence < 0.5 || s.itemConfidence < 0.3).length ?? 0);

  return (
    <div className="page rival-page">
      <div className="quick">
        <button className="btn big" onClick={() => fileRef.current?.click()} disabled={scan.busy}>
          {scan.busy ? <><span className="spinner small inline" /> Analizando…</> : '📷 Subir captura'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <div
          className={`drop small muted ${scan.msg ? "has-msg" : ""}`}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
        >
          {scan.msg || 'Captura de «Selecciona 4 Pokémon». También puedes arrastrarla o pegarla (Ctrl+V).'}
        </div>
      </div>

      {result && <PlanCard result={result} team={team} rivals={rivals} fromShot={fromShot} doubts={doubts} />}

      {rivals.length > 0 && !result && (
        <Card title="Añade tu equipo para saber qué 4 llevar">
          <p className="muted small">Sube la captura completa (se lee también tu columna) o guarda tu equipo en «Mi equipo». Mientras, lo que mejor le va a este rival en el meta:</p>
          <div className="suggest-grid">
            {suggestions.map(s => (
              <div key={s.species} className="suggest">
                <div className="row gap"><Sprite name={s.species} size={40} /><div><strong>{s.species}</strong><div className="small muted">{roleTags(rolesOf(s.set)).join(' · ')}</div></div></div>
                {s.kos.length > 0 && <div className="small"><span className="good">KO:</span> {s.kos.map(k => `${k.rival} (${koLabel(k.d)})`).join(', ')}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {rivals.length > 0 && (
        <section className="card tight">
          <header className="card-head"><h3>Rival</h3><span className="small muted">toca para ver su set completo</span></header>
          <div className="rival-list">
            {rivals.map((r, j) => (
              <RivalRow key={r.input} r={r} j={j} team={team} result={result} open={open === j}
                onToggle={() => setOpen(open === j ? null : j)}
                onForm={f => setForms(x => ({...x, [r.input]: f}))} />
            ))}
          </div>
        </section>
      )}

      {(scan.rival?.length || scan.own?.length) ? (
        <details className="card tight fold" open={doubts > 0}>
          <summary>
            <b>Lo que se ha leído de la captura</b>{' '}
            {doubts ? <span className="warn">· revisa {doubts === 1 ? '1 dudoso' : `${doubts} dudosos`}</span> : <span className="good">· todo claro</span>}
          </summary>
          {scan.own && scan.own.length > 0 && (
            <>
              <h4>Tu equipo</h4>
              <div className="scan">
                {scan.own.map((s, i) => <OwnSlot key={i} s={s} mon={battleOwn[i]} onPick={p => pickOwn(i, p)} />)}
              </div>
              <div className="row gap wrap" style={{marginTop: 8}}>
                <button className="btn ghost small" onClick={() => setMyTeam(battleTeam(battleOwn, myTeam, ds))}>Guardar como «Mi equipo»</button>
                <span className="small muted">Para los cálculos se usan tus sets de «Mi equipo» si coinciden; si no, el set más usado con el objeto de la captura.</span>
              </div>
            </>
          )}
          {scan.rival && scan.rival.length > 0 && (
            <>
              <h4>Rival</h4>
              <div className="scan">
                {scan.rival.map((s, i) => <RivalSlot key={i} s={s} preview={scan.preview} width={scan.width} onPick={sp => pickRival(i, sp)} />)}
              </div>
            </>
          )}
        </details>
      ) : null}

      {result && (
        <details className="card tight fold">
          <summary><b>Tabla de enfrentamientos</b> <span className="small muted">· daños y velocidad, uno contra uno</span></summary>
          <MatchupTable team={team} rivals={rivals} matrix={result.matrix} bring={result.bring} />
        </details>
      )}

      <details className="card tight fold" open={!rivals.length && !scan.rival}>
        <summary><b>Escribir los equipos a mano</b></summary>
        <label style={{marginTop: 8}}>Rival (nombres separados por comas)
          <textarea className="input textarea" rows={2} value={names} onChange={e => setNames(e.target.value)}
            placeholder="Incineroar, Rillaboom, Sneasler…" spellCheck={false} />
        </label>
        {parsed.unknown.length > 0 && <p className="warn small">No reconocidos: {parsed.unknown.join(', ')}</p>}
        <div className="row gap wrap" style={{marginTop: 6}}>
          <button className="btn ghost small" onClick={() => setNames(EXAMPLE)}>Ejemplo</button>
          {fromShot && <button className="btn ghost small" onClick={() => setBattleOwn([])}>Usar «Mi equipo» en vez de la captura</button>}
        </div>
        <p className="small muted">Tu equipo: {fromShot ? 'el de la última captura' : myTeam.length ? '«Mi equipo»' : 'sin definir (sube una captura o rellena «Mi equipo»)'}.</p>
      </details>
    </div>
  );
}

/* ---------------------------------------------------------------- plan */

function PlanCard({result, team, rivals, fromShot, doubts}: {result: Plan; team: PokeSet[]; rivals: RivalMon[]; fromShot: boolean; doubts: number}) {
  const left = team.map((_, i) => i).filter(i => !result.bring.includes(i));
  return (
    <section className="card plan-card">
      <div className="plan-grid">
        <div className="plan-col">
          <div className="plan-label">Abre con</div>
          <div className="plan-mons">{result.lead.map(i => <BigMon key={i} set={team[i]} />)}</div>
        </div>
        <div className="plan-col">
          <div className="plan-label">Atrás</div>
          <div className="plan-mons">{result.back.map(i => <BigMon key={i} set={team[i]} />)}</div>
        </div>
      </div>
      {left.length > 0 && <div className="plan-meta small muted">Se quedan: {left.map(i => team[i].species).join(', ')}</div>}
      <ul className="reasons small">{result.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      <RivalForecast result={result} rivals={rivals} />
      {doubts > 0 && <p className="small warn">Hay {doubts === 1 ? 'un Pokémon dudoso' : `${doubts} Pokémon dudosos`} en la lectura: revísalo abajo.</p>}
      {!fromShot && <p className="small muted">Con tu equipo de «Mi equipo».</p>}
    </section>
  );
}

const CONF_CLASS = {alta: 'good', media: 'warn', baja: 'bad'} as const;
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Lo que probablemente hará el rival: leads con %, Mega, atrás y quién se queda fuera. */
function RivalForecast({result, rivals}: {result: Plan; rivals: RivalMon[]}) {
  const pr = result.prediction;
  const name = (j: number) => rivals[j]?.set.species ?? '?';
  const top = pr.leadPairs.slice(0, 3);
  const mega = pr.mega[0];
  const back = pr.back[0];
  const out = rivals.map((_, j) => j).sort((a, b) => pr.bring[a] - pr.bring[b]).slice(0, Math.max(0, rivals.length - 4)).filter(j => pr.bring[j] < 0.5);
  const mode = pr.modes.primary;
  return (
    <div className="forecast">
      <div className="forecast-head">
        <span className="plan-label">Su lead probable</span>
        <span className={`small ${CONF_CLASS[pr.confidence]}`}>confianza {pr.confidence}</span>
      </div>
      <ol className="forecast-leads">
        {top.map(l => (
          <li key={l.pair.join()}>
            <b className="fc-pct">{pct(l.p)}</b>
            <span className="fc-pair">{l.pair.map(name).join(' + ')}</span>
            {l.why.length > 0 && <span className="small muted fc-why">{l.why.slice(0, 2).join(' · ')}</span>}
          </li>
        ))}
      </ol>
      <div className="forecast-meta small">
        {mode && <span>Modo: <b>{MODE_ES[mode]}</b>{pr.modes.secondary && <> · plan B {MODE_ES[pr.modes.secondary]}</>}</span>}
        {mega && mega.p >= 0.2 && <span>Mega probable: <b>{name(mega.index)}</b> {pct(mega.p)}</span>}
        {back && <span>Atrás: <b>{back.pair.map(name).join(' + ')}</b></span>}
        {out.length > 0 && <span className="muted">Probablemente fuera: {out.map(j => `${name(j)} (${pct(1 - pr.bring[j])})`).join(', ')}</span>}
      </div>
    </div>
  );
}

function BigMon({set}: {set: PokeSet}) {
  return (
    <div className="big-mon">
      <Sprite name={set.species} size={64} />
      <b>{set.species}</b>
      {set.item && <span className="small muted">{set.item}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------- rival */

const moveType = (id: string) => gen.moves.get(toID(id) as never)?.type ?? '';

function RivalRow({r, j, team, result, open, onToggle, onForm}: {
  r: RivalMon; j: number; team: PokeSet[]; result: Plan | null; open: boolean; onToggle: () => void; onForm: (f: string) => void;
}) {
  const u = r.usage;
  const isLead = !!result?.rivalLead.includes(j);
  const spe = effectiveSpeed({...r.set, item: ''});
  const scarf = u?.items.find(i => i[0] === 'choicescarf')?.[1] ?? 0;
  const items = (u?.items ?? []).filter(i => i[0] !== 'nothing').slice(0, 2);
  const ability = u?.abilities[0];
  const moves = (u?.moves ?? []).filter(m => m[0] !== 'nothing').slice(0, 4);

  // con los 4 recomendados: quién le pega más fuerte y a quién amenaza más
  let answer: {i: number; d: NonNullable<Plan['matrix'][0][0]['offense']>} | null = null;
  let danger: {i: number; d: NonNullable<Plan['matrix'][0][0]['threat']>} | null = null;
  if (result) {
    let bo = -1, bt = -1;
    for (const i of result.bring) {
      const m = result.matrix[i][j];
      if (m.offense && m.o > bo) { bo = m.o; answer = {i, d: m.offense}; }
      if (m.threat && m.t > bt) { bt = m.t; danger = {i, d: m.threat}; }
    }
    if (bo <= 0.05) answer = null;
    if (bt <= 0.05) danger = null;
  }

  return (
    <div className={`rival-row ${open ? 'open' : ''}`}>
      <button className="rival-sum" onClick={onToggle} aria-expanded={open}>
        <Sprite name={r.set.species} size={44} />
        <div className="rival-main">
          <div className="rival-top">
            <b>{r.set.species}{isLead && <span className="lead-tag">lead probable</span>}</b>
            {result && <span className="pill muted" title="Probabilidad de que lo traiga · de que abra con él">trae {pct(result.bringW[j])} · abre {pct(result.leadW[j])}</span>}
            <span className="pill" title="Velocidad con el reparto más usado">Vel {spe}{scarf >= 5 && <span className="warn"> · Scarf {scarf.toFixed(0)}%</span>}</span>
          </div>
          <div className="small muted line">
            {items.map(([id, p]) => `${itemName(id)} ${p.toFixed(0)}%`).join(' · ')}
            {ability && ` · ${abilityName(ability[0])}`}
          </div>
          <div className="moves">
            {moves.map(([id, p]) => (
              <span key={id} className="mv" style={{borderLeftColor: TYPE_COLORS[moveType(id)] ?? '#777'}} title={TYPE_ES[moveType(id)] ?? ''}>{moveName(id)} <i>{p.toFixed(0)}</i></span>
            ))}
          </div>
          {answer && <div className="small good">✓ {team[answer.i].species} le hace {koLabel(answer.d)} ({answer.d.move})</div>}
          {danger && <div className="small bad">⚠ {danger.d.move}: {koLabel(danger.d)} a tu {team[danger.i].species}</div>}
        </div>
      </button>
      {open && (
        <div className="rival-detail">
          <UsageCard set={r.set} usage={u} forms={r.forms} compact onForm={onForm} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- revisión de la lectura */

function OwnSlot({s, mon, onPick}: {s: OwnGuess; mon?: BattleMon; onPick: (p: Partial<BattleMon>) => void}) {
  const species = mon?.species ?? s.species, item = mon?.item ?? s.item;
  const doubtful = s.confidence < 0.5 || s.itemConfidence < 0.3;
  return (
    <div className={`scan-slot ${doubtful ? 'doubt' : ''}`}>
      <Sprite name={species} size={40} />
      <div className="scan-main">
        <div className="scan-name"><b>{species}</b>{s.confidence < 0.5 && <span className="warn"> ?</span>}</div>
        <input className="input small" list="items-list" value={item} placeholder="Objeto"
          onChange={e => onPick({item: e.target.value})} />
        <div className="chips">
          {s.confidence < 0.5 && s.options.filter(o => o.name !== species).slice(0, 3).map(o => (
            <button key={o.name} className="chip small" onClick={() => onPick({species: o.name})}>¿{o.name}?</button>
          ))}
          {s.itemConfidence < 0.3 && s.itemOptions.filter(o => o.name !== item).slice(0, 2).map(o => (
            <button key={o.name} className="chip small" onClick={() => onPick({item: o.name})}>¿{o.name}?</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function RivalSlot({s, preview, width, onPick}: {s: SlotGuess; preview?: string; width?: number; onPick: (sp: string) => void}) {
  return (
    <div className={`scan-slot ${s.confidence < 0.5 ? 'doubt' : ''}`}>
      {preview && width && <SlotCrop src={preview} slot={s} width={width} />}
      <div className="scan-main">
        <div className="scan-name"><b>{s.species}</b>{s.confidence < 0.5 && <span className="warn"> ?</span>}</div>
        <div className="small muted">
          {s.reading.types.length ? s.reading.types.map(t => TYPE_ES[t] ?? t).join(' / ') : 'tipos no leídos'}
          {s.reading.gender && ` · ${s.reading.gender === 'M' ? '♂' : '♀'}`}
        </div>
        <div className="chips">
          {s.options.filter(o => o.name !== s.species).slice(0, s.confidence < 0.5 ? 3 : 2).map(o => (
            <button key={o.name} className="chip small" title="Cambiar por este" onClick={() => onPick(o.name)}>¿{o.name}?</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Recorte de la tarjeta original, para comprobar a simple vista lo detectado. */
function SlotCrop({src, slot, width}: {src: string; slot: SlotGuess; width: number}) {
  const {y, h} = slot.reading.box, x = slot.reading.box.x + 0.45 * h;
  const H = 48, k = H / h, cw = Math.round(1.1 * h * k);
  return (
    <div className="scan-crop" style={{width: cw, height: H}}>
      <img src={src} alt="" style={{width, transform: `translate(${-x * k}px, ${-y * k}px) scale(${k})`}} />
    </div>
  );
}

/* ---------------------------------------------------------------- tabla */

function MatchupTable({team, rivals, matrix, bring}: {team: PokeSet[]; rivals: RivalMon[]; matrix: Plan['matrix']; bring: number[]}) {
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
