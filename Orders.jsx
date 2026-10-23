import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { loadCatalogue, allergensOf } from './catalogue'
import { addDaysISO, fmtDate, num, todayISO, toNumber } from './format'
import { AllergenBadges } from './AllergenBadges'
import { Empty, ErrorBox, Field, KindBadge, Loading, Modal, PageHeader, StatusBadge, STATUS } from './ui'
import { notify } from './Toast'

const ACTIVE = ['en_attente', 'en_production', 'prete']
const NEXT = { en_attente: ['en_production', 'Lancer en production'], en_production: ['prete', 'Marquer prête'], prete: ['livree', 'Livrer'] }

export default function Orders({ profile, shops, isStaff }) {
  const [view, setView] = useState('actives')
  const [shopFilter, setShopFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const cat = useData(loadCatalogue, [])

  const orders = useData(async () => {
    let req = supabase.from('orders').select('*, shops(name), order_items(id, recipe_id, quantity)')
    req = view === 'actives'
      ? req.in('status', ACTIVE).order('due_date').order('id')
      : req.in('status', ['livree', 'annulee']).order('due_date', { ascending: false }).order('id', { ascending: false }).limit(150)
    if (shopFilter) req = req.eq('shop_id', shopFilter)
    return q(req)
  }, [view, shopFilter])

  const prodStock = useData(async () => {
    const rows = await q(supabase.from('production_stock').select('*'))
    return Object.fromEntries(rows.map(r => [r.recipe_id, Number(r.qty)]))
  }, [])

  const reloadOrders = orders.reload
  useEffect(() => {
    const ch = supabase.channel('orders-live-' + Math.random())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => reloadOrders())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [reloadOrders])

  const recipeById = useMemo(() => Object.fromEntries((cat.data?.recipes || []).map(r => [r.id, r])), [cat.data])

  // Besoin de production : total des commandes actives par produit, comparé au stock produit
  const needs = useMemo(() => {
    if (!isStaff || view !== 'actives' || !orders.data || !cat.data || !prodStock.data) return []
    const tot = {}
    for (const o of orders.data) for (const it of o.order_items) tot[it.recipe_id] = (tot[it.recipe_id] || 0) + Number(it.quantity)
    return Object.entries(tot).map(([id, ordered]) => {
      const r = recipeById[id]
      const stock = prodStock.data[id] || 0
      const missing = Math.max(0, ordered - stock)
      return { id, name: r?.name || '?', yield: Number(r?.yield_qty || 1), ordered, stock, missing, batches: Math.ceil(missing / Number(r?.yield_qty || 1)) }
    }).sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name))
  }, [isStaff, view, orders.data, cat.data, prodStock.data, recipeById])

  async function changeStatus(o, status) {
    try {
      if (status === 'livree') {
        try { await q(supabase.rpc('deliver_order', { p_order: o.id })) }
        catch (e) {
          if (!/insuffisant/i.test(e.message) || !confirm(e.message + '\n\nLivrer quand même ? Le stock produit passera en négatif.')) throw e
          await q(supabase.rpc('deliver_order', { p_order: o.id, p_allow_negative: true }))
        }
      } else {
        await q(supabase.from('orders').update({ status }).eq('id', o.id))
      }
      notify(`Commande n°${o.id} : ${STATUS[status].toLowerCase()}`)
      orders.reload(); prodStock.reload()
    } catch (e) { notify(e.message, 'error') }
  }

  async function produce(n) {
    try {
      let qty
      try { qty = await q(supabase.rpc('produce_recipe', { p_recipe: n.id, p_batches: n.batches })) }
      catch (e) {
        if (!/insuffisant/i.test(e.message) || !confirm(e.message + '\n\nProduire quand même ? Le stock matières passera en négatif.')) throw e
        qty = await q(supabase.rpc('produce_recipe', { p_recipe: n.id, p_batches: n.batches, p_allow_negative: true }))
      }
      notify(`${num(qty)} × ${n.name} ajoutés au stock produit`)
      prodStock.reload()
    } catch (e) { notify(e.message, 'error') }
  }

  if (cat.loading && !cat.data) return <Loading />
  const today = todayISO()

  return (
    <>
      <PageHeader title="Commandes"
        subtitle={isStaff ? 'Toutes les commandes des magasins. Elles arrivent ici en direct.' : 'Vos commandes envoyées à la production.'}>
        <button className="primary" onClick={() => setShowForm(true)}>Nouvelle commande</button>
      </PageHeader>
      <ErrorBox error={orders.error || cat.error} />

      <div className="row" style={{ marginBottom: 16 }}>
        <div className="tabs">
          <button className={view === 'actives' ? 'active' : ''} onClick={() => setView('actives')}>En cours</button>
          <button className={view === 'historique' ? 'active' : ''} onClick={() => setView('historique')}>Historique</button>
        </div>
        {isStaff && (
          <select value={shopFilter} onChange={e => setShopFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Filtrer par magasin">
            <option value="">Tous les magasins</option>
            {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {needs.length > 0 && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-head">
            <h2>À produire pour honorer les commandes</h2>
            <span className="muted small-text">Commandé − stock produit disponible</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Produit</th><th className="num">Commandé</th><th className="num">En stock</th><th className="num">Manque</th><th className="num">Fournées</th><th></th></tr></thead>
              <tbody>
                {needs.map(n => (
                  <tr key={n.id} className={n.missing > 0 ? 'low' : ''}>
                    <td><b>{n.name}</b></td>
                    <td className="num">{num(n.ordered)}</td>
                    <td className="num">{num(n.stock)}</td>
                    <td className="num">{n.missing > 0 ? <b className="ko">{num(n.missing)}</b> : <span className="ok">OK</span>}</td>
                    <td className="num">{n.batches > 0 ? `${n.batches} (${num(n.batches * n.yield)} pcs)` : '—'}</td>
                    <td className="num">{n.batches > 0 && <button className="small" onClick={() => produce(n)}>Produire {n.batches} fournée{n.batches > 1 ? 's' : ''}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {orders.loading && !orders.data ? <Loading /> : !orders.data?.length ? (
        <Empty>{view === 'actives' ? 'Aucune commande en cours. Créez-en une avec « Nouvelle commande ».' : 'Aucune commande dans l’historique.'}</Empty>
      ) : (
        <div className="order-list">
          {orders.data.map(o => (
            <article key={o.id} className={'order s-' + o.status}>
              <div className="order-top">
                <span className="order-no">n°{o.id}</span>
                <StatusBadge status={o.status} />
              </div>
              <div className="row" style={{ gap: 6 }}>
                <KindBadge kind={o.kind} />
                {isStaff && <span className="badge" style={{ background: '#eef0ec' }}>{o.shops?.name}</span>}
              </div>
              <div className="order-meta">
                Pour le <span className={ACTIVE.includes(o.status) && o.due_date < today ? 'late' : ''}><b>{fmtDate(o.due_date)}</b></span>
                {o.customer_name && <> · {o.customer_name}{o.customer_phone ? ` (${o.customer_phone})` : ''}</>}
              </div>
              <ul className="order-items">
                {o.order_items.map(it => (
                  <li key={it.id}><span>{recipeById[it.recipe_id]?.name || 'Produit supprimé'}</span><b>× {num(it.quantity)}</b></li>
                ))}
              </ul>
              {o.notes && <p className="muted small-text">{o.notes}</p>}
              <div className="row">
                {isStaff && NEXT[o.status] && (
                  <button className={o.status === 'prete' ? 'primary small' : 'small'} onClick={() => changeStatus(o, NEXT[o.status][0])}>{NEXT[o.status][1]}</button>
                )}
                {isStaff && o.status !== 'prete' && ACTIVE.includes(o.status) && (
                  <button className="small" onClick={() => changeStatus(o, 'livree')}>Livrer directement</button>
                )}
                <span className="spacer" />
                {ACTIVE.includes(o.status) && (isStaff || o.status === 'en_attente') && (
                  <button className="small danger" onClick={() => confirm(`Annuler la commande n°${o.id} ?`) && changeStatus(o, 'annulee')}>Annuler</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {showForm && cat.data && (
        <OrderForm profile={profile} shops={shops} isStaff={isStaff} cat={cat.data}
          onClose={() => setShowForm(false)}
          onSaved={id => { setShowForm(false); notify(`Commande n°${id} envoyée à la production`); orders.reload() }} />
      )}
    </>
  )
}

function OrderForm({ profile, shops, isStaff, cat, onClose, onSaved }) {
  const [kind, setKind] = useState('reassort')
  const [shopId, setShopId] = useState(isStaff ? shops[0]?.id || '' : profile.shop_id)
  const [due, setDue] = useState(addDaysISO(1))
  const [customer, setCustomer] = useState({ name: '', phone: '' })
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([{ recipe_id: '', quantity: '' }])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const recipes = cat.recipes.filter(r => r.active)

  const setLine = (i, patch) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  async function submit(e) {
    e.preventDefault()
    const items = lines.filter(l => l.recipe_id && toNumber(l.quantity) > 0).map(l => ({ recipe_id: l.recipe_id, quantity: toNumber(l.quantity) }))
    if (!items.length) return setError('Ajoutez au moins un produit avec une quantité.')
    if (kind === 'client' && !customer.name.trim()) return setError('Indiquez le nom du client.')
    setBusy(true); setError(null)
    try {
      const id = await q(supabase.rpc('create_order', {
        p_shop: shopId, p_kind: kind, p_due: due, p_items: items,
        p_customer_name: kind === 'client' ? customer.name : null,
        p_customer_phone: kind === 'client' ? customer.phone : null,
        p_notes: notes || null,
      }))
      onSaved(id)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Nouvelle commande" onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <div className="tabs">
          <button type="button" className={kind === 'reassort' ? 'active' : ''} onClick={() => setKind('reassort')}>Réassort du magasin</button>
          <button type="button" className={kind === 'client' ? 'active' : ''} onClick={() => setKind('client')}>Commande d'un client</button>
        </div>
        <div className="grid-2">
          {isStaff ? (
            <Field label="Magasin">
              <select value={shopId} onChange={e => setShopId(e.target.value)} required>
                {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Magasin"><input value={shops.find(s => s.id === shopId)?.name || ''} disabled /></Field>
          )}
          <Field label={kind === 'client' ? 'Retrait par le client le' : 'Livraison souhaitée le'}>
            <input type="date" value={due} min={todayISO()} onChange={e => setDue(e.target.value)} required />
          </Field>
        </div>
        {kind === 'client' && (
          <div className="grid-2">
            <Field label="Nom du client"><input value={customer.name} onChange={e => setCustomer(c => ({ ...c, name: e.target.value }))} /></Field>
            <Field label="Téléphone"><input type="tel" value={customer.phone} onChange={e => setCustomer(c => ({ ...c, phone: e.target.value }))} /></Field>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead><tr><th>Produit</th><th>Allergènes</th><th className="num">Quantité</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const r = recipes.find(x => x.id === l.recipe_id)
                const alg = r ? allergensOf(r, cat) : null
                return (
                  <tr key={i}>
                    <td style={{ minWidth: 200 }}>
                      <select value={l.recipe_id} onChange={e => setLine(i, { recipe_id: e.target.value })} aria-label="Produit">
                        <option value="">Choisir un produit…</option>
                        {recipes.map(x => <option key={x.id} value={x.id}>{x.name}{x.category ? ` — ${x.category}` : ''}</option>)}
                      </select>
                    </td>
                    <td>{alg && <AllergenBadges {...alg} compact />}</td>
                    <td className="num"><input className="qty" inputMode="decimal" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} aria-label="Quantité" /></td>
                    <td className="num">{lines.length > 1 && <button type="button" className="ghost square" aria-label="Retirer la ligne" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>×</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div><button type="button" onClick={() => setLines(ls => [...ls, { recipe_id: '', quantity: '' }])}>Ajouter un produit</button></div>
        <Field label="Remarque pour la production"><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex. : bien cuites, gâteau avec inscription « Joyeux anniversaire Léa »…" /></Field>
        <div className="row end">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer à la production'}</button>
        </div>
      </form>
    </Modal>
  )
}
