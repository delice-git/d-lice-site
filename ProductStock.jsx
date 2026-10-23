import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { eur, fmtDateTime, num } from './format'
import { Empty, ErrorBox, Loading, PageHeader, StockMoveModal } from './ui'
import { notify } from './Toast'

export default function ProductStock({ goTo }) {
  const [move, setMove] = useState(null)
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

  const rows = useMemo(() => (data.data?.recipes || []).map(r => {
    const qty = data.data.stock[r.id] || 0, reserved = data.data.reserved[r.id] || 0
    return { r, qty, reserved, free: qty - reserved }
  }), [data.data])

  if (data.loading && !data.data) return <Loading />
  let lastCat = null

  return (
    <>
      <PageHeader title="Stock produits" subtitle="Produits finis disponibles à l’atelier, avant livraison aux magasins. Une production l’augmente, une livraison le diminue." >
        <button onClick={() => goTo('recipes')}>Produire depuis une recette</button>
      </PageHeader>
      <ErrorBox error={data.error} />
      {!rows.length ? <Empty>Aucune recette active.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Produit</th><th className="num">En stock</th><th className="num">Réservé (commandes)</th><th className="num">Disponible</th><th></th></tr></thead>
            <tbody>
              {rows.flatMap(({ r, qty, reserved, free }) => {
                const out = []
                if (r.category !== lastCat) { lastCat = r.category; out.push(<tr key={'g' + r.id} className="group"><td colSpan={5}>{r.category || 'Sans catégorie'}</td></tr>) }
                out.push(
                  <tr key={r.id} className={free < 0 ? 'out' : ''}>
                    <td><b>{r.name}</b></td>
                    <td className="num"><b>{num(qty)}</b></td>
                    <td className="num">{reserved ? num(reserved) : '—'}</td>
                    <td className="num">{free < 0 ? <b className="ko">{num(free)}</b> : num(free)}</td>
                    <td className="num"><button className="small" onClick={() => setMove({ r, qty })}>Mouvement</button></td>
                  </tr>
                )
                return out
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel" style={{ marginTop: 22 }}>
        <div className="panel-head"><h2>Dernières productions</h2></div>
        {!data.data.batches.length ? <p className="muted">Aucune production enregistrée.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Recette</th><th className="num">Fournées</th><th className="num">Pièces</th><th className="num">Coût matières</th></tr></thead>
              <tbody>
                {data.data.batches.map(b => (
                  <tr key={b.id}>
                    <td>{fmtDateTime(b.created_at)}</td>
                    <td>{b.recipe_name}</td>
                    <td className="num">{num(b.batches)}</td>
                    <td className="num">{num(b.qty)}</td>
                    <td className="num">{eur(b.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {move && (
        <StockMoveModal title={`Stock — ${move.r.name}`} unit="pièces" current={move.qty} onClose={() => setMove(null)}
          onSubmit={async delta => {
            try { await q(supabase.rpc('adjust_product_stock', { p_recipe: move.r.id, p_delta: delta })); notify('Stock produit mis à jour'); data.reload() }
            catch (e) { notify(e.message, 'error'); throw e }
          }} />
      )}
    </>
  )
}
