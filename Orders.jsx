import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { loadCatalogue, allergensOf, productName } from './catalogue'
import { addDaysISO, fmtDate, num, todayISO, toNumber } from './format'
import { AllergenBadges } from './AllergenBadges'
import { Empty, ErrorBox, Field, KindBadge, Loading, Modal, PageHeader, Seg, StatusBadge, STATUS } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'

const ACTIVE = ['en_attente', 'en_production', 'prete']
const NEXT = { en_attente: ['en_production', 'Lancer en production'], en_production: ['prete', 'Marquer prête'], prete: ['livree', 'Livrer'] }

export default function Orders({ profile, shops, isStaff }) {
  const [view, setView] = useState('actives')
  const [shopFilter, setShopFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const cat = useData(loadCatalogue, [])

  const orders = useData(async () => {
    let req = supabase.from('orders').select('*, shops(name), order_items(id, recipe_id, label, quantity)')
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

  const needs = useMemo(() => {
    if (!isStaff || view !== 'actives' || !orders.data || !cat.data || !prodStock.data) return []
    const tot = {}, free = {}
    for (const o of orders.data) for (const it of o.order_items) {
      if (it.recipe_id) tot[it.recipe_id] = (tot[it.recipe_id] || 0) + Number(it.quantity)
      else free[it.label] = (free[it.label] || 0) + Number(it.quantity)
    }
    const freeRows = Object.entries(free).map(([label, ordered]) => ({ id: 'free:' + label, name: label, free: true, ordered }))
    return [...Object.entries(tot).map(([id, ordered]) => {
      const r = recipeById[id]
      const y = Number(r?.yield_qty || 1)
      const stock = prodStock.data[id] || 0
      const missing = Math.max(0, ordered - stock)
      return { id, name: productName(r) || '?', yield: y, ordered, stock, missing, batches: Math.ceil(missing / y) }
    }).filter(n => n.missing > 0).sort((a, b) => b.missing - a.missing), ...freeRows]
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
      const qty = await q(supabase.rpc('produce_recipe', { p_recipe: n.id, p_batches: n.batches }))
      notify(`${num(qty)} × ${n.name} ajoutés au stock produit`)
      prodStock.reload()
    } catch (e) { notify(e.message, 'error') }
  }

  if (cat.loading && !cat.data) return <Loading />
  const today = todayISO()

  return (
    <>
      <PageHeader title="Commandes"
        subtitle={isStaff ? 'Toutes les commandes des magasins, en direct.' : 'Vos commandes envoyées à la production.'}>
        <button className="primary" onClick={() => setShowForm(true)}><Icon name="plus" size={20} />Nouvelle commande</button>
      </PageHeader>
      <ErrorBox error={orders.error || cat.error} />

      <div className="toolbar">
        <Seg value={view} onChange={setView} options={[['actives', 'En cours'], ['historique', 'Historique']]} />
        {isStaff && (
          <select value={shopFilter} onChange={e => setShopFilter(e.target.value)} style={{ width: 'auto', flex: '1 1 180px', maxWidth: 260 }} aria-label="Filtrer par magasin">
            <option value="">Tous les magasins</option>
            {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {needs.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ marginBottom: 10 }}>À produire</h2>
          <div className="list">
            {needs.map(n => (
              n.free ? (
                <div key={n.id} className="item stack-sm">
                  <span className="item-main">
                    <span className="item-title">{n.name}</span>
                    <span className="item-sub">Article libre · à préparer</span>
                  </span>
                  <span className="item-figure"><b>× {num(n.ordered)}</b></span>
                </div>
              ) : (
              <div key={n.id} className="item stack-sm low">
                <span className="item-main">
                  <span className="item-title">{n.name}</span>
                  <span className="item-sub">Commandé {num(n.ordered)} · en stock {num(n.stock)} · <b className="ko">manque {num(n.missing)}</b></span>
                </span>
                <span className="item-side">
                  <button className="small" onClick={() => produce(n)}>Produire {n.batches} fournée{n.batches > 1 ? 's' : ''} ({num(n.batches * n.yield)} pcs)</button>
                </span>
              </div>)
            ))}
          </div>
        </div>
      )}

      {orders.loading && !orders.data ? <Loading /> : !orders.data?.length ? (
        <Empty>{view === 'actives' ? 'Aucune commande en cours.' : 'Aucune commande dans l’historique.'}</Empty>
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
                {isStaff && <span className="badge">{o.shops?.name}</span>}
              </div>
              <div className="order-meta">
                Pour le <b className={ACTIVE.includes(o.status) && o.due_date < today ? 'late' : ''}>{fmtDate(o.due_date)}</b>
                {o.customer_name && <><br />{o.customer_name}{o.customer_phone && <> · <a href={'tel:' + o.customer_phone.replace(/\s/g, '')} style={{ color: 'inherit' }}>{o.customer_phone}</a></>}</>}
              </div>
              <ul className="order-items">
                {o.order_items.map(it => (
                  <li key={it.id}><span>{it.recipe_id ? (productName(recipeById[it.recipe_id]) || 'Produit supprimé') : <>{it.label} <span className="badge" style={{ marginLeft: 4 }}>libre</span></>}</span><b>× {num(it.quantity)}</b></li>
                ))}
              </ul>
              {o.notes && <p className="muted small-text">{o.notes}</p>}
              {ACTIVE.includes(o.status) && (
                <div className="row">
                  {isStaff && NEXT[o.status] && (
                    <button className={o.status === 'prete' ? 'primary small' : 'small'} onClick={() => changeStatus(o, NEXT[o.status][0])}>{NEXT[o.status][1]}</button>
                  )}
                  {isStaff && o.status !== 'prete' && <button className="small ghost" onClick={() => changeStatus(o, 'livree')}>Livrer directement</button>}
                  <span className="spacer" />
                  {(isStaff || o.status === 'en_attente') && (
                    <button className="small danger" onClick={() => confirm(`Annuler la commande n°${o.id} ?`) && changeStatus(o, 'annulee')}>Annuler</button>
                  )}
                </div>
              )}
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
  const [lines, setLines] = useState([{ recipe_id: '', label: '', free: false, quantity: '' }])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const recipes = cat.recipes.filter(r => r.active)
  const setLine = (i, patch) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  async function submit(e) {
    e.preventDefault()
    const items = lines
      .filter(l => toNumber(l.quantity) > 0 && (l.free ? l.label.trim() : l.recipe_id))
      .map(l => (l.free ? { label: l.label.trim(), quantity: toNumber(l.quantity) } : { recipe_id: l.recipe_id, quantity: toNumber(l.quantity) }))
    if (!items.length) return setError('Ajoutez au moins un produit (ou un article libre) avec une quantité.')
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
        <Seg value={kind} onChange={setKind} options={[['reassort', 'Réassort du magasin'], ['client', 'Commande client']]} />
        <div className="grid-2">
          {isStaff ? (
            <Field label="Magasin">
              <select value={shopId} onChange={e => setShopId(e.target.value)} required>
                {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          ) : <Field label="Magasin"><input value={shops.find(s => s.id === shopId)?.name || ''} disabled /></Field>}
          <Field label={kind === 'client' ? 'Retrait par le client le' : 'Livraison souhaitée le'}>
            <input type="date" value={due} min={todayISO()} onChange={e => setDue(e.target.value)} required />
          </Field>
        </div>
        {kind === 'client' && (
          <div className="grid-2">
            <Field label="Nom du client"><input value={customer.name} onChange={e => setCustomer(c => ({ ...c, name: e.target.value }))} autoComplete="off" /></Field>
            <Field label="Téléphone"><input type="tel" value={customer.phone} onChange={e => setCustomer(c => ({ ...c, phone: e.target.value }))} autoComplete="off" /></Field>
          </div>
        )}
        <div className="field">
          <span>Produits</span>
          <div className="lines">
            {lines.map((l, i) => {
              const r = recipes.find(x => x.id === l.recipe_id)
              return (
                <div key={i} className={'line' + (l.free ? ' free' : '')}>
                  {l.free ? (
                    <input className="free-text" autoFocus value={l.label} onChange={e => setLine(i, { label: e.target.value })} placeholder="Article libre, ex. : gâteau 3 étages chocolat" aria-label="Article libre" />
                  ) : (
                    <select value={l.recipe_id} aria-label="Produit"
                      onChange={e => e.target.value === '__free' ? setLine(i, { free: true, recipe_id: '' }) : setLine(i, { recipe_id: e.target.value })}>
                      <option value="">Choisir…</option>
                      {recipes.map(x => <option key={x.id} value={x.id}>{productName(x)}</option>)}
                      <option value="__free">✎ Autre (texte libre)…</option>
                    </select>
                  )}
                  <input className="qty" style={{ width: 80 }} inputMode="decimal" placeholder="Qté" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} aria-label="Quantité" />
                  <button type="button" className="ghost icon" aria-label="Retirer la ligne" disabled={lines.length === 1}
                    onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><Icon name="close" size={20} /></button>
                  {!l.free && r && <AllergenBadges {...allergensOf(r, cat)} compact />}
                </div>
              )
            })}
          </div>
        </div>
        <div className="row">
          <button type="button" style={{ flex: 1 }} onClick={() => setLines(ls => [...ls, { recipe_id: '', label: '', free: false, quantity: '' }])}><Icon name="plus" size={20} />Ajouter un produit</button>
          <button type="button" style={{ flex: 1 }} onClick={() => setLines(ls => [...ls, { recipe_id: '', label: '', free: true, quantity: '' }])}><Icon name="plus" size={20} />Article libre</button>
        </div>
        <p className="muted small-text" style={{ marginTop: -6 }}>Un article libre peut être n’importe quoi (gâteau sur mesure, produit pas encore enregistré…). Il ne compte pas dans les stocks.</p>
        <Field label="Remarque pour la production"><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex. : bien cuites, inscription « Joyeux anniversaire Léa »…" /></Field>
        <div className="row end">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer à la production'}</button>
        </div>
      </form>
    </Modal>
  )
}
