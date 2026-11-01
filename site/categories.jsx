import { useState } from 'react'
import { supabase } from './supabase'
import { q } from './useData'
import { Modal } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'
import { FORMAT_FILTERS, matchesFormat } from './catalogue'

// Barre de filtres : catégories (+ formats) avec le nombre d'éléments
export function CategoryBar({ groups, value, onChange, formats, format, onFormat, onManage }) {
  const total = groups.reduce((s, g) => s + g.items.length, 0)
  return (
    <div className="catbar no-print">
      <div className="catbar-row" role="tablist" aria-label="Catégories">
        <button type="button" role="tab" aria-selected={!value} className={'cat-chip' + (!value ? ' on' : '')} onClick={() => onChange(null)}>
          Toutes <span>{total}</span>
        </button>
        {groups.map(g => (
          <button type="button" role="tab" key={g.name || '_'} aria-selected={value === g.name} className={'cat-chip' + (value === g.name ? ' on' : '')}
            onClick={() => onChange(value === g.name ? null : g.name)}>
            {g.label} <span>{g.items.length}</span>
          </button>
        ))}
        {onManage && <button type="button" className="cat-chip manage" onClick={onManage}><Icon name="plus" size={16} />Gérer les catégories</button>}
      </div>
      {formats && formats.length > 1 && (
        <div className="catbar-row small" role="tablist" aria-label="Formats">
          <button type="button" role="tab" aria-selected={!format} className={'fmt-chip' + (!format ? ' on' : '')} onClick={() => onFormat(null)}>Tous formats</button>
          {FORMAT_FILTERS.filter(([k]) => formats.includes(k)).map(([k, label]) => (
            <button type="button" role="tab" key={k} aria-selected={format === k} className={'fmt-chip' + (format === k ? ' on' : '')} onClick={() => onFormat(format === k ? null : k)}>{label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// Hook : filtre catégorie + format, mémorisé par page
export function useCatFilter(key) {
  const read = k => { try { return JSON.parse(sessionStorage.getItem('ltdd-filter-' + key) || '{}')[k] ?? null } catch { return null } }
  const [cat, setCatS] = useState(() => read('cat'))
  const [format, setFormatS] = useState(() => read('format'))
  const persist = (c, f) => { try { sessionStorage.setItem('ltdd-filter-' + key, JSON.stringify({ cat: c, format: f })) } catch { /* rien */ } }
  return {
    cat, format,
    setCat: c => { setCatS(c); persist(c, format) },
    setFormat: f => { setFormatS(f); persist(cat, f) },
    keep: (r, getCat) => (!cat || (getCat(r) || '').trim() === cat) && matchesFormat(r, format),
  }
}

// Choix de la catégorie dans un formulaire (avec création directe)
export function CategorySelect({ value, onChange, categories }) {
  const names = categories.map(c => c.name)
  const extra = value && !names.includes(value) ? [value] : []
  return (
    <select value={value || ''} onChange={e => {
      if (e.target.value === '__new') {
        const n = prompt('Nom de la nouvelle catégorie')
        if (n && n.trim()) onChange(n.trim())
      } else onChange(e.target.value || null)
    }}>
      <option value="">Sans catégorie</option>
      {[...names, ...extra].map(n => <option key={n} value={n}>{n}</option>)}
      <option value="__new">+ Nouvelle catégorie…</option>
    </select>
  )
}

// Gestion des catégories : ajouter, renommer, ordonner, supprimer
export function CategoryManager({ categories, onClose, reload }) {
  const [name, setName] = useState('')
  const run = async (req, msg) => { try { await q(req); if (msg) notify(msg); reload() } catch (e) { notify(e.message, 'error') } }
  async function move(i, dir) {
    const list = [...categories]; const j = i + dir
    if (!list[j]) return
    ;[list[i], list[j]] = [list[j], list[i]]
    try {
      await Promise.all(list.map((c, k) => q(supabase.from('categories').update({ position: k + 1 }).eq('id', c.id))))
      reload()
    } catch (e) { notify(e.message, 'error') }
  }
  return (
    <Modal title="Catégories" onClose={onClose}>
      <div className="stack">
        <p className="muted small-text">Elles servent de filtres dans les recettes, les stocks et les allergènes, dans cet ordre. Renommer une catégorie met à jour tous ses produits.</p>
        {!categories.length && <div className="info-box">Lancez d’abord la mise à jour SQL « formats-categories » dans Supabase.</div>}
        <div className="edit-lines">
          {categories.map((c, i) => (
            <div key={c.id} className="edit-line">
              <input defaultValue={c.name} aria-label="Nom de la catégorie"
                onBlur={e => e.target.value.trim() && e.target.value.trim() !== c.name && run(supabase.rpc('rename_category', { p_id: c.id, p_name: e.target.value.trim() }), 'Catégorie renommée')}
                onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
              <button className="ghost icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter">↑</button>
              <button className="ghost icon" disabled={i === categories.length - 1} onClick={() => move(i, 1)} aria-label="Descendre">↓</button>
              <button className="ghost icon" aria-label="Supprimer"
                onClick={() => confirm(`Supprimer la catégorie « ${c.name} » ? Ses produits passeront « sans catégorie ».`) && run(supabase.rpc('delete_category', { p_id: c.id }), 'Catégorie supprimée')}>
                <Icon name="close" size={18} />
              </button>
            </div>
          ))}
        </div>
        <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={e => {
          e.preventDefault(); if (!name.trim()) return
          run(supabase.from('categories').insert({ name: name.trim(), position: categories.length + 1 }), 'Catégorie ajoutée'); setName('')
        }}>
          <input placeholder="Nouvelle catégorie (ex. : Entremets)" value={name} onChange={e => setName(e.target.value)} />
          <button className="primary">Ajouter</button>
        </form>
      </div>
    </Modal>
  )
}

// Choix du format : pièce, gâteau 4/6/8/autre, cadre 60 pers., bac ½ / entier
export function FormatPicker({ value, onChange }) {
  const [custom, setCustom] = useState('')
  const f = value.format || (value.servings ? 'gateau' : null)
  const is = (fm, extra = {}) => f === fm && Object.entries(extra).every(([k, v]) => value[k] === v)
  const chip = (label, next, on) => (
    <button type="button" role="radio" aria-checked={on} className={'chip-toggle size' + (on ? ' sel' : '')} onClick={() => onChange(next)}>{label}</button>
  )
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chips" role="radiogroup" aria-label="Format">
        {chip('À la pièce', { format: null, servings: null, bac_size: null }, !f)}
        {[4, 6, 8].map(n => <span key={n}>{chip(`Gâteau ${n} pers.`, { format: 'gateau', servings: n, bac_size: null }, is('gateau', { servings: n }))}</span>)}
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <input inputMode="numeric" placeholder="Autre" value={custom} onChange={e => setCustom(e.target.value.replace(/\D/g, ''))} style={{ width: 80 }} aria-label="Autre nombre de personnes" />
          <button type="button" className="small" disabled={!Number(custom)} onClick={() => { onChange({ format: 'gateau', servings: Number(custom), bac_size: null }); setCustom('') }}>pers.</button>
        </span>
      </div>
      <div className="chips" role="radiogroup" aria-label="Cadre ou bac">
        {chip('Cadre 60 pers.', { format: 'cadre', servings: 60, bac_size: null }, is('cadre'))}
        {chip('Bac', { format: 'bac', servings: null, bac_size: 'entier' }, is('bac', { bac_size: 'entier' }) || (f === 'bac' && !value.bac_size))}
        {chip('Bac ½', { format: 'bac', servings: null, bac_size: 'demi' }, is('bac', { bac_size: 'demi' }))}
      </div>
      {f === 'bac' && <small className="muted">Vendu en bac : dans les commandes, on choisit à chaque fois « Bac » ou « Bac ½ ».</small>}
      {f === 'gateau' && value.servings && ![4, 6, 8].includes(value.servings) && <small className="muted">Gâteau pour {value.servings} personnes.</small>}
    </div>
  )
}
