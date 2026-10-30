import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { eur, fmtDateTime, num, toNumber } from './format'
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, QtyCell, SearchBox } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'
import { productName } from './catalogue'

const CATEGORIES = ['Pain', 'Viennoiserie', 'Pâtisserie', 'Snacking', 'Gâteau', 'Boisson', 'Autre']

export default function ProductStock() {
  const [producing, setProducing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const data = useData(async () => {
    const [recipes, stock, orders, batches, items] = await Promise.all([
      q(supabase.from('recipes').select('id, name, category, yield_qty, sale_price, active, servings').eq('active', true).order('category').order('name')),
      q(supabase.from('production_stock').select('*')),
      q(supabase.from('orders').select('id, order_items(recipe_id, quantity)').in('status', ['en_attente', 'en_production', 'prete'])),
      q(supabase.from('production_batches').select('*').order('created_at', { ascending: false }).limit(25)),
      q(supabase.from('recipe_items').select('recipe_id')),
    ])
    const reserved = {}
    for (const o of orders) for (const it of o.order_items) reserved[it.recipe_id] = (reserved[it.recipe_id] || 0) + Number(it.quantity)
    const withRecipe = new Set(items.map(i => i.recipe_id))
    return { recipes, stock: Object.fromEntries(stock.map(s => [s.recipe_id, Number(s.qty)])), reserved, batches, withRecipe }
  }, [])

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (data.data?.recipes || []).filter(r => !s || r.name.toLowerCase().includes(s)).map(r => {
      const qty = data.data.stock[r.id] || 0, reserved = data.data.reserved[r.id] || 0
      return { r, qty, reserved, free: qty - reserved, hasRecipe: data.data.withRecipe.has(r.id) }
    })
  }, [data.data, search])

  async function adjust(recipeId, delta) {
    try {
      const qty = await q(supabase.rpc('adjust_product_stock', { p_recipe: recipeId, p_delta: delta }))
      data.setData(d => ({ ...d, stock: { ...d.stock, [recipeId]: Number(qty) } }))
    } catch (e) { notify(e.message, 'error') }
  }

  if (data.loading && !data.data) return <Loading />
  let lastCat = null

  return (
    <>
      <PageHeader title="Stock produits" subtitle="Produits finis à l’atelier. Tapez directement la quantité, ou utilisez − et +.">
        <button className="primary" onClick={() => setAdding(true)}><Icon name="plus" size={20} />Nouveau produit</button>
        <button onClick={() => setProducing({})}>Produire depuis une recette</button>
      </PageHeader>
      <ErrorBox error={data.error} />
      <div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Rechercher un produit…" /></div>

      {!rows.length ? <Empty>Aucun produit. Ajoutez-en avec « Nouveau produit », pas besoin de recette.</Empty> : (
        <div className="table-wrap stock">
          <table className="stock-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th className="c">En stock</th>
                <th className="r">Réservé</th>
                <th className="r">Disponible</th>
                <th className="hide-sm"></th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap(({ r, qty, reserved, free, hasRecipe }) => {
                const out = []
                if (r.category !== lastCat) { lastCat = r.category; out.push(<tr key={'g' + r.id} className="grp"><td colSpan={5}>{r.category || 'Sans catégorie'}</td></tr>) }
                out.push(
                  <tr key={r.id} className={free < 0 ? 'out' : ''}>
                    <td><b>{productName(r)}</b>{!hasRecipe && <span className="sub">sans recette</span>}</td>
                    <td className="c">
                      <QtyCell value={qty} label={r.name} onStep={d => adjust(r.id, d)} onSet={n => adjust(r.id, n - qty)} />
                    </td>
                    <td className="r">{reserved ? num(reserved) : '—'}</td>
                    <td className="r">{free < 0 ? <span className="state-ko">{num(free)}</span> : <b>{num(free)}</b>}</td>
                    <td className="r hide-sm">{hasRecipe && <button className="small ghost" onClick={() => setProducing({ recipe: r })}>Produire</button>}</td>
                  </tr>
                )
                return out
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small-text" style={{ marginTop: 10 }}>Réservé = quantités demandées dans les commandes en cours. Disponible = en stock − réservé.</p>

      <h2 style={{ margin: '26px 0 10px' }}>Dernières productions</h2>
      {!data.data.batches.length ? <p className="muted">Aucune production enregistrée depuis une recette.</p> : (
        <div className="table-wrap stock">
          <table className="stock-table">
            <thead><tr><th>Date</th><th>Produit</th><th className="r">Pièces</th><th className="r hide-sm">Coût</th></tr></thead>
            <tbody>
              {data.data.batches.map(b => (
                <tr key={b.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(b.created_at)}</td>
                  <td>{b.recipe_name}</td>
                  <td className="r state-ok">+{num(b.qty)}</td>
                  <td className="r hide-sm">{eur(b.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && <NewProduct categories={[...new Set([...CATEGORIES, ...data.data.recipes.map(r => r.category).filter(Boolean)])]}
        onClose={() => setAdding(false)} onDone={() => { setAdding(false); data.reload() }} />}
      {producing && <ProduceSheet recipes={data.data.recipes.filter(r => data.data.withRecipe.has(r.id))} initial={producing.recipe}
        onClose={() => setProducing(null)} onDone={() => { setProducing(null); data.reload() }} />}
    </>
  )
}

// Produit sans recette : juste un nom, une catégorie et une quantité
function NewProduct({ categories, onClose, onDone }) {
  const [f, setF] = useState({ name: '', category: 'Pain', price: '', qty: '', servings: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = p => setF(x => ({ ...x, ...p }))
  async function submit(e) {
    e.preventDefault()
    if (!f.name.trim()) return setError('Donnez un nom au produit.')
    setBusy(true); setError(null)
    try {
      const id = await q(supabase.rpc('save_recipe', {
        p_id: null,
        p_recipe: { name: f.name.trim(), category: f.category, yield_qty: 1, servings: Number(f.servings) || null, sale_price: toNumber(f.price), extra_allergens: [], traces: [], active: true },
        p_items: [],
      }))
      if (toNumber(f.qty)) await q(supabase.rpc('adjust_product_stock', { p_recipe: id, p_delta: toNumber(f.qty) }))
      notify(`${f.name.trim()} ajouté au stock`); onDone()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Nouveau produit" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <p className="muted small-text">Pas besoin de recette. Le produit pourra être commandé par les magasins. Vous pourrez ajouter sa recette et ses allergènes plus tard dans « Recettes ».</p>
        <Field label="Nom"><input autoFocus value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Ex. : Tarte au riz" /></Field>
        <div className="grid-2">
          <Field label="Catégorie">
            <input list="prod-cats" value={f.category} onChange={e => set({ category: e.target.value })} />
            <datalist id="prod-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Prix de vente (€, facultatif)"><input inputMode="decimal" value={f.price} onChange={e => set({ price: e.target.value })} /></Field>
        </div>
        <Field label="Taille">
          <select value={f.servings} onChange={e => set({ servings: e.target.value })}>
            <option value="">À la pièce</option>
            <option value="4">Gâteau 4 personnes</option>
            <option value="6">Gâteau 6 personnes</option>
            <option value="8">Gâteau 8 personnes</option>
          </select>
        </Field>
        <Field label="Quantité en stock"><input inputMode="decimal" value={f.qty} onChange={e => set({ qty: e.target.value })} placeholder="0" /></Field>
        <div className="row end">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy}>Ajouter le produit</button>
        </div>
      </form>
    </Modal>
  )
}

function ProduceSheet({ recipes, initial, onClose, onDone }) {
  const [recipeId, setRecipeId] = useState(initial?.id || '')
  const [mode, setMode] = useState('batches')
  const [value, setValue] = useState('1')
  const [busy, setBusy] = useState(false)
  const r = recipes.find(x => x.id === recipeId)
  const y = Number(r?.yield_qty || 1)
  const batches = mode === 'batches' ? toNumber(value) : toNumber(value) / y
  async function submit(e) {
    e.preventDefault()
    if (!r || batches <= 0) return
    setBusy(true)
    try {
      const qty = await q(supabase.rpc('produce_recipe', { p_recipe: r.id, p_batches: Math.round(batches * 1000) / 1000 }))
      notify(`${num(qty)} × ${r.name} ajoutés au stock produit`); onDone()
    } catch (err) { notify(err.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="Produire depuis une recette" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Recette">
          <select value={recipeId} onChange={e => setRecipeId(e.target.value)} required>
            <option value="">Choisir…</option>
            {recipes.map(x => <option key={x.id} value={x.id}>{productName(x)}</option>)}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="Compter en">
            <select value={mode} onChange={e => setMode(e.target.value)}><option value="batches">Fournées</option><option value="pieces">Pièces</option></select>
          </Field>
          <Field label={mode === 'batches' ? 'Nombre de fournées' : 'Nombre de pièces'}><input inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} /></Field>
        </div>
        {r && batches > 0 && <p className="muted">Ajoute <b style={{ color: 'var(--ink)' }}>{num(batches * y)} pièces</b> au stock produit.</p>}
        <div className="row end">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy || !r || batches <= 0}>Ajouter au stock</button>
        </div>
      </form>
    </Modal>
  )
}
