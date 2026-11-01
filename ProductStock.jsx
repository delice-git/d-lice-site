import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { eur, fmtDateTime, num, toNumber } from './format'
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, QtyCell, SearchBox } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'
import { productName, groupByCategory, loadCategories, fmtOf, formatLabel } from './catalogue'
import { CategoryBar, CategoryManager, CategorySelect, FormatPicker, useCatFilter } from './categories'

// Ajoute une catégorie tapée à la main à la liste (si la table existe)
async function ensureCategory(name, categories) {
  if (!name || categories.some(c => c.name === name)) return
  await supabase.from('categories').upsert({ name, position: categories.length + 1 }, { onConflict: 'name', ignoreDuplicates: true })
}

export default function ProductStock() {
  const [producing, setProducing] = useState(null)
  const [editing, setEditing] = useState(null) // produit | {} pour un nouveau
  const [managing, setManaging] = useState(false)
  const [search, setSearch] = useState('')
  const filter = useCatFilter('stock-produits')
  const data = useData(async () => {
    const [recipes, stock, orders, batches, items, categories] = await Promise.all([
      q(supabase.from('recipes').select('*').eq('active', true).order('name')),
      q(supabase.from('production_stock').select('*')),
      q(supabase.from('orders').select('id, order_items(recipe_id, quantity)').in('status', ['en_attente', 'en_production', 'prete'])),
      q(supabase.from('production_batches').select('*').order('created_at', { ascending: false }).limit(25)),
      q(supabase.from('recipe_items').select('recipe_id')),
      loadCategories(),
    ])
    const reserved = {}
    for (const o of orders) for (const it of o.order_items || []) if (it.recipe_id) reserved[it.recipe_id] = (reserved[it.recipe_id] || 0) + Number(it.quantity)
    const withRecipe = new Set(items.map(i => i.recipe_id))
    return { recipes, stock: Object.fromEntries(stock.map(s => [s.recipe_id, Number(s.qty)])), reserved, batches, withRecipe, categories }
  }, [])

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (data.data?.recipes || []).filter(r => !s || productName(r).toLowerCase().includes(s) || (r.category || '').toLowerCase().includes(s)).map(r => {
      const qty = data.data.stock[r.id] || 0, reserved = data.data.reserved[r.id] || 0
      return { r, qty, reserved, free: qty - reserved, hasRecipe: data.data.withRecipe.has(r.id) }
    })
  }, [data.data, search])
  const allGroups = useMemo(() => groupByCategory(rows.filter(x => !filter.format || (fmtOf(x.r) || 'piece') === filter.format), x => x.r.category, data.data?.categories), [rows, filter.format, data.data])
  const groups = allGroups.filter(g => !filter.cat || g.name === filter.cat)
  const formats = [...new Set(rows.map(x => fmtOf(x.r) || 'piece'))]

  async function adjust(recipeId, delta) {
    try {
      const qty = await q(supabase.rpc('adjust_product_stock', { p_recipe: recipeId, p_delta: delta }))
      data.setData(d => ({ ...d, stock: { ...d.stock, [recipeId]: Number(qty) } }))
    } catch (e) { notify(e.message, 'error') }
  }

  if (data.loading && !data.data) return <Loading />

  return (
    <>
      <PageHeader title="Stock produits" subtitle="Produits finis à l’atelier. Touchez un nom pour tout modifier (nom, catégorie, format, prix, quantité) ou le supprimer.">
        <button className="primary" onClick={() => setEditing({})}><Icon name="plus" size={20} />Nouveau produit</button>
        <button onClick={() => setProducing({})}>Produire depuis une recette</button>
      </PageHeader>
      <ErrorBox error={data.error} />
      <div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Rechercher un produit…" /></div>
      <CategoryBar groups={allGroups} value={filter.cat} onChange={filter.setCat}
        formats={formats} format={filter.format} onFormat={filter.setFormat} onManage={() => setManaging(true)} />

      {!groups.length ? <Empty>{rows.length ? 'Aucun produit pour ce filtre.' : 'Aucun produit. Ajoutez-en avec « Nouveau produit », pas besoin de recette.'}</Empty> : (
        <div className="table-wrap stock">
          <table className="stock-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th className="c">En stock</th>
                <th className="r hide-sm">Réservé</th>
                <th className="r">Dispo.</th>
                <th className="r"></th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap(g => [
                <tr key={'g' + g.name} className="grp"><td colSpan={5}>{g.label} <span className="muted small-text">· {g.items.length}</span></td></tr>,
                ...g.items.map(({ r, qty, reserved, free, hasRecipe }) => (
                  <tr key={r.id} className={free < 0 ? 'out' : ''}>
                    <td>
                      <button className="name" onClick={() => setEditing({ ...r, qty })}>{r.name}</button>
                      <span className="sub">
                        {formatLabel(r) && <span className="badge" style={{ marginRight: 6 }}>{formatLabel(r)}</span>}
                        {Number(r.sale_price) ? eur(r.sale_price) : ''}{!hasRecipe ? `${Number(r.sale_price) ? ' · ' : ''}sans recette` : ''}
                      </span>
                    </td>
                    <td className="c">
                      <QtyCell value={qty} label={productName(r)} onStep={d => adjust(r.id, d)} onSet={n => adjust(r.id, n - qty)} />
                    </td>
                    <td className="r hide-sm">{reserved ? num(reserved) : '—'}</td>
                    <td className="r">{free < 0 ? <span className="state-ko">{num(free)}</span> : <b>{num(free)}</b>}</td>
                    <td className="r">
                      <button className="small ghost" onClick={() => setEditing({ ...r, qty })} aria-label={`Modifier ${productName(r)}`}>Modifier</button>
                    </td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small-text" style={{ marginTop: 10 }}>Réservé = quantités demandées dans les commandes en cours. Dispo. = en stock − réservé.</p>

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

      {editing && <ProductForm product={editing} categories={data.data.categories} defaultCat={filter.cat}
        onClose={() => setEditing(null)} onDone={() => { setEditing(null); data.reload() }} />}
      {managing && <CategoryManager categories={data.data.categories} onClose={() => setManaging(false)} reload={data.reload} />}
      {producing && <ProduceSheet recipes={data.data.recipes.filter(r => data.data.withRecipe.has(r.id))} initial={producing.recipe}
        onClose={() => setProducing(null)} onDone={() => { setProducing(null); data.reload() }} />}
    </>
  )
}

// Créer ou modifier un produit : tout se change ici, y compris la suppression
function ProductForm({ product, categories, defaultCat, onClose, onDone }) {
  const isNew = !product.id
  const [f, setF] = useState({
    name: product.name || '', category: product.category ?? defaultCat ?? categories[0]?.name ?? null,
    sale_price: product.sale_price ? String(Number(product.sale_price)) : '', qty: String(product.qty ?? ''),
    format: fmtOf(product), servings: product.servings || null, bac_size: product.bac_size || null,
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = p => setF(x => ({ ...x, ...p }))

  async function submit(e) {
    e.preventDefault()
    if (!f.name.trim()) return setError('Donnez un nom au produit.')
    setBusy(true); setError(null)
    const fields = {
      name: f.name.trim(), category: f.category || null, sale_price: toNumber(f.sale_price),
      format: f.format || null, servings: f.format === 'gateau' || f.format === 'cadre' ? f.servings : null,
      bac_size: f.format === 'bac' ? f.bac_size || 'entier' : null,
    }
    try {
      await ensureCategory(fields.category, categories)
      let id = product.id
      if (isNew) {
        id = await q(supabase.rpc('save_recipe', { p_id: null, p_recipe: { ...fields, yield_qty: 1, extra_allergens: [], traces: [], active: true }, p_items: [] }))
      } else {
        await q(supabase.from('recipes').update(fields).eq('id', id))
      }
      const target = toNumber(f.qty), before = isNew ? 0 : Number(product.qty || 0)
      if (f.qty !== '' && target !== before) await q(supabase.rpc('adjust_product_stock', { p_recipe: id, p_delta: target - before }))
      notify(isNew ? `${fields.name} ajouté` : 'Produit enregistré'); onDone()
    } catch (err) {
      setError(/column .*(format|bac_size)/i.test(err.message) ? 'Lancez d’abord la mise à jour SQL « formats-categories » dans Supabase.' : err.message)
    } finally { setBusy(false) }
  }

  async function remove() {
    if (!confirm(`Supprimer « ${productName(product)} » ?\nS’il a déjà été commandé, il sera retiré mais gardé dans l’historique des commandes.`)) return
    setBusy(true)
    try {
      let res
      try { res = await q(supabase.rpc('delete_product', { p_id: product.id })) }
      catch { await q(supabase.from('recipes').update({ active: false }).eq('id', product.id)); res = 'archive' }
      notify(res === 'supprime' ? 'Produit supprimé' : 'Produit retiré (gardé dans l’historique des commandes)'); onDone()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={isNew ? 'Nouveau produit' : productName(product)} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        {isNew && <p className="muted small-text">Pas besoin de recette : le produit peut tout de suite être commandé par les magasins. Sa recette et ses allergènes s’ajoutent plus tard dans « Recettes ».</p>}
        <div className="grid-2">
          <Field label="Nom"><input autoFocus={isNew} value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Ex. : Tarte au riz" /></Field>
          <Field label="Catégorie"><CategorySelect value={f.category} onChange={v => set({ category: v })} categories={categories} /></Field>
        </div>
        <div className="field">
          <span>Format</span>
          <FormatPicker value={f} onChange={p => set(p)} />
        </div>
        <div className="grid-2">
          <Field label="Quantité en stock" hint={isNew ? '' : 'Tapez la quantité réelle : le stock est corrigé.'}>
            <input inputMode="decimal" value={f.qty} onChange={e => set({ qty: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Prix de vente TTC (€, facultatif)"><input inputMode="decimal" value={f.sale_price} onChange={e => set({ sale_price: e.target.value })} /></Field>
        </div>
        <div className="row">
          {!isNew && <button type="button" className="danger" onClick={remove} disabled={busy}>Supprimer</button>}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy}>{isNew ? 'Ajouter le produit' : 'Enregistrer'}</button>
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
