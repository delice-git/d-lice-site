import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { eur, fmtDateTime, num, toNumber } from './format'
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, SearchBox, StockMoveModal } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'

export default function ProductStock() {
  const [move, setMove] = useState(null)
  const [producing, setProducing] = useState(null)
  const [search, setSearch] = useState('')
  const data = useData(async () => {
    const [recipes, stock, orders, batches] = await Promise.all([
      q(supabase.from('recipes').select('id, name, category, yield_qty, active').eq('active', true).order('category').order('name')),
      q(supabase.from('production_stock').select('*')),
      q(supabase.from('orders').select('id, order_items(recipe_id, quantity)').in('status', ['en_attente', 'en_production', 'prete'])),
      q(supabase.from('production_batches').select('*').order('created_at', { ascending: false }).limit(25)),
    ])
    const reserved = {}
    for (const o of orders) for (const it of o.order_items) reserved[it.recipe_id] = (reserved[it.recipe_id] || 0) + Number(it.quantity)
    return { recipes, stock: Object.fromEntries(stock.map(s => [s.recipe_id, Number(s.qty)])), reserved, batches }
  }, [])

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (data.data?.recipes || []).filter(r => !s || r.name.toLowerCase().includes(s)).map(r => {
      const qty = data.data.stock[r.id] || 0, reserved = data.data.reserved[r.id] || 0
      return { r, qty, reserved, free: qty - reserved }
    })
  }, [data.data, search])

  if (data.loading && !data.data) return <Loading />
  let lastCat = null

  return (
    <>
      <PageHeader title="Stock produits" subtitle="Produits finis prêts à l’atelier. Une production l’augmente, une livraison le diminue.">
        <button className="primary" onClick={() => setProducing({})}><Icon name="plus" size={20} />Enregistrer une production</button>
      </PageHeader>
      <ErrorBox error={data.error} />
      <div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Rechercher un produit…" /></div>
      {!rows.length ? <Empty>Aucune recette active.</Empty> : (
        <div className="list">
          {rows.map(({ r, qty, reserved, free }) => {
            const out = []
            if (r.category !== lastCat) { lastCat = r.category; out.push(<div key={'g' + r.id} className="list-group">{r.category || 'Sans catégorie'}</div>) }
            out.push(
              <div key={r.id} className={'item stack-sm' + (free < 0 ? ' out' : '')}>
                <button className="item-main tap" onClick={() => setMove({ r, qty })}>
                  <span className="item-title">{r.name}</span>
                  <span className="item-sub">{reserved ? `${num(reserved)} réservé${reserved > 1 ? 's' : ''} · ` : ''}disponible {free < 0 ? <b className="ko">{num(free)}</b> : num(free)}</span>
                </button>
                <div className="item-side">
                  <span className="item-figure"><b>{num(qty)}</b><span>en stock</span></span>
                  <button className="small" onClick={() => setProducing({ recipe: r })}>Produire</button>
                </div>
              </div>
            )
            return out
          })}
        </div>
      )}

      <h2 style={{ margin: '26px 0 10px' }}>Dernières productions</h2>
      {!data.data.batches.length ? <p className="muted">Aucune production enregistrée.</p> : (
        <div className="list">
          {data.data.batches.map(b => (
            <div key={b.id} className="item">
              <span className="item-main">
                <span className="item-title">{b.recipe_name}</span>
                <span className="item-sub">{fmtDateTime(b.created_at)} · {num(b.batches)} fournée{b.batches > 1 ? 's' : ''} · coût {eur(b.cost)}</span>
              </span>
              <span className="item-figure"><b className="ok">+{num(b.qty)}</b><span>pièces</span></span>
            </div>
          ))}
        </div>
      )}

      {move && (
        <StockMoveModal title={move.r.name} unit="pièces" current={move.qty} onClose={() => setMove(null)}
          onSubmit={async delta => {
            try { await q(supabase.rpc('adjust_product_stock', { p_recipe: move.r.id, p_delta: delta })); notify('Stock produit mis à jour'); data.reload() }
            catch (e) { notify(e.message, 'error'); throw e }
          }} />
      )}
      {producing && <ProduceSheet recipes={data.data.recipes} initial={producing.recipe} onClose={() => setProducing(null)} onDone={() => { setProducing(null); data.reload() }} />}
    </>
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
    <Modal title="Enregistrer une production" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Recette">
          <select value={recipeId} onChange={e => setRecipeId(e.target.value)} required>
            <option value="">Choisir…</option>
            {recipes.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="Compter en">
            <select value={mode} onChange={e => setMode(e.target.value)}><option value="batches">Fournées</option><option value="pieces">Pièces</option></select>
          </Field>
          <Field label={mode === 'batches' ? 'Nombre de fournées' : 'Nombre de pièces'}><input inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} /></Field>
        </div>
        {r && batches > 0 && <p className="muted">Ajoute <b style={{ color: 'var(--ink)' }}>{num(batches * y)} pièces</b> au stock produit ({num(batches, 3)} fournée{batches > 1 ? 's' : ''} de {num(y)}).</p>}
        <div className="row end">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy || !r || batches <= 0}>Ajouter au stock</button>
        </div>
      </form>
    </Modal>
  )
}
