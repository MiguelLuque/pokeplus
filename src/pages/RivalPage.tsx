import {useMemo, useRef, useState} from 'react';
import type {Dataset} from '../lib/data';
import {parseNameList, type PokeSet} from '../lib/sets';
import {buildRival, plan, suggest, rolesOf, roleTags, type RivalMon} from '../lib/analysis';
import {recognizeRivalTeam, type SlotGuess} from '../lib/screen';
import {UsageCard} from '../components/UsageCard';
import {Card, KoBadge, Sprite} from '../components/ui';
import {TYPE_ES} from '../lib/data';
import '../scan.css';
import {koLabel} from '../lib/damage';

const EXAMPLE = 'Incineroar, Rillaboom, Sneasler, Kingambit, Charizard, Garchomp';

export function RivalPage({ds, myTeam, names, setNames}: {
  ds: Dataset; myTeam: PokeSet[]; names: string; setNames: (s: string) => void;
}) {
  const [forms, setForms] = useState<Record<string, string>>({});
  const [scan, setScan] = useState<{busy: boolean; msg: string; slots?: SlotGuess[]; preview?: string; width?: number}>({busy: false, msg: ''});
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
    if (scan.preview) URL.revokeObjectURL(scan.preview);
    setScan({busy: true, msg: 'Analizando la captura…'});
    try {
      const res = await recognizeRivalTeam(f, ds);
      const slots = res.slots.filter(s => s.species);
      const width = res.width;
      const preview = URL.createObjectURL(f);
      if (slots.length) {
        setForms({});
        setNames(slots.map(s => s.species).join(', '));
        const dudas = slots.filter(s => s.confidence < 0.5).length;
        setScan({busy: false, slots, preview, width, msg: `Detectados ${slots.length} Pokémon del rival.` +
          (dudas ? ` Revisa ${dudas === 1 ? 'el marcado' : `los ${dudas} marcados`} con “?”.` : '')});
      } else {
        setScan({busy: false, preview, msg: 'No encuentro el equipo rival en la imagen. Sube una captura de la pantalla “Selecciona 4 Pokémon para el combate” o escribe los nombres.'});
      }
    } catch (e) {
      setScan({busy: false, msg: `No se pudo analizar la imagen: ${(e as Error).message}`});
    }
  }

  function pick(slot: number, species: string) {
    if (!scan.slots) return;
    const slots = scan.slots.map((s, i) => (i === slot ? {...s, species, confidence: 1} : s));
    setScan({...scan, slots});
    setNames(slots.map(s => s.species).join(', '));
  }

  return (
    <div className="page">
      <Card title="Equipo rival" right={<button className="btn ghost small" onClick={() => setNames(EXAMPLE)}>Ejemplo</button>}>
        <p className="muted small">Sube una captura de la pantalla de selección de equipo (“Selecciona 4 Pokémon para el combate”) y se reconocen los 6 del rival por su imagen, tipos y sexo. También puedes escribir los nombres.</p>
        <textarea className="input textarea" rows={3} value={names} onChange={e => setNames(e.target.value)}
          placeholder="Incineroar, Rillaboom, Sneasler…" spellCheck={false} />
        <div className="row wrap gap">
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={scan.busy}>📷 Subir captura</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => onFile(e.target.files?.[0])} />
          {scan.busy && <div className="spinner small" />}
          {scan.msg && <span className="small muted">{scan.msg}</span>}
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
        {scan.slots && scan.slots.length > 0 && <ScanResult slots={scan.slots} preview={scan.preview} width={scan.width} onPick={pick} />}
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

const TYPE_SHORT = (t: string) => TYPE_ES[t] ?? t;

function ScanResult({slots, preview, width, onPick}: {slots: SlotGuess[]; preview?: string; width?: number; onPick: (i: number, s: string) => void}) {
  return (
    <div className="scan">
      {slots.map((s, i) => (
        <div key={i} className={`scan-slot ${s.confidence < 0.5 ? 'doubt' : ''}`}>
          {preview && width && <SlotCrop src={preview} slot={s} width={width} />}
          <div className="scan-main">
            <div className="scan-name"><b>{s.species}</b>{s.confidence < 0.5 && <span className="warn"> ?</span>}</div>
            <div className="small muted">
              {s.reading.types.length ? s.reading.types.map(TYPE_SHORT).join(' / ') : 'tipos no leídos'}
              {s.reading.gender && ` · ${s.reading.gender === 'M' ? '♂' : '♀'}`}
            </div>
            <div className="chips">
              {s.options.filter(o => o.species !== s.species).slice(0, 3).map(o => (
                <button key={o.species} className="chip small" title="Cambiar por este" onClick={() => onPick(i, o.species)}>¿{o.species}?</button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Recorte de la tarjeta original, para comprobar a simple vista lo detectado. */
function SlotCrop({src, slot, width}: {src: string; slot: SlotGuess; width: number}) {
  // solo la zona del sprite (los tipos y el sexo ya se muestran como texto)
  const {y, h} = slot.reading.box, x = slot.reading.box.x + 0.25 * h;
  const H = 56, k = H / h, cw = Math.round(1.4 * h * k);
  return (
    <div className="scan-crop" style={{width: cw, height: H}}>
      <img src={src} alt="" style={{width, transform: `translate(${-x * k}px, ${-y * k}px) scale(${k})`}} />
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
