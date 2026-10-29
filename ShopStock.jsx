import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { loadCatalogue, allergensOf } from './catalogue'
import { addDaysISO, fmtDateTime, num, todayISO, toNumber } from './format'
import { AllergenBadges } from './AllergenBadges'
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, SearchBox, Seg, Stepper, StockMoveModal } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'

const PRODUCT_REASONS = [
  { key: 'entree', label: 'Réception', sign: 1 },
  { key: 'fabrication', label: 'Fabrication maison', sign: 1 },
  { key: 'vente', label: 'Vente', sign: -1 },
  { key: 'perte', label: 'Perte / invendu', sign: -1 },
  { key: 'inventaire', label: 'Inventaire', sign: 0 },
]
const ITEM_REASONS = [
  { key: 'entree', label: 'Réception', sign: 1 },
  { key: 'vente', label: 'Vente', sign: -1 },
  { key: 'perte', label: 'Perte / casse', sign: -1 },
  { key: 'inventaire', label: 'Inventaire', sign: 0 },
]
const REASON_LABEL = {
  entree: 'Réception', fabrication: 'Fabrication maison', vente: 'Vente', perte: 'Perte',
  inventaire: 'Inventaire', livraison: 'Livraison de la production', correction: 'Correction',
}
const UNITS = ['pièce', 'kg', 'L', 'boîte', 'paquet', 'bouteille', 'sac', 'rouleau']

export default function ShopStock({ profile, shops, isStaff }) {
  const [shopId, setShopId] = useState(isStaff ? 'all' : profile.shop_id)
  const cat = useData(loadCatalogue, [])

  if (!shopId) return <Empty>Ce compte n’est rattaché à aucun magasin.</Empty>
  if (cat.loading && !cat.data) return <Loading />
  const shopName = shops.find(s => s.id === shopId)?.name

  return (
    <>
      <PageHeader
        title={isStaff ? (shopId === 'all' ? 'Stocks des magasins' : shopName) : 'Mon stock'}
        subtitle={shopId === 'all'
          ? 'Stock actuel et niveau cible de chaque magasin.'
          : 'Notez vos réceptions, ventes, pertes et inventaires. Le stock se met à jour tout de suite.'}>
        {isStaff && (
          <select value={shopId} onChange={e => setShopId(e.target.value)} aria-label="Magasin">
            <option value="all">Tous les magasins</option>
            {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </PageHeader>
      <ErrorBox error={cat.error} />
      {shopId === 'all'
        ? <Overview shops={shops} cat={cat.data} onPick={setShopId} />
        : <OneShop key={shopId} shopId={shopId} cat={cat.data} />}
    </>
  )
}

function OneShop({ shopId, cat }) {
  const [view, setView] = useState('produits')
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Seg value={view} onChange={setView} options={[['produits', 'Produits'], ['articles', 'Mes articles'], ['historique', 'Historique']]} />
      </div>
      {view === 'produits' && <Products shopId={shopId} cat={cat} />}
      {view === 'articles' && <Items shopId={shopId} />}
      {view === 'historique' && <History shopId={shopId} />}
    </>
  )
}

// ---------------- Produits (recettes de la production) ----------------
function Products({ shopId, cat }) {
  const [search, setSearch] = useState('')
  const [inventory, setInventory] = useState(false)
  const [counts, setCounts] = useState({})
  const [move, setMove] = useState(null)
  const [restockOpen, setRestockOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const stock = useData(async () => {
    const [rows, orders] = await Promise.all([
      q(supabase.from('shop_stock').select('*').eq('shop_id', shopId)),
      q(supabase.from('orders').select('id, order_items(recipe_id, quantity)')
        .eq('shop_id', shopId).eq('kind', 'reassort').in('status', ['en_attente', 'en_production', 'prete'])),
    ])
    const pending = {}
    for (const o of orders) for (const it of o.order_items) pending[it.recipe_id] = (pending[it.recipe_id] || 0) + Number(it.quantity)
    return { rows: Object.fromEntries(rows.map(r => [r.recipe_id, r])), pending }
  }, [shopId])

  const lines = useMemo(() => {
    if (!stock.data) return []
    const s = search.trim().toLowerCase()
    return cat.recipes.filter(r => r.active && (!s || r.name.toLowerCase().includes(s))).map(r => {
      const row = stock.data.rows[r.id]
      const qty = Number(row?.qty || 0), target = Number(row?.target_qty || 0), pending = stock.data.pending[r.id] || 0
      return { r, qty, target, pending, toOrder: Math.max(0, Math.ceil(target - qty - pending)), alg: allergensOf(r, cat) }
    })
  }, [stock.data, cat, search])

  const below = lines.filter(l => l.toOrder > 0)

  function setLocal(recipeId, patch) {
    stock.setData(d => ({ ...d, rows: { ...d.rows, [recipeId]: { ...(d.rows[recipeId] || { qty: 0, target_qty: 0 }), ...patch } } }))
  }

  async function adjust(recipeId, delta, reason) {
    try {
      const qty = await q(supabase.rpc('adjust_shop_stock', { p_shop: shopId, p_recipe: recipeId, p_delta: delta, p_reason: reason }))
      setLocal(recipeId, { qty })
    } catch (e) { notify(e.message, 'error'); throw e }
  }

  async function saveTarget(recipeId, value) {
    try {
      await q(supabase.from('shop_stock').upsert({ shop_id: shopId, recipe_id: recipeId, target_qty: value }, { onConflict: 'shop_id,recipe_id' }))
      setLocal(recipeId, { target_qty: value })
      notify('Niveau cible enregistré')
    } catch (e) { notify(e.message, 'error') }
  }

  const changed = lines.filter(l => counts[l.r.id] !== undefined && counts[l.r.id] !== '' && toNumber(counts[l.r.id]) !== l.qty)
  async function saveInventory() {
    setSaving(true)
    try {
      for (const l of changed) await adjust(l.r.id, toNumber(counts[l.r.id]) - l.qty, 'inventaire')
      notify(`Inventaire enregistré (${changed.length} produit${changed.length > 1 ? 's' : ''})`)
      setCounts({}); setInventory(false)
    } catch { /* message déjà affiché */ } finally { setSaving(false) }
  }

  if (stock.loading && !stock.data) return <Loading />
  let lastCat = null

  return (
    <>
      <ErrorBox error={stock.error} />
      {below.length > 0 && !inventory && (
        <div className="panel row" style={{ marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h3>{below.length} produit{below.length > 1 ? 's' : ''} sous le niveau cible</h3>
            <p className="muted small-text">Vous pouvez demander le complément à la production, ou fabriquer vous-même.</p>
          </div>
          <button className="accent" onClick={() => setRestockOpen(true)}>Commander ce qui manque</button>
        </div>
      )}

      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Rechercher un produit…" />
        <button className={inventory ? 'primary' : ''} onClick={() => { setInventory(!inventory); setCounts({}) }}>
          <Icon name="clipboard" size={20} />{inventory ? 'Quitter l’inventaire' : 'Faire l’inventaire'}
        </button>
      </div>
      {inventory && <div className="info-box" style={{ marginBottom: 14 }}>Comptez chaque produit et saisissez la quantité réelle. Laissez vide ce qui n’a pas changé.</div>}

      {!lines.length ? <Empty>Aucun produit. La production doit d’abord créer des recettes.</Empty> : (
        <div className="list">
          {lines.map(l => {
            const out = []
            if (l.r.category !== lastCat) { lastCat = l.r.category; out.push(<div key={'g' + l.r.id} className="list-group">{l.r.category || 'Sans catégorie'}</div>) }
            const state = l.target > 0 && l.qty <= 0 ? ' out' : l.qty < l.target ? ' low' : ''
            out.push(
              <div key={l.r.id} className={'item stack-sm' + state}>
                <button className="item-main tap" onClick={() => setMove(l)}>
                  <span className="item-title">{l.r.name}</span>
                  <span className="item-sub">
                    Cible {num(l.target)}{l.pending ? ` · ${num(l.pending)} en commande` : ''}{l.toOrder ? <b className="ko"> · manque {num(l.toOrder)}</b> : ''}
                  </span>
                  <AllergenBadges {...l.alg} compact />
                </button>
                <div className="item-side">
                  {inventory ? (
                    <label className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                      <span className="muted small-text">Avant : {num(l.qty)}</span>
                      <input className="qty" inputMode="decimal" placeholder={String(l.qty)} value={counts[l.r.id] ?? ''}
                        onChange={e => setCounts(c => ({ ...c, [l.r.id]: e.target.value }))} aria-label={`Quantité comptée ${l.r.name}`} />
                    </label>
                  ) : (
                    <Stepper value={l.qty} label={l.r.name}
                      onMinus={() => adjust(l.r.id, -1, 'vente').catch(() => {})}
                      onPlus={() => adjust(l.r.id, 1, 'entree').catch(() => {})}
                      onOpen={() => setMove(l)} />
                  )}
                </div>
              </div>
            )
            return out
          })}
        </div>
      )}
      {!inventory && <p className="muted small-text" style={{ marginTop: 10 }}>− compte une vente, + une réception. Touchez un produit ou le chiffre pour les autres mouvements.</p>}

      {inventory && (
        <div className="action-bar">
          <span>{changed.length ? `${changed.length} produit${changed.length > 1 ? 's' : ''} modifié${changed.length > 1 ? 's' : ''}` : 'Aucune modification'}</span>
          <span className="spacer" />
          <button onClick={() => { setInventory(false); setCounts({}) }}>Annuler</button>
          <button className="accent" disabled={!changed.length || saving} onClick={saveInventory}>{saving ? 'Enregistrement…' : 'Enregistrer l’inventaire'}</button>
        </div>
      )}

      {move && (
        <StockMoveModal title={move.r.name} unit="pièces" current={move.qty} reasons={PRODUCT_REASONS}
          onClose={() => setMove(null)} onSubmit={(delta, reason) => adjust(move.r.id, delta, reason).then(() => notify('Stock mis à jour'))}>
          <TargetEditor initial={move.target} onSave={v => saveTarget(move.r.id, v)} />
        </StockMoveModal>
      )}
      {restockOpen && <RestockSheet shopId={shopId} below={below} onClose={() => setRestockOpen(false)} onDone={() => { setRestockOpen(false); stock.reload() }} />}
    </>
  )
}

function TargetEditor({ initial, onSave }) {
  const [v, setV] = useState(String(initial))
  return (
    <div className="panel" style={{ background: 'var(--surface-2)', marginTop: 4 }}>
      <Field label="Niveau cible" hint="Quantité à avoir en rayon. Sert à calculer ce qu’il manque.">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input inputMode="decimal" value={v} onChange={e => setV(e.target.value)} />
          <button type="button" onClick={() => onSave(toNumber(v))} disabled={toNumber(v) === Number(initial)}>Enregistrer</button>
        </div>
      </Field>
    </div>
  )
}

function RestockSheet({ shopId, below, onClose, onDone }) {
  const [due, setDue] = useState(addDaysISO(1))
  const [busy, setBusy] = useState(false)
  async function send() {
    setBusy(true)
    try {
      const id = await q(supabase.rpc('request_restock', { p_shop: shopId, p_due: due }))
      notify(`Commande n°${id} envoyée à la production`); onDone()
    } catch (e) { notify(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="Commander ce qui manque" onClose={onClose}>
      <div className="stack">
        <div className="list">
          {below.map(l => (
            <div key={l.r.id} className="item" style={{ minHeight: 0 }}>
              <span className="item-main"><span className="item-title">{l.r.name}</span></span>
              <b className="tabular">× {num(l.toOrder)}</b>
            </div>
          ))}
        </div>
        <Field label="Livraison souhaitée le"><input type="date" value={due} min={todayISO()} onChange={e => setDue(e.target.value)} /></Field>
        <div className="row end">
          <button onClick={onClose}>Annuler</button>
          <button className="primary" onClick={send} disabled={busy}>{busy ? 'Envoi…' : 'Envoyer à la production'}</button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------- Articles propres au magasin ----------------
function Items({ shopId }) {
  const data = useData(() => q(supabase.from('shop_items').select('*').eq('shop_id', shopId).order('category').order('name')), [shopId])
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState(null)
  const [move, setMove] = useState(null)

  async function adjust(item, delta, reason) {
    try {
      const qty = await q(supabase.rpc('adjust_shop_item', { p_item: item.id, p_delta: delta, p_reason: reason }))
      data.setData(rows => rows.map(r => (r.id === item.id ? { ...r, qty } : r)))
    } catch (e) { notify(e.message, 'error'); throw e }
  }

  if (data.loading && !data.data) return <Loading />
  const s = search.trim().toLowerCase()
  const rows = (data.data || []).filter(i => !s || i.name.toLowerCase().includes(s) || (i.category || '').toLowerCase().includes(s))
  let lastCat = null

  return (
    <>
      <ErrorBox error={data.error} />
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Rechercher un article…" />
        <button className="primary" onClick={() => setEdit({})}><Icon name="plus" size={20} />Nouvel article</button>
      </div>
      {!rows.length ? (
        <Empty>{data.data?.length ? 'Aucun article ne correspond.' : 'Ajoutez ici ce que le magasin gère seul : boissons, emballages, produits revendus…'}</Empty>
      ) : (
        <div className="list">
          {rows.map(i => {
            const out = []
            if (i.category !== lastCat) { lastCat = i.category; out.push(<div key={'g' + i.id} className="list-group">{i.category || 'Sans catégorie'}</div>) }
            const state = Number(i.min_qty) > 0 && Number(i.qty) <= 0 ? ' out' : Number(i.qty) < Number(i.min_qty) ? ' low' : ''
            out.push(
              <div key={i.id} className={'item stack-sm' + state}>
                <button className="item-main tap" onClick={() => setMove(i)}>
                  <span className="item-title">{i.name}</span>
                  <span className="item-sub">{i.unit}{Number(i.min_qty) ? ` · minimum ${num(i.min_qty)}` : ''}{state ? <b className="ko"> · à racheter</b> : ''}</span>
                </button>
                <div className="item-side">
                  <Stepper value={i.qty} label={i.name}
                    onMinus={() => adjust(i, -1, 'vente').catch(() => {})}
                    onPlus={() => adjust(i, 1, 'entree').catch(() => {})}
                    onOpen={() => setMove(i)} />
                </div>
              </div>
            )
            return out
          })}
        </div>
      )}
      {edit && <ItemForm shopId={shopId} item={edit} categories={[...new Set((data.data || []).map(i => i.category).filter(Boolean))]}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); data.reload() }} />}
      {move && (
        <StockMoveModal title={move.name} unit={move.unit} current={move.qty} reasons={ITEM_REASONS}
          onClose={() => setMove(null)} onSubmit={(delta, reason) => adjust(move, delta, reason).then(() => notify('Stock mis à jour'))}>
          <button type="button" className="ghost" onClick={() => { setEdit(move); setMove(null) }}>Modifier ou supprimer l’article</button>
        </StockMoveModal>
      )}
    </>
  )
}

function ItemForm({ shopId, item, categories, onClose, onSaved }) {
  const isNew = !item.id
  const [f, setF] = useState({ name: item.name || '', category: item.category || '', unit: item.unit || 'pièce', qty: '', min_qty: item.min_qty ?? '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = p => setF(x => ({ ...x, ...p }))

  async function submit(e) {
    e.preventDefault()
    if (!f.name.trim()) return setError('Donnez un nom à l’article.')
    setBusy(true); setError(null)
    const payload = { name: f.name.trim(), category: f.category.trim() || null, unit: f.unit, min_qty: toNumber(f.min_qty) }
    try {
      if (isNew) await q(supabase.from('shop_items').insert({ ...payload, shop_id: shopId, qty: toNumber(f.qty) }))
      else await q(supabase.from('shop_items').update(payload).eq('id', item.id))
      notify(isNew ? 'Article ajouté' : 'Article enregistré'); onSaved()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function remove() {
    if (!confirm(`Supprimer « ${item.name} » ?`)) return
    try { await q(supabase.from('shop_items').delete().eq('id', item.id)); notify('Article supprimé'); onSaved() }
    catch (err) { setError(err.message) }
  }

  return (
    <Modal title={isNew ? 'Nouvel article' : item.name} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Nom"><input autoFocus={isNew} value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Ex. : Coca 33 cl, sachets kraft…" /></Field>
        <div className="grid-2">
          <Field label="Catégorie">
            <input list="item-cats" value={f.category} onChange={e => set({ category: e.target.value })} placeholder="Ex. : Boissons" />
            <datalist id="item-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Unité">
            <select value={f.unit} onChange={e => set({ unit: e.target.value })}>{UNITS.map(u => <option key={u}>{u}</option>)}</select>
          </Field>
        </div>
        <div className="grid-2">
          {isNew && <Field label="Quantité actuelle"><input inputMode="decimal" value={f.qty} onChange={e => set({ qty: e.target.value })} /></Field>}
          <Field label="Minimum" hint="En dessous, l’article est signalé à racheter."><input inputMode="decimal" value={f.min_qty} onChange={e => set({ min_qty: e.target.value })} /></Field>
        </div>
        <div className="row">
          {!isNew && <button type="button" className="danger" onClick={remove}>Supprimer</button>}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy}>{isNew ? 'Ajouter' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ---------------- Historique ----------------
function History({ shopId }) {
  const data = useData(() => q(supabase.from('shop_moves').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(100)), [shopId])
  if (data.loading && !data.data) return <Loading />
  if (!data.data?.length) return <><ErrorBox error={data.error} /><Empty>Aucun mouvement pour l’instant.</Empty></>
  return (
    <div className="list">
      {data.data.map(m => (
        <div key={m.id} className="item">
          <span className="item-main">
            <span className="item-title">{m.label}</span>
            <span className="item-sub">{REASON_LABEL[m.reason] || m.reason} · {fmtDateTime(m.created_at)}</span>
          </span>
          <span className="item-figure">
            <b className={Number(m.delta) < 0 ? 'ko' : 'ok'}>{Number(m.delta) > 0 ? '+' : ''}{num(m.delta, 3)}</b>
            {m.qty_after !== null && <span>reste {num(m.qty_after, 3)}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------- Vue production : tous les magasins ----------------
function Overview({ shops, cat, onPick }) {
  const data = useData(() => q(supabase.from('shop_stock').select('*')), [])
  if (data.loading && !data.data) return <Loading />
  const map = {}
  for (const r of data.data || []) map[r.shop_id + ':' + r.recipe_id] = r
  const recipes = cat.recipes.filter(r => r.active)
  return (
    <>
      <ErrorBox error={data.error} />
      <div className="row" style={{ marginBottom: 14 }}>
        {shops.map(s => <button key={s.id} onClick={() => onPick(s.id)}><Icon name="store" size={20} />Gérer {s.name}</button>)}
      </div>
      {!recipes.length ? <Empty>Aucune recette active.</Empty> : (
        <div className="list">
          {recipes.map(r => (
            <div key={r.id} className="item stack-sm">
              <span className="item-main"><span className="item-title">{r.name}</span><span className="item-sub">{r.category}</span></span>
              <span className="item-side" style={{ gap: 18 }}>
                {shops.map(s => {
                  const row = map[s.id + ':' + r.id]
                  const qty = Number(row?.qty || 0), target = Number(row?.target_qty || 0)
                  return (
                    <span key={s.id} className="item-figure">
                      <b className={target && qty <= 0 ? 'ko' : ''}>{num(qty)}<small className="muted" style={{ fontSize: '.8rem', fontWeight: 400 }}> / {num(target)}</small></b>
                      <span>{s.name}</span>
                    </span>
                  )
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
