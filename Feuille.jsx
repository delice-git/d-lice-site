import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { addDaysISO, fmtTime, isoDate, num, toNumber } from './format'
import { Empty, ErrorBox, Loading, Modal, PageHeader, Seg } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'

const FIELDS = [
  ['jete', 'Jeté', 'Jeté / invendus jetés'],
  ['reste', 'Reste', 'Reste en magasin'],
  ['com', 'Com.', 'Commandes clients'],
  ['prod', 'Prod.', 'À produire / à livrer'],
]
const keyOf = (lineId, size) => lineId + '|' + size
const COMPANY = 'LTDD sprl 0698.967.746'
const EMPTY = { jete: null, reste: null, com: null, prod: null, fini: false, checked: false }
const isOff = (line, size) => (line.off_sizes || []).includes(size)
const hasData = r => r && (FIELDS.some(([f]) => r[f] !== null && r[f] !== undefined) || r.fini || r.checked)
const fmt = v => (v === null || v === undefined || v === '' ? '' : num(v))

function useNarrow() {
  const query = '(max-width: 860px)'
  const [n, setN] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const h = e => setN(e.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])
  return n
}

async function loadLayout() {
  const [sections, lines] = await Promise.all([
    q(supabase.from('sheet_sections').select('*').order('position').order('name')),
    q(supabase.from('sheet_lines').select('*').eq('active', true).order('position').order('name')),
  ])
  return sections.map(s => ({ ...s, lines: lines.filter(l => l.section_id === s.id) }))
}

// Initiale unique pour chaque magasin (B = Ben-Ahin, T = Tihange)
function shortNames(shops) {
  const out = {}
  for (const s of shops) {
    let len = 1
    let k = s.name.slice(0, len)
    while (shops.some(o => o.id !== s.id && o.name.slice(0, len) === k) && len < s.name.length) k = s.name.slice(0, ++len)
    out[s.id] = k
  }
  return out
}

export default function Feuille({ profile, shops, isStaff }) {
  const [day, setDay] = useState(() => addDaysISO(1))
  const [view, setView] = useState(isStaff ? 'total' : profile.shop_id)
  const [editing, setEditing] = useState(false)
  const layout = useData(loadLayout, [])

  const d = new Date(day + 'T12:00:00')
  const dayLabel = d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })
  const shift = n => { const x = new Date(day + 'T12:00:00'); x.setDate(x.getDate() + n); setDay(isoDate(x)) }

  if (layout.loading && !layout.data) return <Loading />

  return (
    <>
      <PageHeader title="Feuille du jour"
        subtitle={isStaff ? 'Ce que les magasins ont rempli : total des deux magasins et détail par magasin.' : 'Remplissez les chiffres : tout est enregistré automatiquement.'}>
        <button className="only-desktop" onClick={() => window.print()}><Icon name="print" size={20} />Imprimer</button>
        {isStaff && <button onClick={() => setEditing(true)}>Modifier la liste</button>}
      </PageHeader>
      <ErrorBox error={layout.error} />

      <div className="sheet-bar no-print">
        <div className="day-pick">
          <button className="icon" onClick={() => shift(-1)} aria-label="Jour précédent"><Icon name="back" /></button>
          <label>
            <span className="day-name">{dayLabel}</span>
            <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} aria-label="Date de la feuille" />
          </label>
          <button className="icon" onClick={() => shift(1)} aria-label="Jour suivant"><Icon name="chevron" /></button>
        </div>
        {isStaff && (
          <Seg value={view} onChange={setView} options={[['total', 'Total'], ...shops.map(s => [s.id, s.name])]} />
        )}
      </div>
      <div className="only-print print-head">
        <b>Bon de livraison {COMPANY}</b>
        <span>Pour : <b>{view === 'total' ? 'total des magasins' : shops.find(s => s.id === view)?.name}</b></span>
        <span>Date : <b>{d.toLocaleDateString('fr-BE', { weekday: 'short' }).slice(0, 1).toUpperCase()} {d.getDate()}/{d.getMonth() + 1}</b></span>
      </div>

      {!layout.data?.length ? <Empty>La feuille est vide. {isStaff ? 'Ajoutez des lignes avec « Modifier la liste ».' : ''}</Empty>
        : view === 'total'
          ? <TotalSheet key={day} day={day} layout={layout.data} shops={shops} />
          : <ShopSheet key={view + day} day={day} shopId={view} layout={layout.data} isStaff={isStaff}
              shopName={shops.find(s => s.id === view)?.name} />}

      {editing && <SheetEditor layout={layout.data} onClose={() => setEditing(false)} reload={layout.reload} />}
    </>
  )
}

// ======================= Saisie d'un magasin =======================
function ShopSheet({ day, shopId, layout, isStaff, shopName }) {
  // La production consulte la feuille d'un magasin sans la modifier, avec le total en vert dans Prod.
  const readOnly = isStaff
  const [lineOpen, setLineOpen] = useState(null)
  const [prodTotals, setProdTotals] = useState({})
  const [tick, setTick] = useState(0)
  const narrow = useNarrow()
  const [sizeSel, setSizeSel] = useState({})
  const [entries, setEntries] = useState(null)
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(0)
  const [lastSaved, setLastSaved] = useState(null)
  const [error, setError] = useState(null)
  const ref = useRef({})

  useEffect(() => {
    let alive = true
    let rowsReq = supabase.from('sheet_entries').select('*').eq('day', day)
    if (!readOnly) rowsReq = rowsReq.eq('shop_id', shopId)
    Promise.all([
      q(rowsReq),
      q(supabase.from('sheet_notes').select('*').eq('shop_id', shopId).eq('day', day).maybeSingle()),
    ]).then(([rows, n]) => {
      if (!alive) return
      const map = {}, tot = {}
      for (const r of rows) {
        const k = keyOf(r.line_id, r.size)
        if (r.shop_id === shopId) map[k] = r
        if (r.prod !== null && r.prod !== undefined) tot[k] = (tot[k] || 0) + Number(r.prod)
      }
      ref.current = map; setEntries(map); setProdTotals(tot); setNotes(n?.notes || '')
    }).catch(e => setError(e.message))
    return () => { alive = false }
  }, [shopId, day, readOnly, tick])

  // en lecture seule, les chiffres des magasins arrivent en direct
  useEffect(() => {
    if (!readOnly) return
    const ch = supabase.channel('sheet-shop-' + Math.random())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sheet_entries' }, () => setTick(t => t + 1))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [readOnly])

  const save = useCallback(async (lineId, size, patch) => {
    const k = keyOf(lineId, size)
    const cur = ref.current[k] || EMPTY
    const row = { ...EMPTY, ...cur, ...patch }
    ref.current = { ...ref.current, [k]: row }
    setEntries(ref.current)
    setPending(p => p + 1)
    try {
      await q(supabase.from('sheet_entries').upsert(
        { shop_id: shopId, day, line_id: lineId, size, jete: row.jete, reste: row.reste, com: row.com, prod: row.prod, fini: row.fini, checked: row.checked },
        { onConflict: 'shop_id,day,line_id,size' }))
      setLastSaved(new Date().toISOString()); setError(null)
    } catch (e) { setError('Non enregistré : ' + e.message); notify('Un chiffre n’a pas été enregistré. Vérifiez la connexion.', 'error') }
    finally { setPending(p => p - 1) }
  }, [shopId, day])

  async function saveNotes(text) {
    setPending(p => p + 1)
    try {
      await q(supabase.from('sheet_notes').upsert({ shop_id: shopId, day, notes: text }, { onConflict: 'shop_id,day' }))
      setLastSaved(new Date().toISOString())
    } catch (e) { notify(e.message, 'error') } finally { setPending(p => p - 1) }
  }

  // Entrée = case du dessous (même colonne)
  function next(el) {
    const all = [...document.querySelectorAll(`input.sc[data-col="${el.dataset.col}"]`)]
    const i = all.indexOf(el)
    if (all[i + 1]) { all[i + 1].focus(); all[i + 1].scrollIntoView({ block: 'nearest' }) } else el.blur()
  }

  if (!entries) return error ? <ErrorBox error={error} /> : <Loading />
  const filled = Object.values(entries).filter(hasData).length

  return (
    <>
      {readOnly ? (
        <div className="ro-info no-print">
          <b>Lecture seule</b> — feuille remplie par {shopName}. Dans <b className="ko">Prod.</b>, le chiffre du magasin et, en <b className="tot-c">vert</b>, le total des magasins.
        </div>
      ) : <div className={'save-state' + (error ? ' err' : '')} role="status">
        {error ? error : pending ? 'Enregistrement…' : lastSaved ? `Tout est enregistré · ${fmtTime(lastSaved)}` : filled ? `${filled} ligne${filled > 1 ? 's' : ''} remplie${filled > 1 ? 's' : ''}` : 'Feuille vierge : touchez une case pour commencer'}
      </div>}
      {layout.map(sec => {
        const sizes = sec.sizes?.length ? sec.sizes : ['']
        const shown = narrow && sizes.length > 1 ? [sizeSel[sec.id] || sizes[0]] : sizes
        return (
          <section key={sec.id} className="sheet-sec">
            <div className="sheet-sec-head">
              <h2>{sec.name}</h2>
              {narrow && sizes.length > 1 && (
                <Seg value={shown[0]} onChange={v => setSizeSel(s => ({ ...s, [sec.id]: v }))} options={sizes.map(z => [z, z])} />
              )}
            </div>
            <div className="sheet-wrap">
              <table className="sheet">
                <thead>
                  {shown.length > 1 || shown[0] ? (
                    <tr className="grp-row">
                      <th className="nm" rowSpan={2}></th>
                      {shown.map(z => <th key={z} colSpan={4} className="grp">{z}</th>)}
                    </tr>
                  ) : null}
                  <tr>
                    {!(shown.length > 1 || shown[0]) && <th className="nm"></th>}
                    {shown.map(z => FIELDS.map(([f, label, title], i) => (
                      <th key={z + f} className={'fh f-' + f + (i === 0 ? ' gs' : '')} title={title}>{label}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {sec.lines.map(l => {
                    const rows = sizes.map(z => entries[keyOf(l.id, z)]).filter(Boolean)
                    return (
                      <tr key={l.id}>
                        <th scope="row" className="nm">
                          <button className="nm-btn" onClick={() => setLineOpen({ line: l, sizes })} title="Fini, préparé…">
                            {l.name}
                            {rows.some(r => r.checked) && <span className="mk ok" title="Préparé">✓</span>}
                          </button>
                        </th>
                        {shown.map(z => isOff(l, z)
                          ? <td key={z} colSpan={4} className="off gs" title={`Pas en ${z}`} />
                          : FIELDS.map(([f], i) => {
                            const e = entries[keyOf(l.id, z)]
                            return (
                              <td key={z + f} className={'f-' + f + (i === 0 ? ' gs' : '') + (readOnly ? ' ro' : '')}>
                                {readOnly ? (
                                  <>
                                    {f === 'reste' && e?.fini && (e?.reste === null || e?.reste === undefined)
                                      ? <span className="ro-v fini-txt">fini</span>
                                      : <span className={'ro-v' + (f === 'com' && e?.com ? ' circled' : '')}>{fmt(e?.[f])}</span>}
                                    {f === 'prod' && prodTotals[keyOf(l.id, z)] !== undefined && (
                                      <small className="tot" title="Total des magasins">{fmt(prodTotals[keyOf(l.id, z)])}</small>
                                    )}
                                  </>
                                ) : (
                                  <Cell value={e?.[f]} col={sec.id + z + f} label={`${l.name} ${z} ${f}`}
                                    fini={f === 'reste' && e?.fini}
                                    onSave={v => save(l.id, z, { [f]: v })} onEnter={next} />
                                )}
                              </td>
                            )
                          }))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
      {lineOpen && (
        <LineSheet line={lineOpen.line} sizes={lineOpen.sizes} entries={entries} isStaff={isStaff}
          onChange={(z, patch) => save(lineOpen.line.id, z, patch)} onClose={() => setLineOpen(null)} />
      )}
      <p className="muted small-text no-print" style={{ margin: '-8px 0 14px' }}>
        {readOnly ? <>Touchez le nom d’un produit pour le cocher ✓ préparé.</> : <>Touchez le nom d’un produit pour le marquer <b className="ko">fini</b> (épuisé).</>}
      </p>
      <section className="sheet-sec">
        <div className="sheet-sec-head"><h2>Remarques</h2></div>
        {readOnly
          ? <div className="note-card"><p className={notes ? '' : 'muted'}>{notes || 'Aucune remarque.'}</p></div>
          : <textarea className="sheet-notes" value={notes} onChange={e => setNotes(e.target.value)} onBlur={e => saveNotes(e.target.value)}
              placeholder="Ex. : Tourisme 38 baisers, 38 MB · Château 15 croissants, 10 p. choco…" rows={4} />}
      </section>
    </>
  )
}

function Cell({ value, onSave, onEnter, col, label, fini }) {
  const norm = v => (v === null || v === undefined ? '' : String(Number(v)))
  const [v, setV] = useState(norm(value))
  useEffect(() => { setV(norm(value)) }, [value])
  return (
    <input className={'sc' + (v !== '' ? ' has' : '') + (fini ? ' fini' : '')} inputMode="decimal" value={v} data-col={col} aria-label={label}
      placeholder={fini ? 'fini' : ''}
      onChange={e => setV(e.target.value.replace(/[^0-9.,]/g, ''))}
      onFocus={e => e.target.select()}
      onBlur={() => {
        const n = v.trim() === '' ? null : toNumber(v)
        const old = value === null || value === undefined ? null : Number(value)
        if (n !== old) onSave(n)
      }}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(e.currentTarget) } }} />
  )
}

// Fenêtre d'une ligne : « fini » (magasin) et ✓ préparé (production), par taille
function LineSheet({ line, sizes, entries, isStaff, onChange, onClose }) {
  const avail = sizes.filter(z => !isOff(line, z))
  return (
    <Modal title={line.name} onClose={onClose}>
      <div className="stack">
        {avail.map(z => {
          const e = entries[keyOf(line.id, z)] || EMPTY
          return (
            <div key={z} className="line-flags">
              {z && <b className="lf-size">{z}</b>}
              {isStaff
                ? e.fini && <span className="mk ko">fini (épuisé)</span>
                : <button type="button" className={'flag' + (e.fini ? ' on-fini' : '')} aria-pressed={e.fini} onClick={() => onChange(z, { fini: !e.fini })}>
                    {e.fini ? '✓ ' : ''}Fini (épuisé)
                  </button>}
              {isStaff
                ? <button type="button" className={'flag' + (e.checked ? ' on-ok' : '')} aria-pressed={e.checked} onClick={() => onChange(z, { checked: !e.checked })}>
                    {e.checked ? '✓ Préparé' : 'Marquer préparé'}
                  </button>
                : e.checked && <span className="ok">✓ Préparé par la production</span>}
            </div>
          )
        })}
        {sizes.some(z => isOff(line, z)) && <p className="muted small-text">Pas disponible en {sizes.filter(z => isOff(line, z)).join(', ')}.</p>}
        <div className="row end"><button className="primary" onClick={onClose}>Terminé</button></div>
      </div>
    </Modal>
  )
}

// ======================= Total des magasins (production) =======================
function TotalSheet({ day, layout, shops }) {
  const narrow = useNarrow()
  const [sizeSel, setSizeSel] = useState({})
  const [hideEmpty, setHideEmpty] = useState(true)
  const short = useMemo(() => shortNames(shops), [shops])

  const data = useData(async () => {
    const [rows, notes] = await Promise.all([
      q(supabase.from('sheet_entries').select('*').eq('day', day)),
      q(supabase.from('sheet_notes').select('*').eq('day', day)),
    ])
    return { rows, notes }
  }, [day])

  const reload = data.reload
  useEffect(() => {
    const ch = supabase.channel('sheet-live-' + Math.random())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sheet_entries' }, () => reload())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [reload])

  const { cells, status, flags } = useMemo(() => {
    const cells = {}, status = {}, flags = {}
    for (const r of data.data?.rows || []) {
      const k = keyOf(r.line_id, r.size)
      if (r.fini || r.checked) {
        const fl = (flags[r.line_id] ||= { fini: {}, checked: {} })
        if (r.fini) (fl.fini[r.shop_id] ||= []).push(r.size)
        if (r.checked) fl.checked[r.shop_id] = true
      }
      const c = (cells[k] ||= {})
      for (const [f] of FIELDS) {
        if (r[f] === null || r[f] === undefined) continue
        const t = (c[f] ||= { total: 0, by: {} })
        t.total += Number(r[f]); t.by[r.shop_id] = (t.by[r.shop_id] || 0) + Number(r[f])
      }
      const st = (status[r.shop_id] ||= { lines: 0, last: null })
      if (hasData(r)) st.lines++
      if (!st.last || r.updated_at > st.last) st.last = r.updated_at
    }
    return { cells, status, flags }
  }, [data.data])

  if (data.loading && !data.data) return <Loading />
  const notes = (data.data?.notes || []).filter(n => n.notes?.trim())

  return (
    <>
      <ErrorBox error={data.error} />
      <div className="shop-status">
        {shops.map(s => (
          <div key={s.id} className={'st-card' + (status[s.id] ? ' ok' : '')}>
            <b>{s.name}</b>
            <span>{status[s.id] ? `${status[s.id].lines} ligne${status[s.id].lines > 1 ? 's' : ''} · modifiée à ${fmtTime(status[s.id].last)}` : 'Pas encore remplie'}</span>
          </div>
        ))}
        <label className="check small-text no-print"><input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} />Masquer les lignes vides</label>
      </div>
      <p className="muted small-text" style={{ margin: '0 0 12px' }}>
        Gros chiffre = total. En dessous, le détail : {shops.map((s, i) => <span key={s.id}>{i ? ', ' : ''}<b>{short[s.id]}</b> = {s.name}</span>)}.
      </p>

      {layout.map(sec => {
        const sizes = sec.sizes?.length ? sec.sizes : ['']
        const shown = narrow && sizes.length > 1 ? [sizeSel[sec.id] || sizes[0]] : sizes
        const lines = hideEmpty ? sec.lines.filter(l => sizes.some(z => cells[keyOf(l.id, z)]) || flags[l.id]) : sec.lines
        if (!lines.length) return null
        return (
          <section key={sec.id} className="sheet-sec">
            <div className="sheet-sec-head">
              <h2>{sec.name}</h2>
              {narrow && sizes.length > 1 && (
                <Seg value={shown[0]} onChange={v => setSizeSel(s => ({ ...s, [sec.id]: v }))} options={sizes.map(z => [z, z])} />
              )}
            </div>
            <div className="sheet-wrap">
              <table className="sheet total">
                <thead>
                  {shown[0] || shown.length > 1 ? (
                    <tr className="grp-row"><th className="nm" rowSpan={2}></th>{shown.map(z => <th key={z} colSpan={4} className="grp">{z}</th>)}</tr>
                  ) : null}
                  <tr>
                    {!(shown[0] || shown.length > 1) && <th className="nm"></th>}
                    {shown.map(z => FIELDS.map(([f, label, title], i) => <th key={z + f} className={'fh f-' + f + (i === 0 ? ' gs' : '')} title={title}>{label}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id}>
                      <th scope="row" className="nm">
                        {l.name}
                        {flags[l.id] && (
                          <span className="flags">
                            {Object.keys(flags[l.id].checked).map(id => <span key={'c' + id} className="mk ok">✓ {short[id]}</span>)}
                            {Object.entries(flags[l.id].fini).map(([id, zs]) => (
                              <span key={'f' + id} className="mk ko">fini {short[id]}{zs.filter(Boolean).length ? ` (${zs.filter(Boolean).join(', ')})` : ''}</span>
                            ))}
                          </span>
                        )}
                      </th>
                      {shown.map(z => isOff(l, z) ? <td key={z} colSpan={4} className="off gs" /> : FIELDS.map(([f], i) => {
                        const c = cells[keyOf(l.id, z)]?.[f]
                        return (
                          <td key={z + f} className={'tc f-' + f + (i === 0 ? ' gs' : '')}>
                            {c && (
                              <>
                                <b className={f === 'com' ? 'circled' : ''}>{fmt(c.total)}</b>
                                {shops.length > 1 && (
                                  <small>{shops.filter(s => c.by[s.id] !== undefined).map(s => `${short[s.id]} ${fmt(c.by[s.id])}`).join(' · ')}</small>
                                )}
                              </>
                            )}
                          </td>
                        )
                      }))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      {notes.length > 0 && (
        <section className="sheet-sec">
          <div className="sheet-sec-head"><h2>Remarques des magasins</h2></div>
          {notes.map(n => (
            <div key={n.shop_id} className="note-card">
              <b>{shops.find(s => s.id === n.shop_id)?.name}</b>
              <p>{n.notes}</p>
            </div>
          ))}
        </section>
      )}
      {hideEmpty && !layout.some(sec => sec.lines.some(l => (sec.sizes?.length ? sec.sizes : ['']).some(z => cells[keyOf(l.id, z)]))) && (
        <Empty>Aucun magasin n’a encore rempli la feuille de ce jour.</Empty>
      )}
    </>
  )
}

// ======================= Modifier la liste (production) =======================
function SheetEditor({ layout, onClose, reload }) {
  const [newSec, setNewSec] = useState('')
  const [adding, setAdding] = useState({})
  const run = async (req, msg) => {
    try { await q(req); if (msg) notify(msg); reload() } catch (e) { notify(e.message, 'error') }
  }
  const sizesText = s => (s.sizes || []).join(', ')
  const parseSizes = t => t.split(',').map(x => x.trim()).filter(Boolean)

  async function move(sec, idx, dir) {
    const a = sec.lines[idx], b = sec.lines[idx + dir]
    if (!b) return
    try {
      await q(supabase.from('sheet_lines').update({ position: idx + dir }).eq('id', a.id))
      await q(supabase.from('sheet_lines').update({ position: idx }).eq('id', b.id))
      // remet des positions propres sur toute la rubrique
      await Promise.all(sec.lines.map((l, i) => (l.id === a.id || l.id === b.id ? null
        : supabase.from('sheet_lines').update({ position: i }).eq('id', l.id))).filter(Boolean))
      reload()
    } catch (e) { notify(e.message, 'error') }
  }

  return (
    <Modal title="Modifier la liste de la feuille" onClose={onClose} wide>
      <div className="stack">
        <p className="muted small-text">Les changements sont enregistrés tout de suite et valent pour les deux magasins. Retirer une ligne ne supprime pas les chiffres déjà saisis les jours précédents. Pour les tartes, touchez une taille barrée/non barrée pour indiquer qu’un produit n’existe pas dans cette taille.</p>
        {layout.map(sec => (
          <div key={sec.id} className="panel stack" style={{ gap: 10, background: 'var(--surface-2)' }}>
            <div className="grid-2">
              <label className="field"><span>Rubrique</span>
                <input defaultValue={sec.name} onBlur={e => e.target.value.trim() && e.target.value !== sec.name && run(supabase.from('sheet_sections').update({ name: e.target.value.trim() }).eq('id', sec.id), 'Rubrique renommée')} />
              </label>
              <label className="field"><span>Tailles (séparées par des virgules, vide = une seule colonne)</span>
                <input defaultValue={sizesText(sec)} placeholder="Ex. : 23cm, 19cm, 17cm, Roues"
                  onBlur={e => e.target.value !== sizesText(sec) && run(supabase.from('sheet_sections').update({ sizes: parseSizes(e.target.value) }).eq('id', sec.id), 'Tailles enregistrées')} />
              </label>
            </div>
            <div className="edit-lines">
              {sec.lines.map((l, i) => (
                <div key={l.id} className="edit-line">
                  <input defaultValue={l.name} aria-label="Nom de la ligne"
                    onBlur={e => e.target.value.trim() && e.target.value !== l.name && run(supabase.from('sheet_lines').update({ name: e.target.value.trim() }).eq('id', l.id))} />
                  {(sec.sizes || []).length > 1 && (
                    <span className="off-pick" title="Touchez une taille pour la rendre indisponible (pointillés)">
                      {sec.sizes.map(z => {
                        const off = (l.off_sizes || []).includes(z)
                        return <button key={z} type="button" className={off ? 'is-off' : ''} aria-pressed={!off}
                          onClick={() => run(supabase.from('sheet_lines').update({ off_sizes: off ? l.off_sizes.filter(x => x !== z) : [...(l.off_sizes || []), z] }).eq('id', l.id))}>{z}</button>
                      })}
                    </span>
                  )}
                  <button className="ghost icon" disabled={i === 0} onClick={() => move(sec, i, -1)} aria-label="Monter">↑</button>
                  <button className="ghost icon" disabled={i === sec.lines.length - 1} onClick={() => move(sec, i, 1)} aria-label="Descendre">↓</button>
                  <button className="ghost icon" onClick={() => confirm(`Retirer « ${l.name} » de la feuille ?`) && run(supabase.from('sheet_lines').update({ active: false }).eq('id', l.id), 'Ligne retirée')} aria-label="Retirer"><Icon name="close" size={18} /></button>
                </div>
              ))}
            </div>
            <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={e => {
              e.preventDefault()
              const name = (adding[sec.id] || '').trim(); if (!name) return
              run(supabase.from('sheet_lines').insert({ section_id: sec.id, name, position: sec.lines.length + 1 }), 'Ligne ajoutée')
              setAdding(a => ({ ...a, [sec.id]: '' }))
            }}>
              <input placeholder={`Nouvelle ligne dans « ${sec.name} »`} value={adding[sec.id] || ''} onChange={e => setAdding(a => ({ ...a, [sec.id]: e.target.value }))} />
              <button>Ajouter</button>
            </form>
          </div>
        ))}
        <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={e => {
          e.preventDefault(); if (!newSec.trim()) return
          run(supabase.from('sheet_sections').insert({ name: newSec.trim(), position: layout.length + 1 }), 'Rubrique ajoutée'); setNewSec('')
        }}>
          <input placeholder="Nouvelle rubrique (ex. : Snacking)" value={newSec} onChange={e => setNewSec(e.target.value)} />
          <button className="primary">Ajouter la rubrique</button>
        </form>
      </div>
    </Modal>
  )
}
