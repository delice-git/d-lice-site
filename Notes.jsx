import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { ErrorBox, Loading } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'

// Date courte façon « Notes » : heure si aujourd'hui, « hier », sinon la date
function shortDate(iso) {
  const d = new Date(iso), now = new Date()
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = (day(now) - day(d)) / 86400000
  if (diff === 0) return d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
  if (diff === 1) return 'Hier'
  if (diff < 7) return d.toLocaleDateString('fr-BE', { weekday: 'long' })
  return d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}
const longDate = iso => new Date(iso).toLocaleString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const preview = body => body.split('\n').map(l => l.trim()).filter(Boolean)[0] || 'Pas de texte supplémentaire'

export default function Notes() {
  const data = useData(() => q(supabase.from('notes').select('*').order('pinned', { ascending: false }).order('updated_at', { ascending: false })), [])
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')

  const notes = data.data || []
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return notes.filter(n => !s || n.title.toLowerCase().includes(s) || n.body.toLowerCase().includes(s))
  }, [notes, search])
  const pinned = filtered.filter(n => n.pinned), others = filtered.filter(n => !n.pinned)
  const current = notes.find(n => n.id === selected)

  // met à jour la liste localement pendant la frappe (titre / aperçu / tri)
  const patchLocal = (id, patch) => data.setData(list => (list || []).map(n => (n.id === id ? { ...n, ...patch } : n))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updated_at > a.updated_at ? 1 : -1)))

  async function create() {
    try {
      const rows = await q(supabase.from('notes').insert({ title: '', body: '' }).select())
      data.setData(list => [rows[0], ...(list || [])])
      setSelected(rows[0].id); setSearch('')
    } catch (e) {
      notify(/relation .*notes/i.test(e.message) ? 'Lancez d’abord la mise à jour SQL « notes » dans Supabase.' : e.message, 'error')
    }
  }

  async function remove(n) {
    if (!confirm(`Supprimer la note « ${n.title || 'Nouvelle note'} » ?`)) return
    try {
      await q(supabase.from('notes').delete().eq('id', n.id))
      data.setData(list => list.filter(x => x.id !== n.id))
      setSelected(null); notify('Note supprimée')
    } catch (e) { notify(e.message, 'error') }
  }

  async function togglePin(n) {
    try {
      await q(supabase.from('notes').update({ pinned: !n.pinned }).eq('id', n.id))
      patchLocal(n.id, { pinned: !n.pinned })
    } catch (e) { notify(e.message, 'error') }
  }

  if (data.loading && !data.data) return <Loading />

  const Item = n => (
    <button key={n.id} className={'note-item' + (selected === n.id ? ' on' : '')} onClick={() => setSelected(n.id)}>
      <b>{n.title.trim() || 'Nouvelle note'}</b>
      <span><time>{shortDate(n.updated_at)}</time> {preview(n.body)}</span>
    </button>
  )

  return (
    <div className={'notes-app' + (selected ? ' has-sel' : '')}>
      <aside className="notes-list no-print">
        <div className="notes-list-head">
          <h1>Notes</h1>
          <button className="icon primary" onClick={create} aria-label="Nouvelle note" title="Nouvelle note"><Icon name="edit" /></button>
        </div>
        <div className="search notes-search">
          <Icon name="search" size={18} />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher" aria-label="Rechercher dans les notes" />
        </div>
        <ErrorBox error={data.error && (/notes/.test(data.error) ? 'Lancez d’abord la mise à jour SQL « notes » dans Supabase.' : data.error)} />
        <div className="notes-scroll">
          {pinned.length > 0 && <><p className="notes-group">Épinglées</p><div className="notes-card">{pinned.map(Item)}</div></>}
          {others.length > 0 && <>{pinned.length > 0 && <p className="notes-group">Notes</p>}<div className="notes-card">{others.map(Item)}</div></>}
          {!filtered.length && (
            <div className="notes-empty">
              {search ? 'Aucune note ne correspond.' : <>Aucune note.<br /><button className="primary" onClick={create} style={{ marginTop: 12 }}>Créer une note</button></>}
            </div>
          )}
        </div>
        <p className="notes-count">{notes.length} note{notes.length > 1 ? 's' : ''}</p>
      </aside>

      <section className="notes-editor">
        {current ? (
          <NoteEditor key={current.id} note={current} onBack={() => setSelected(null)}
            onChange={patch => patchLocal(current.id, patch)}
            onDelete={() => remove(current)} onPin={() => togglePin(current)} onNew={create} />
        ) : (
          <div className="notes-blank no-print">
            <Icon name="edit" size={40} />
            <p>Choisissez une note ou créez-en une nouvelle.</p>
            <button className="primary" onClick={create}>Nouvelle note</button>
          </div>
        )}
      </section>
    </div>
  )
}

function NoteEditor({ note, onBack, onChange, onDelete, onPin, onNew }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [state, setState] = useState('saved') // saved | dirty | saving | error
  const timer = useRef(null)
  const latest = useRef({ title: note.title, body: note.body })
  const bodyRef = useRef(null)
  const titleRef = useRef(null)

  useEffect(() => { if (!note.title && !note.body) titleRef.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function flush() {
    clearTimeout(timer.current)
    const { title: t, body: b } = latest.current
    setState('saving')
    try {
      await q(supabase.from('notes').update({ title: t, body: b }).eq('id', note.id))
      setState('saved')
    } catch (e) { setState('error'); notify('Note non enregistrée : ' + e.message, 'error') }
  }
  // enregistre en quittant la note
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); flush() } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function edit(patch) {
    latest.current = { ...latest.current, ...patch }
    if ('title' in patch) setTitle(patch.title)
    if ('body' in patch) setBody(patch.body)
    onChange({ ...patch, updated_at: new Date().toISOString() })
    setState('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; flush() }, 700)
  }

  // Liste à cocher : ajoute / retire « ☐ » au début des lignes sélectionnées, ou coche « ☐ → ☑ »
  function lineOp(op) {
    const el = bodyRef.current; if (!el) return
    const start = el.selectionStart, end = el.selectionEnd
    const from = body.lastIndexOf('\n', start - 1) + 1
    const toIdx = body.indexOf('\n', end); const to = toIdx === -1 ? body.length : toIdx
    const lines = body.slice(from, to).split('\n')
    const allBoxed = lines.every(l => /^[☐☑] /.test(l))
    const next = lines.map(l => {
      if (op === 'list') return allBoxed ? l.replace(/^[☐☑] /, '') : (/^[☐☑] /.test(l) ? l : '☐ ' + l)
      if (/^☐ /.test(l)) return l.replace(/^☐ /, '☑ ')
      if (/^☑ /.test(l)) return l.replace(/^☑ /, '☐ ')
      return '☐ ' + l
    }).join('\n')
    const nb = body.slice(0, from) + next + body.slice(to)
    edit({ body: nb })
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(from + next.length, from + next.length) })
  }

  // Entrée sur une ligne de liste : continue la liste
  function onKey(e) {
    if (e.key !== 'Enter') return
    const el = e.currentTarget, pos = el.selectionStart
    const from = body.lastIndexOf('\n', pos - 1) + 1
    const line = body.slice(from, pos)
    const m = line.match(/^([☐☑] |- |• )/)
    if (!m) return
    e.preventDefault()
    if (line.trim() === m[1].trim()) { // ligne vide : on sort de la liste
      const nb = body.slice(0, from) + body.slice(pos)
      edit({ body: nb }); requestAnimationFrame(() => el.setSelectionRange(from, from)); return
    }
    const ins = '\n' + (m[1].startsWith('☑') ? '☐ ' : m[1])
    const nb = body.slice(0, pos) + ins + body.slice(el.selectionEnd)
    edit({ body: nb }); requestAnimationFrame(() => el.setSelectionRange(pos + ins.length, pos + ins.length))
  }

  // Cliquer sur une case ☐ / ☑ la coche
  function onBodyClick(e) {
    const el = e.currentTarget, pos = el.selectionStart
    if (el.selectionEnd !== pos) return
    const from = body.lastIndexOf('\n', pos - 1) + 1
    if (pos - from <= 1 && /^[☐☑]/.test(body.slice(from, from + 1))) {
      const c = body[from] === '☐' ? '☑' : '☐'
      edit({ body: body.slice(0, from) + c + body.slice(from + 1) })
      requestAnimationFrame(() => el.setSelectionRange(pos, pos))
    }
  }

  const stateLabel = { saved: 'Enregistrée', dirty: 'Modification…', saving: 'Enregistrement…', error: 'Non enregistrée' }[state]

  return (
    <>
      <div className="note-toolbar no-print">
        <button className="ghost note-back" onClick={async () => { if (timer.current) await flush(); onBack() }}><Icon name="back" size={20} />Notes</button>
        <span className={'note-state' + (state === 'error' ? ' ko' : '')}>{stateLabel}</span>
        <span className="spacer" />
        <button className="ghost icon" onClick={() => lineOp('list')} title="Liste à cocher" aria-label="Liste à cocher"><Icon name="checklist" /></button>
        <button className="ghost icon" onClick={() => lineOp('check')} title="Cocher / décocher la ligne" aria-label="Cocher la ligne"><Icon name="check" /></button>
        <button className={'ghost icon' + (note.pinned ? ' pinned' : '')} onClick={onPin} title={note.pinned ? 'Désépingler' : 'Épingler'} aria-label={note.pinned ? 'Désépingler' : 'Épingler'} aria-pressed={note.pinned}><Icon name="pin" /></button>
        <button className="ghost icon" onClick={async () => { if (timer.current) await flush(); window.print() }} title="Imprimer ou enregistrer en PDF" aria-label="Imprimer ou enregistrer en PDF"><Icon name="print" /></button>
        <button className="ghost icon danger-ic" onClick={onDelete} title="Supprimer" aria-label="Supprimer la note"><Icon name="trash" /></button>
        <button className="ghost icon" onClick={async () => { if (timer.current) await flush(); onNew() }} title="Nouvelle note" aria-label="Nouvelle note"><Icon name="edit" /></button>
      </div>

      <div className="note-paper no-print">
        <p className="note-date">{longDate(note.updated_at)}</p>
        <input ref={titleRef} className="note-title" value={title} placeholder="Titre" aria-label="Titre de la note"
          onChange={e => edit({ title: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); bodyRef.current?.focus() } }} />
        <textarea ref={bodyRef} className="note-body" value={body} placeholder="Écrivez votre note…" aria-label="Texte de la note"
          onChange={e => edit({ body: e.target.value })} onKeyDown={onKey} onClick={onBodyClick} onBlur={() => timer.current && flush()} />
      </div>

      {/* Version imprimée / PDF */}
      <article className="note-print">
        <header>
          <span>Le Temps d’un Délice — Notes</span>
          <span>{longDate(note.updated_at)}</span>
        </header>
        <h1>{title || 'Note'}</h1>
        <div className="note-print-body">
          {body.split('\n').map((l, i) => (
            <p key={i} className={/^☑ /.test(l) ? 'done' : ''}>{l || ' '}</p>
          ))}
        </div>
      </article>
    </>
  )
}
