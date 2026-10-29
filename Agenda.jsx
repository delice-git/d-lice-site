import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { fmtTime, isoDate, num, todayISO } from './format'
import { ErrorBox, Field, KindBadge, Loading, Modal, PageHeader, StatusBadge } from './ui'
import { notify } from './Toast'

const COLORS = ['#1f4a43', '#2f5f8a', '#b03e2c', '#c98a1b', '#6b3a7d', '#55625f']
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function gridStart(monthDate) {
  const d = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const shift = (d.getDay() + 6) % 7 // lundi = 0
  d.setDate(d.getDate() - shift)
  return d
}

export default function Agenda({ goTo }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [selected, setSelected] = useState(todayISO())
  const [editing, setEditing] = useState(null)

  const days = useMemo(() => {
    const start = gridStart(cursor)
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  }, [cursor])
  const from = isoDate(days[0]), to = isoDate(days[41])

  const data = useData(async () => {
    const startTs = new Date(from + 'T00:00:00').toISOString()
    const endTs = new Date(to + 'T23:59:59').toISOString()
    const [events, orders] = await Promise.all([
      q(supabase.from('events').select('*').gte('starts_at', startTs).lte('starts_at', endTs).order('starts_at')),
      q(supabase.from('orders').select('id, kind, status, due_date, customer_name, shops(name), order_items(quantity)')
        .gte('due_date', from).lte('due_date', to).neq('status', 'annulee').order('id')),
    ])
    return { events, orders }
  }, [from, to])

  const byDay = useMemo(() => {
    const m = {}
    for (const e of data.data?.events || []) (m[isoDate(new Date(e.starts_at))] ||= { events: [], orders: [] }).events.push(e)
    for (const o of data.data?.orders || []) (m[o.due_date] ||= { events: [], orders: [] }).orders.push(o)
    return m
  }, [data.data])

  const move = n => setCursor(c => new Date(c.getFullYear(), c.getMonth() + n, 1))
  const monthLabel = cursor.toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' })
  const today = todayISO()
  const sel = byDay[selected] || { events: [], orders: [] }
  const selLabel = new Date(selected + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })

  async function remove(ev) {
    if (!confirm(`Supprimer « ${ev.title} » ?`)) return
    try { await q(supabase.from('events').delete().eq('id', ev.id)); notify('Événement supprimé'); data.reload() }
    catch (e) { notify(e.message, 'error') }
  }

  return (
    <>
      <PageHeader title="Agenda" subtitle="Planning de l’atelier et livraisons prévues aux magasins.">
        <button className="primary" onClick={() => setEditing({ date: selected })}>Ajouter un événement</button>
      </PageHeader>
      <ErrorBox error={data.error} />
      <div className="agenda">
        <div className="cal">
          <div className="cal-nav">
            <button className="small" onClick={() => move(-1)} aria-label="Mois précédent">‹</button>
            <h2>{monthLabel}</h2>
            <button className="small" onClick={() => move(1)} aria-label="Mois suivant">›</button>
                        <button className="small" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(today) }}>Aujourd’hui</button>
          </div>
          <div className="cal-head">{WEEKDAYS.map(d => <div key={d}>{d}</div>)}</div>
          {data.loading && !data.data ? <Loading /> : (
            <div className="cal-grid">
              {days.map(d => {
                const iso = isoDate(d)
                const entry = byDay[iso]
                const other = d.getMonth() !== cursor.getMonth()
                const n = (entry?.events.length || 0) + (entry?.orders.length || 0)
                return (
                  <button key={iso} onClick={() => setSelected(iso)}
                    className={'cal-day' + (other ? ' other' : '') + (iso === today ? ' today' : '') + (iso === selected ? ' selected' : '') + (n ? ' has' : '')}
                    aria-label={`${d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' })}${n ? `, ${n} élément${n > 1 ? 's' : ''}` : ''}`}>
                    <span className="d">{d.getDate()}</span>
                    {entry?.events.slice(0, 2).map(e => <span key={e.id} className="ev-chip" style={{ background: e.color }}>{e.all_day ? '' : fmtTime(e.starts_at) + ' '}{e.title}</span>)}
                    {entry?.orders.length > 0 && <span className="ev-chip order-chip">{entry.orders.length} à livrer</span>}
                    {n > 0 && <span className="dots">{Array.from({ length: Math.min(n, 3) }, (_, k) => <i key={k} />)}</span>}
                    {entry?.events.length > 2 && <span className="muted small-text">+{entry.events.length - 2}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="panel day-panel">
          <h2 style={{ textTransform: 'capitalize', marginBottom: 14 }}>{selLabel}</h2>
          {!sel.events.length && !sel.orders.length && <p className="muted" style={{ marginBottom: 12 }}>Rien de prévu ce jour-là.</p>}
          {sel.events.map(e => (
            <div key={e.id} className="entry" style={{ borderLeftColor: e.color }}>
              <div>
                <b>{e.title}</b>
                <div className="muted small-text">{e.all_day ? 'Toute la journée' : fmtTime(e.starts_at) + (e.ends_at ? ' – ' + fmtTime(e.ends_at) : '')}</div>
                {e.notes && <div className="small-text" style={{ marginTop: 4 }}>{e.notes}</div>}
              </div>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                <button className="small ghost" onClick={() => setEditing(e)}>Modifier</button>
                <button className="small ghost" onClick={() => remove(e)} aria-label="Supprimer">×</button>
              </div>
            </div>
          ))}
          {sel.orders.length > 0 && <h3 style={{ margin: '16px 0 8px' }}>Commandes à livrer</h3>}
          {sel.orders.map(o => (
            <div key={o.id} className="entry" style={{ borderLeftColor: 'var(--gold)' }}>
              <div>
                <b>n°{o.id} · {o.shops?.name}</b>
                <div className="muted small-text">{o.customer_name || 'Réassort'} · {num(o.order_items.reduce((s, i) => s + Number(i.quantity), 0))} pièces</div>
                <div className="row" style={{ gap: 4, marginTop: 4 }}><KindBadge kind={o.kind} /><StatusBadge status={o.status} /></div>
              </div>
            </div>
          ))}
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => setEditing({ date: selected })}>Ajouter ce jour</button>
            {sel.orders.length > 0 && <button className="ghost" onClick={() => goTo('orders')}>Voir les commandes</button>}
          </div>
        </div>
      </div>

      {editing && <EventForm ev={editing} onClose={() => setEditing(null)} onSaved={iso => { setEditing(null); setSelected(iso); data.reload() }} />}
    </>
  )
}

function EventForm({ ev, onClose, onSaved }) {
  const isNew = !ev.id
  const start = ev.starts_at ? new Date(ev.starts_at) : null
  const end = ev.ends_at ? new Date(ev.ends_at) : null
  const hm = d => d ? d.toTimeString().slice(0, 5) : ''
  const [f, setF] = useState({
    title: ev.title || '', date: start ? isoDate(start) : ev.date, all_day: ev.all_day ?? false,
    start: start ? hm(start) : '06:00', end: end ? hm(end) : '', color: ev.color || COLORS[0], notes: ev.notes || '',
  })
  const [error, setError] = useState(null)
  const set = p => setF(x => ({ ...x, ...p }))

  async function submit(e) {
    e.preventDefault()
    if (!f.title.trim()) return setError('Donnez un titre à l’événement.')
    if (!f.all_day && f.end && f.end <= f.start) return setError('L’heure de fin doit être après l’heure de début.')
    const payload = {
      title: f.title.trim(), all_day: f.all_day, color: f.color, notes: f.notes.trim() || null,
      starts_at: new Date(`${f.date}T${f.all_day ? '00:00' : f.start}:00`).toISOString(),
      ends_at: !f.all_day && f.end ? new Date(`${f.date}T${f.end}:00`).toISOString() : null,
    }
    try {
      await q(isNew ? supabase.from('events').insert(payload) : supabase.from('events').update(payload).eq('id', ev.id))
      notify(isNew ? 'Événement ajouté' : 'Événement modifié'); onSaved(f.date)
    } catch (err) { setError(err.message) }
  }

  return (
    <Modal title={isNew ? 'Nouvel événement' : 'Modifier l’événement'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Titre"><input autoFocus value={f.title} onChange={e => set({ title: e.target.value })} placeholder="Ex. : Livraison farine, nettoyage du four…" /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={e => set({ date: e.target.value })} required /></Field>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.all_day} onChange={e => set({ all_day: e.target.checked })} /> Toute la journée</label>
        {!f.all_day && (
          <div className="grid-2">
            <Field label="Début"><input type="time" value={f.start} onChange={e => set({ start: e.target.value })} required /></Field>
            <Field label="Fin (facultatif)"><input type="time" value={f.end} onChange={e => set({ end: e.target.value })} /></Field>
          </div>
        )}
        <div className="field">
          <span>Couleur</span>
          <div className="colors">
            {COLORS.map(c => <button type="button" key={c} className={f.color === c ? 'on' : ''} style={{ background: c }} onClick={() => set({ color: c })} aria-label={'Couleur ' + c} aria-pressed={f.color === c} />)}
          </div>
        </div>
        <Field label="Notes"><textarea value={f.notes} onChange={e => set({ notes: e.target.value })} /></Field>
        <div className="row end">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary">{isNew ? 'Ajouter' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  )
}
