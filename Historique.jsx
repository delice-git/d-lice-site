import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { fmtDate, fmtTime, isoDate, num, ROLE_LABEL } from './format'
import { productName } from './catalogue'
import { Empty, ErrorBox, Loading, PageHeader, SearchBox, STATUS } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'

// ---------- Libellés ----------
const FIELD = {
  qty: 'Quantité', target_qty: 'Niveau cible', jete: 'Jeté', reste: 'Reste', com: 'Com.', prod: 'Prod.',
  fini: 'Fini', checked: 'Préparé', notes: 'Remarques', name: 'Nom', price: 'Prix', stock: 'Stock',
  min_stock: 'Minimum', min_qty: 'Minimum', unit: 'Unité', category: 'Catégorie', sale_price: 'Prix de vente',
  yield_qty: 'Rendement', active: 'Actif', status: 'Statut', due_date: 'Pour le', customer_name: 'Client',
  customer_phone: 'Téléphone', quantity: 'Quantité', label: 'Article', title: 'Titre', body: 'Texte',
  pinned: 'Épinglée', role: 'Rôle', shop_id: 'Magasin', format: 'Format', servings: 'Personnes', bac_size: 'Bac',
  starts_at: 'Début', ends_at: 'Fin', all_day: 'Toute la journée', off_sizes: 'Tailles indisponibles',
  bac_units: 'Bac / ½', sizes: 'Tailles', position: 'Ordre', instructions: 'Méthode', extra_allergens: 'Allergènes ajoutés',
  traces: 'Traces', allergens: 'Allergènes', supplier: 'Fournisseur', kind: 'Type', delivered_at: 'Livrée le',
  full_name: 'Nom', email: 'E-mail', color: 'Couleur', address: 'Adresse',
}
const HIDDEN = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'undone_by', 'position', 'color'])
const KEYS_IN_TITLE = new Set(['shop_id', 'recipe_id', 'line_id', 'day', 'size', 'order_id', 'article_id', 'section_id', 'item_id'])

const ZONES = ['Feuille du jour', 'Stocks magasins', 'Stock produits', 'Stock matières', 'Commandes', 'Recettes & produits', 'Agenda', 'Notes', 'Comptes', 'Réglages']

export default function Historique() {
  const [day, setDay] = useState(() => isoDate(new Date()))
  const [who, setWho] = useState('')
  const [zone, setZone] = useState('')
  const [search, setSearch] = useState('')

  const data = useData(async () => {
    const start = new Date(day + 'T00:00:00'), end = new Date(start); end.setDate(end.getDate() + 1)
    const [log, shops, recipes, articles, lines, items] = await Promise.all([
      q(supabase.from('audit_log').select('*').gte('at', start.toISOString()).lt('at', end.toISOString()).order('id', { ascending: false }).limit(1500)),
      q(supabase.from('shops').select('id, name')),
      q(supabase.from('recipes').select('*')),
      q(supabase.from('articles').select('id, name')),
      q(supabase.from('sheet_lines').select('id, name')).catch(() => []),
      q(supabase.from('shop_items').select('id, name')).catch(() => []),
    ])
    return { log, shops, recipes, articles, lines, items }
  }, [day])

  const look = useMemo(() => {
    if (!data.data) return null
    const m = (list, key = 'name') => Object.fromEntries(list.map(x => [x.id, x[key] ?? x]))
    const L = { shop: m(data.data.shops), recipe: Object.fromEntries(data.data.recipes.map(r => [r.id, productName(r)])),
      article: m(data.data.articles), line: m(data.data.lines), item: m(data.data.items) }
    // éléments supprimés : on retrouve leur nom dans le journal
    for (const e of data.data.log) {
      const d = e.old_data || e.new_data || {}
      if (e.table_name === 'recipes' && !L.recipe[d.id]) L.recipe[d.id] = productName(d)
      if (e.table_name === 'articles' && !L.article[d.id]) L.article[d.id] = d.name
      if (e.table_name === 'sheet_lines' && !L.line[d.id]) L.line[d.id] = d.name
      if (e.table_name === 'shops' && !L.shop[d.id]) L.shop[d.id] = d.name
    }
    return L
  }, [data.data])

  const groups = useMemo(() => {
    if (!data.data || !look) return []
    const byTx = new Map()
    for (const e of data.data.log) {
      const d = describe(e, look)
      if (!d) continue
      if (!byTx.has(e.tx)) byTx.set(e.tx, { tx: e.tx, at: e.at, actor: e.actor, actor_name: e.actor_name, actor_shop: e.actor_shop, note: e.note, undone_at: e.undone_at, rows: [] })
      const g = byTx.get(e.tx)
      g.rows.push({ ...e, ...d })
      if (e.at < g.at) g.at = e.at
    }
    const s = search.trim().toLowerCase()
    return [...byTx.values()]
      .map(g => ({ ...g, rows: g.rows.sort((a, b) => a.id - b.id), zones: [...new Set(g.rows.map(r => r.zone))] }))
      .filter(g => (!who || (g.actor || 'admin') === who) && (!zone || g.zones.includes(zone))
        && (!s || g.rows.some(r => (r.title + ' ' + r.changes.map(c => c.label).join(' ')).toLowerCase().includes(s))))
  }, [data.data, look, who, zone, search])

  const people = useMemo(() => {
    const m = new Map()
    for (const e of data.data?.log || []) m.set(e.actor || 'admin', e.actor_name || 'Inconnu')
    return [...m.entries()]
  }, [data.data])

  const shift = n => { const x = new Date(day + 'T12:00:00'); x.setDate(x.getDate() + n); setDay(isoDate(x)) }
  const dayLabel = new Date(day + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })

  async function undo(g) {
    const redo = g.note?.startsWith('Annulation')
    const what = g.rows.slice(0, 3).map(r => '• ' + r.title).join('\n') + (g.rows.length > 3 ? `\n… et ${g.rows.length - 3} autre(s)` : '')
    if (!confirm(`${redo ? 'Refaire' : 'Annuler'} cette opération de ${g.actor_name || 'inconnu'} (${fmtTime(g.at)}) ?\n\n${what}`)) return
    try {
      try { await q(supabase.rpc('audit_undo', { p_tx: g.tx, p_force: false })) }
      catch (e) {
        if (!/CONFLIT/.test(e.message)) throw e
        if (!confirm(`Attention : ${e.message.replace(/^.*CONFLIT : /, '')}.\n\nSi vous continuez, ces modifications plus récentes seront remplacées par l’état d’avant. Continuer ?`)) return
        await q(supabase.rpc('audit_undo', { p_tx: g.tx, p_force: true }))
      }
      notify(redo ? 'Opération refaite' : 'Opération annulée : tout est revenu comme avant')
      data.reload()
    } catch (e) { notify(e.message, 'error') }
  }

  const missing = data.error && /(audit_log|schema cache|does not exist)/i.test(data.error)

  return (
    <>
      <PageHeader title="Historique" subtitle="Tout ce qui a été ajouté, modifié ou supprimé, par qui et quand. « Annuler » remet les choses comme avant.">
        <button onClick={data.reload}><Icon name="history" size={20} />Actualiser</button>
      </PageHeader>
      {missing
        ? <div className="error-box">L’historique n’est pas encore activé : lancez <b>historique.sql</b> dans Supabase (projet du site). Détail : {data.error}</div>
        : <ErrorBox error={data.error} />}

      <div className="sheet-bar">
        <div className="day-pick">
          <button className="icon" onClick={() => shift(-1)} aria-label="Jour précédent"><Icon name="back" /></button>
          <label>
            <span className="day-name">{dayLabel}</span>
            <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} aria-label="Jour" />
          </label>
          <button className="icon" onClick={() => shift(1)} aria-label="Jour suivant"><Icon name="chevron" /></button>
        </div>
        <select value={who} onChange={e => setWho(e.target.value)} style={{ width: 'auto', flex: '1 1 160px', maxWidth: 240 }} aria-label="Personne">
          <option value="">Tout le monde</option>
          {people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <select value={zone} onChange={e => setZone(e.target.value)} style={{ width: 'auto', flex: '1 1 160px', maxWidth: 240 }} aria-label="Zone">
          <option value="">Toutes les zones</option>
          {ZONES.map(z => <option key={z}>{z}</option>)}
        </select>
        <div style={{ flex: '2 1 220px' }}><SearchBox value={search} onChange={setSearch} placeholder="Rechercher (produit, magasin…)" /></div>
      </div>

      {data.loading && !data.data ? <Loading /> : !groups.length ? (
        !missing && <Empty>{data.data?.log?.length ? 'Rien ne correspond à ces filtres.' : 'Aucune modification ce jour-là.'}</Empty>
      ) : (
        <div className="hist">
          {groups.map(g => <HistCard key={g.tx} g={g} look={look} onUndo={() => undo(g)} />)}
        </div>
      )}
      {data.data?.log?.length >= 1500 && <p className="muted small-text">Seules les 1 500 dernières modifications du jour sont affichées.</p>}
    </>
  )
}

function HistCard({ g, look, onUndo }) {
  const [open, setOpen] = useState(false)
  const shown = open ? g.rows : g.rows.slice(0, 5)
  const isUndo = g.note?.startsWith('Annulation')
  return (
    <article className={'hist-card' + (g.undone_at ? ' undone' : '') + (isUndo ? ' is-undo' : '')}>
      <header className="hist-head">
        <time>{fmtTime(g.at)}</time>
        <span className="hist-who">
          <b>{g.actor_name || 'Inconnu'}</b>
          {g.actor_shop && look.shop[g.actor_shop] && <span className="muted"> · {look.shop[g.actor_shop]}</span>}
        </span>
        <span className="hist-zones">{g.zones.map(z => <span key={z} className="badge">{z}</span>)}</span>
        <span className="spacer" />
        {isUndo && <span className="badge warn">Annulation</span>}
        {g.undone_at
          ? <span className="badge">{isUndo ? 'Refait' : 'Annulé'} à {fmtTime(g.undone_at)}</span>
          : <button className="small" onClick={onUndo}><Icon name="history" size={16} />{isUndo ? 'Refaire' : 'Annuler'}</button>}
      </header>
      <ul className="hist-rows">
        {shown.map(r => (
          <li key={r.id}>
            <span className={'hist-act a-' + r.action} title={{ INSERT: 'Ajout', UPDATE: 'Modification', DELETE: 'Suppression' }[r.action]}>
              {{ INSERT: '+', UPDATE: '✎', DELETE: '−' }[r.action]}
            </span>
            <span className="hist-body">
              <span className="hist-title">{r.title}{r.sub && <span className="muted"> · {r.sub}</span>}
                {r.action !== 'UPDATE' && <span className="muted"> — {r.action === 'INSERT' ? 'ajouté' : 'supprimé'}</span>}
              </span>
              {r.changes.length > 0 && (
                <span className="hist-changes">
                  {r.changes.map(c => (
                    <span key={c.key} className="chg">
                      {c.label} : {r.action === 'UPDATE' ? <><s>{c.before}</s> → <b>{c.after}</b></> : <b>{r.action === 'DELETE' ? c.before : c.after}</b>}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {g.rows.length > 5 && <button className="ghost small" onClick={() => setOpen(!open)}>{open ? 'Voir moins' : `Voir les ${g.rows.length - 5} autres changements`}</button>}
    </article>
  )
}

// ---------- Traduction d'une ligne du journal en phrase lisible ----------
function describe(e, L) {
  const d = e.new_data || e.old_data || {}
  const shop = id => L.shop[id] || 'magasin ?'
  const recipe = id => L.recipe[id] || 'produit supprimé'
  const sizeTxt = z => (z === 'bac' ? ' (bac)' : z === 'demi' ? ' (½ bac)' : z ? ` ${z}` : '')
  let zone, title, sub
  switch (e.table_name) {
    case 'sheet_entries': zone = 'Feuille du jour'; title = `${shop(d.shop_id)} — ${L.line[d.line_id] || 'ligne'}${sizeTxt(d.size)}`; sub = `feuille du ${fmtDate(d.day)}`; break
    case 'sheet_notes': zone = 'Feuille du jour'; title = `${shop(d.shop_id)} — remarques`; sub = `feuille du ${fmtDate(d.day)}`; break
    case 'shop_stock': zone = 'Stocks magasins'; title = `${shop(d.shop_id)} — ${recipe(d.recipe_id)}`; break
    case 'shop_items': zone = 'Stocks magasins'; title = `${shop(d.shop_id)} — ${d.name}`; break
    case 'production_stock': zone = 'Stock produits'; title = recipe(d.recipe_id); break
    case 'articles': zone = 'Stock matières'; title = d.name; break
    case 'recipes': zone = 'Recettes & produits'; title = productName(d); break
    case 'recipe_items': zone = 'Recettes & produits'; title = `${recipe(d.recipe_id)} — ingrédient ${L.article[d.article_id] || '?'}`; break
    case 'orders': zone = 'Commandes'; title = `Commande n°${d.id} — ${shop(d.shop_id)}`; break
    case 'order_items': zone = 'Commandes'; title = `Commande n°${d.order_id} — ${d.recipe_id ? recipe(d.recipe_id) : d.label}`; break
    case 'events': zone = 'Agenda'; title = d.title; break
    case 'notes': zone = 'Notes'; title = d.title || 'Note sans titre'; break
    case 'profiles': zone = 'Comptes'; title = d.full_name || d.email; break
    case 'shops': zone = 'Comptes'; title = `Magasin ${d.name}`; break
    case 'categories': zone = 'Réglages'; title = `Catégorie ${d.name}`; break
    case 'sheet_sections': zone = 'Réglages'; title = `Feuille — rubrique ${d.name}`; break
    case 'sheet_lines': zone = 'Réglages'; title = `Feuille — ligne ${d.name}`; break
    default: zone = 'Réglages'; title = e.table_name
  }
  const val = (k, v) => fmtVal(k, v, L)
  let changes = []
  if (e.action === 'UPDATE') {
    for (const k of Object.keys(e.new_data || {})) {
      if (HIDDEN.has(k)) continue
      const a = e.old_data?.[k], b = e.new_data?.[k]
      if (JSON.stringify(a) === JSON.stringify(b)) continue
      changes.push({ key: k, label: FIELD[k] || k, before: val(k, a), after: val(k, b) })
    }
  } else {
    const src = (e.action === 'INSERT' ? e.new_data : e.old_data) || {}
    for (const [k, v] of Object.entries(src)) {
      if (HIDDEN.has(k) || KEYS_IN_TITLE.has(k) || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)) continue
      if (['name', 'title', 'full_name', 'email'].includes(k) || (e.table_name === 'orders' && k === 'kind')) continue
      changes.push({ key: k, label: FIELD[k] || k, before: val(k, v), after: val(k, v) })
    }
    changes = changes.slice(0, 6)
  }
  return { zone, title, sub, changes }
}

function fmtVal(k, v, L) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non'
  if (Array.isArray(v)) return v.join(', ') || '—'
  if (k === 'status') return STATUS[v] || v
  if (k === 'role') return ROLE_LABEL[v] || v
  if (k === 'shop_id') return L.shop[v] || '?'
  if (k === 'bac_size') return v === 'demi' ? '½' : 'entier'
  if (k === 'kind') return v === 'client' ? 'Client' : 'Réassort'
  if (k === 'body' || k === 'notes' || k === 'instructions') { const s = String(v).replace(/\s+/g, ' '); return s.length > 60 ? s.slice(0, 60) + '…' : s }
  if (k === 'due_date' || k === 'day') return fmtDate(v)
  if (k === 'starts_at' || k === 'ends_at' || k === 'delivered_at') return new Date(v).toLocaleString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  if (typeof v === 'number') return num(v, 3)
  if (/^-?\d+(\.\d+)?$/.test(String(v))) return num(Number(v), 3)
  return String(v)
}
