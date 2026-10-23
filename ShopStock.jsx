import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { loadCatalogue, allergensOf } from './catalogue'
import { addDaysISO, num, todayISO, toNumber } from './format'
import { AllergenBadges } from './AllergenBadges'
import { Empty, ErrorBox, Loading, PageHeader } from './ui'
import { notify } from './Toast'

export default function ShopStock({ profile, shops, isStaff }) {
  const [shopId, setShopId] = useState(isStaff ? 'all' : profile.shop_id)
  const cat = useData(loadCatalogue, [])

  if (!shopId) return <Empty>Ce compte n'est rattaché à aucun magasin.</Empty>
  if (cat.loading && !cat.data) return <Loading />

  const shopName = shops.find(s => s.id === shopId)?.name
  return (
    <>
      <PageHeader
        title={isStaff ? 'Stocks des magasins' : `Stock — ${shopName || 'mon magasin'}`}
        subtitle="Chaque produit a un niveau cible. « Compléter le stock » commande automatiquement à la production ce qui manque pour l’atteindre.">
        {isStaff && (
          <select value={shopId} onChange={e => setShopId(e.target.value)} style={{ width: 'auto' }} aria-label="Magasin">
            <option value="all">Vue comparée</option>
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
  const [due, setDue] = useState(addDaysISO(1))
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

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

  const totalToOrder = lines.reduce((s, l) => s + l.toOrder, 0)
  const productsToOrder = lines.filter(l => l.toOrder > 0).length

  function patchLocal(recipeId, patch) {
    stock.setData(d => ({ ...d, rows: { ...d.rows, [recipeId]: { ...(d.rows[recipeId] || { shop_id: shopId, recipe_id: recipeId, qty: 0, target_qty: 0 }), ...patch } } }))
  }

  async function adjust(recipeId, delta) {
    try {
      const qty = await q(supabase.rpc('adjust_shop_stock', { p_shop: shopId, p_recipe: recipeId, p_delta: delta }))
      patchLocal(recipeId, { qty })
    } catch (e) { notify(e.message, 'error') }
  }

  async function setField(recipeId, field, raw, previous) {
    const value = toNumber(raw)
    if (value === previous) return
    try {
      await q(supabase.from('shop_stock').upsert({ shop_id: shopId, recipe_id: recipeId, [field]: value }, { onConflict: 'shop_id,recipe_id' }))
      patchLocal(recipeId, { [field]: value })
    } catch (e) { notify(e.message, 'error') }
  }

  async function restock() {
    setBusy(true)
    try {
      const id = await q(supabase.rpc('request_restock', { p_shop: shopId, p_due: due }))
      notify(`Commande de réassort n°${id} envoyée à la production`)
      stock.reload()
    } catch (e) { notify(e.message, 'error') } finally { setBusy(false) }
  }

  if (stock.loading && !stock.data) return <Loading />

  let lastCat = null
  return (
    <>
      <ErrorBox error={stock.error} />
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="row">
          <div>
            <h2>{productsToOrder ? `${productsToOrder} produit${productsToOrder > 1 ? 's' : ''} à compléter` : 'Stock au niveau cible'}</h2>
            <p className="muted small-text">
              {productsToOrder ? `${num(totalToOrder)} pièces au total, commandes déjà en cours déduites.` : 'Rien à commander pour le moment.'}
            </p>
          </div>
          <span className="spacer" />
          <label className="row small-text" style={{ gap: 6 }}>
            Livraison le
            <input type="date" value={due} min={todayISO()} onChange={e => setDue(e.target.value)} style={{ width: 'auto' }} />
          </label>
          <button className="gold" onClick={restock} disabled={busy || !productsToOrder}>{busy ? 'Envoi…' : 'Compléter le stock'}</button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Rechercher un produit…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 320 }} aria-label="Rechercher" />
      </div>

      {!lines.length ? <Empty>Aucun produit. La production doit d’abord créer des recettes.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Produit</th><th>Allergènes</th><th className="num">En stock</th><th className="num">Niveau cible</th><th className="num">En commande</th><th className="num">À compléter</th></tr>
            </thead>
            <tbody>
              {lines.flatMap(l => {
                const out = []
                if (l.r.category !== lastCat) { lastCat = l.r.category; out.push(<tr key={'g' + l.r.id} className="group"><td colSpan={6}>{l.r.category || 'Sans catégorie'}</td></tr>) }
                out.push(
                  <tr key={l.r.id} className={l.qty <= 0 && l.target > 0 ? 'out' : l.qty < l.target ? 'low' : ''}>
                    <td><b>{l.r.name}</b></td>
                    <td><AllergenBadges {...l.alg} compact /></td>
                    <td className="num">
                      <span className="stepper">
                        <button className="square small" onClick={() => adjust(l.r.id, -1)} aria-label={`Retirer 1 ${l.r.name}`}>−</button>
                        <input key={'q' + l.qty} className="qty" inputMode="decimal" defaultValue={l.qty}
                          onBlur={e => setField(l.r.id, 'qty', e.target.value, l.qty)}
                          onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} aria-label={`Stock ${l.r.name}`} />
                        <button className="square small" onClick={() => adjust(l.r.id, 1)} aria-label={`Ajouter 1 ${l.r.name}`}>+</button>
                      </span>
                    </td>
                    <td className="num">
                      <input key={'t' + l.target} className="qty" inputMode="decimal" defaultValue={l.target}
                        onBlur={e => setField(l.r.id, 'target_qty', e.target.value, l.target)}
                        onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} aria-label={`Niveau cible ${l.r.name}`} />
                    </td>
                    <td className="num">{l.pending ? num(l.pending) : '—'}</td>
                    <td className="num">{l.toOrder ? <b className="ko">{num(l.toOrder)}</b> : <span className="ok">OK</span>}</td>
                  </tr>
                )
                return out
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function Overview({ shops, cat, onPick }) {
  const data = useData(() => q(supabase.from('shop_stock').select('*')), [])
  if (data.loading && !data.data) return <Loading />
  const map = {}
  for (const r of data.data || []) map[r.shop_id + ':' + r.recipe_id] = r
  const recipes = cat.recipes.filter(r => r.active)
  return (
    <>
      <ErrorBox error={data.error} />
      {!recipes.length ? <Empty>Aucune recette active.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Produit</th>
                {shops.map(s => <th key={s.id} className="num"><button className="ghost small" onClick={() => onPick(s.id)}>{s.name}</button></th>)}
                <th className="num">Total magasins</th>
              </tr>
            </thead>
            <tbody>
              {recipes.map(r => {
                let total = 0
                return (
                  <tr key={r.id}>
                    <td><b>{r.name}</b> <span className="muted small-text">{r.category}</span></td>
                    {shops.map(s => {
                      const row = map[s.id + ':' + r.id]
                      const qty = Number(row?.qty || 0), target = Number(row?.target_qty || 0)
                      total += qty
                      return (
                        <td key={s.id} className="num" style={{ background: target && qty < target ? (qty <= 0 ? 'var(--red-soft)' : '#fdf6e8') : undefined }}>
                          <b>{num(qty)}</b> <span className="muted small-text">/ {num(target)}</span>
                        </td>
                      )
                    })}
                    <td className="num">{num(total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small-text" style={{ marginTop: 10 }}>Stock actuel / niveau cible. Cliquez sur un magasin pour le gérer.</p>
    </>
  )
}
