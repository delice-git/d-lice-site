import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { loadCatalogue, allergensOf, productName } from './catalogue'
import { addDaysISO, fmtDateTime, num, todayISO, toNumber } from './format'
import { AllergenBadges } from './AllergenBadges'
import { Empty, ErrorBox, Field, Loading, Modal, NumberCell, PageHeader, QtyCell, SearchBox, Seg, StockMoveModal } from './ui'
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
  inventaire: 'Quantité corrigée', livraison: 'Livraison de la production', correction: 'Correction',
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
        title={shopId === 'all' ? 'Stocks des magasins' : isStaff ? `Stock — ${shopName}` : 'Mon stock'}
        subtitle={shopId === 'all'
          ? 'Stock actuel / niveau cible de chaque magasin, et stock de l’atelier.'
          : 'Tapez directement la quantité, ou utilisez − (vente) et + (réception).'}>
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

function Legend() {
  return (
    <div className="legend">
      <span><i style={{ background: 'var(--warn)' }} />Sous le niveau cible</span>
      <span><i style={{ background: 'var(--red)' }} />Rupture</span>
    </div>
  )
}

// ---------------- Produits ----------------
function Products({ shopId, cat }) {
  const [search, setSearch] = useState('')
  const [move, setMove] = useState(null)
  const [restockOpen, setRestockOpen] = useState(false)

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
      return { r, qty, target, pending, missing: Math.max(0, target - qty), toOrder: Math.max(0, Math.ceil(target - qty - pending)), alg: allergensOf(r, cat) }
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
    } catch (e) { notify(e.message, 'error') }
  }

  if (stock.loading && !stock.data) return <Loading />
  let lastCat = null

  return (
    <>
      <ErrorBox error={stock.error} />
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Rechercher un produit…" />
        {below.length > 0 && <button className="accent" onClick={() => setRestockOpen(true)}>Commander ce qui manque ({below.length})</button>}
      </div>

      {!lines.length ? <Empty>Aucun produit. La production doit d’abord en créer.</Empty> : (
        <div className="table-wrap stock">
          <table className="stock-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th className="c">En stock</th>
                <th className="c">Cible</th>
                <th className="r">Manque</th>
                <th className="r hide-sm">En commande</th>
              </tr>
            </thead>
            <tbody>
              {lines.flatMap(l => {
                const out = []
                if (l.r.category !== lastCat) { lastCat = l.r.category; out.push(<tr key={'g' + l.r.id} className="grp"><td colSpan={5}>{l.r.category || 'Sans catégorie'}</td></tr>) }
                const state = l.target > 0 && l.qty <= 0 ? 'out' : l.qty < l.target ? 'low' : ''
                out.push(
                  <tr key={l.r.id} className={state}>
                    <td>
                      <button className="name" onClick={() => setMove(l)}>{productName(l.r)}</button>
                      <span className="hide-sm"><AllergenBadges {...l.alg} compact /></span>
                    </td>
                    <td className="c">
                      <QtyCell value={l.qty} label={l.r.name}
                        onStep={d => adjust(l.r.id, d, d < 0 ? 'vente' : 'entree').catch(() => {})}
                        onSet={n => adjust(l.r.id, n - l.qty, 'inventaire').catch(() => {})} />
                    </td>
                    <td className="c"><NumberCell value={l.target} label={`Niveau cible ${l.r.name}`} onSave={v => saveTarget(l.r.id, v)} /></td>
                    <td className="r">{l.missing > 0 ? <span className="state-ko">{num(l.missing)}</span> : <span className="state-ok">✓</span>}</td>
                    <td className="r hide-sm">{l.pending ? num(l.pending) : '—'}</td>
                  </tr>
                )
                return out
              })}
            </tbody>
          </table>
        </div>
      )}
      <Legend />

      {move && (
        <StockMoveModal title={productName(move.r)} unit="pièces" current={move.qty} reasons={PRODUCT_REASONS}
          onClose={() => setMove(null)} onSubmit={(delta, reason) => adjust(move.r.id, delta, reason).then(() => notify('Stock mis à jour'))} />
      )}
      {restockOpen && <RestockSheet shopId={shopId} below={below} onClose={() => setRestockOpen(false)} onDone={() => { setRestockOpen(false); stock.reload() }} />}
    </>
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
        <div className="table-wrap">
          <table className="stock-table">
            <thead><tr><th>Produit</th><th className="r">Quantité</th></tr></thead>
            <tbody>{below.map(l => <tr key={l.r.id}><td>{productName(l.r)}</td><td className="r big">{num(l.toOrder)}</td></tr>)}</tbody>
          </table>
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

  async function adjust(item, delta, reason) {
    try {
      const qty = await q(supabase.rpc('adjust_shop_item', { p_item: item.id, p_delta: delta, p_reason: reason }))
      data.setData(rows => rows.map(r => (r.id === item.id ? { ...r, qty } : r)))
    } catch (e) { notify(e.message, 'error') }
  }
  async function saveMin(item, v) {
    try {
      await q(supabase.from('shop_items').update({ min_qty: v }).eq('id', item.id))
      data.setData(rows => rows.map(r => (r.id === item.id ? { ...r, min_qty: v } : r)))
    } catch (e) { notify(e.message, 'error') }
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
        <div className="table-wrap stock">
          <table className="stock-table">
            <thead><tr><th>Article</th><th className="c">En stock</th><th className="c">Minimum</th><th className="r">État</th></tr></thead>
            <tbody>
              {rows.flatMap(i => {
                const out = []
                if (i.category !== lastCat) { lastCat = i.category; out.push(<tr key={'g' + i.id} className="grp"><td colSpan={4}>{i.category || 'Sans catégorie'}</td></tr>) }
                const qty = Number(i.qty), min = Number(i.min_qty)
                const state = min > 0 && qty <= 0 ? 'out' : qty < min ? 'low' : ''
                out.push(
                  <tr key={i.id} className={state}>
                    <td><button className="name" onClick={() => setEdit(i)}>{i.name}</button><span className="sub">{i.unit}</span></td>
                    <td className="c">
                      <QtyCell value={qty} label={i.name}
                        onStep={d => adjust(i, d, d < 0 ? 'vente' : 'entree')}
                        onSet={n => adjust(i, n - qty, 'inventaire')} />
                    </td>
                    <td className="c"><NumberCell value={min} label={`Minimum ${i.name}`} onSave={v => saveMin(i, v)} /></td>
                    <td className="r">{state ? <span className="state-ko">Racheter</span> : <span className="state-ok">✓</span>}</td>
                  </tr>
                )
                return out
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ItemForm shopId={shopId} item={edit} categories={[...new Set((data.data || []).map(i => i.category).filter(Boolean))]}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); data.reload() }} onMove={edit.id ? (d, r) => adjust(edit, d, r) : null} />}
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
  const data = useData(() => q(supabase.from('shop_moves').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(150)), [shopId])
  if (data.loading && !data.data) return <Loading />
  if (!data.data?.length) return <><ErrorBox error={data.error} /><Empty>Aucun mouvement pour l’instant.</Empty></>
  return (
    <div className="table-wrap stock">
      <table className="stock-table">
        <thead><tr><th>Date</th><th>Produit / article</th><th className="hide-sm">Mouvement</th><th className="r">Quantité</th><th className="r">Reste</th></tr></thead>
        <tbody>
          {data.data.map(m => (
            <tr key={m.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(m.created_at)}</td>
              <td><b>{m.label}</b><span className="sub only-mobile">{REASON_LABEL[m.reason] || m.reason}</span></td>
              <td className="hide-sm">{REASON_LABEL[m.reason] || m.reason}</td>
              <td className={'r ' + (Number(m.delta) < 0 ? 'state-ko' : 'state-ok')}>{Number(m.delta) > 0 ? '+' : ''}{num(m.delta, 3)}</td>
              <td className="r">{m.qty_after !== null ? num(m.qty_after, 3) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------- Vue production : tous les magasins ----------------
function Overview({ shops, cat, onPick }) {
  const data = useData(async () => {
    const [shop, prod] = await Promise.all([q(supabase.from('shop_stock').select('*')), q(supabase.from('production_stock').select('*'))])
    return { shop, prod: Object.fromEntries(prod.map(p => [p.recipe_id, Number(p.qty)])) }
  }, [])
  if (data.loading && !data.data) return <Loading />
  const map = {}
  for (const r of data.data?.shop || []) map[r.shop_id + ':' + r.recipe_id] = r
  const recipes = cat.recipes.filter(r => r.active)
  let lastCat = null
  return (
    <>
      <ErrorBox error={data.error} />
      <div className="row" style={{ marginBottom: 14 }}>
        {shops.map(s => <button key={s.id} onClick={() => onPick(s.id)}><Icon name="store" size={20} />Gérer {s.name}</button>)}
      </div>
      {!recipes.length ? <Empty>Aucun produit actif.</Empty> : (
        <div className="table-wrap stock">
          <table className="stock-table">
            <thead>
              <tr>
                <th>Produit</th>
                {shops.map(s => <th key={s.id} className="c">{s.name}</th>)}
                <th className="c">Atelier</th>
              </tr>
            </thead>
            <tbody>
              {recipes.flatMap(r => {
                const out = []
                if (r.category !== lastCat) { lastCat = r.category; out.push(<tr key={'g' + r.id} className="grp"><td colSpan={shops.length + 2}>{r.category || 'Sans catégorie'}</td></tr>) }
                out.push(
                  <tr key={r.id}>
                    <td><b>{productName(r)}</b></td>
                    {shops.map(s => {
                      const row = map[s.id + ':' + r.id]
                      const qty = Number(row?.qty || 0), target = Number(row?.target_qty || 0)
                      const cls = target && qty <= 0 ? 'state-ko' : qty < target ? 'state-warn' : ''
                      return (
                        <td key={s.id} className="c">
                          <span className={'big ' + cls}>{num(qty)}</span>
                          <span className="muted small-text"> / {num(target)}</span>
                        </td>
                      )
                    })}
                    <td className="c"><span className="big">{num(data.data.prod[r.id] || 0)}</span></td>
                  </tr>
                )
                return out
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small-text" style={{ marginTop: 10 }}>En stock / niveau cible. Orange : sous la cible, rouge : rupture.</p>
    </>
  )
}
