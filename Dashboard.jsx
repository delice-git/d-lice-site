import { supabase } from './supabase'
import { q, useData } from './useData'
import { addDaysISO, fmtDate, num, todayISO } from './format'
import { ErrorBox, KindBadge, Loading, PageHeader, StatusBadge } from './ui'

export default function Dashboard({ profile, goTo }) {
  const today = todayISO(), tomorrow = addDaysISO(1)
  const data = useData(async () => {
    const [orders, articles] = await Promise.all([
      q(supabase.from('orders').select('id, kind, status, due_date, customer_name, shops(name), order_items(quantity)')
        .in('status', ['en_attente', 'en_production', 'prete']).order('due_date').order('id')),
      q(supabase.from('articles').select('id, name, unit, stock, min_stock').order('name')),
    ])
    return { orders, articles }
  }, [])

  if (data.loading && !data.data) return <Loading />
  if (!data.data) return <ErrorBox error={data.error} />
  const { orders, articles } = data.data
  const waiting = orders.filter(o => o.status === 'en_attente').length
  const dueToday = orders.filter(o => o.due_date <= today).length
  const dueTomorrow = orders.filter(o => o.due_date === tomorrow).length
  const low = articles.filter(a => Number(a.stock) < Number(a.min_stock))
  const hour = new Date().getHours()
  const name = profile.full_name && profile.full_name !== profile.email ? ', ' + profile.full_name : ''

  return (
    <>
      <PageHeader title={`${hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'}${name}`}
        subtitle={new Date().toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })} />
      <div className="stats">
        <button className={'stat' + (waiting ? ' alert' : '')} onClick={() => goTo('orders')}><b>{waiting}</b>à prendre en charge</button>
        <button className={'stat' + (dueToday ? ' alert' : '')} onClick={() => goTo('orders')}><b>{dueToday}</b>à livrer aujourd’hui</button>
        <button className="stat" onClick={() => goTo('agenda')}><b>{dueTomorrow}</b>à livrer demain</button>
        <button className={'stat' + (low.length ? ' alert' : '')} onClick={() => goTo('articles')}><b>{low.length}</b>matière{low.length > 1 ? 's' : ''} à racheter</button>
      </div>

      <div className="two-col">
        <div>
          <div className="panel-head"><h2>Prochaines livraisons</h2><button className="small ghost" onClick={() => goTo('orders')}>Tout voir</button></div>
          <div className="list">
            {!orders.length && <div className="item-empty">Aucune commande en cours.</div>}
            {orders.slice(0, 8).map(o => (
              <button key={o.id} className="item" style={{ width: '100%', border: 0, borderBottom: '1px solid var(--line)', borderRadius: 0, textAlign: 'left', whiteSpace: 'normal', fontWeight: 400 }} onClick={() => goTo('orders')}>
                <span className="item-main">
                  <span className="item-title">n°{o.id} · {o.shops?.name}</span>
                  <span className="item-sub">{o.customer_name || 'Réassort'} · {num(o.order_items.reduce((s, i) => s + Number(i.quantity), 0))} pièces</span>
                  <span className="row" style={{ gap: 4 }}><KindBadge kind={o.kind} /><StatusBadge status={o.status} /></span>
                </span>
                <span className={o.due_date < today ? 'ko' : 'muted'} style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.due_date)}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="panel-head"><h2>À racheter</h2><button className="small ghost" onClick={() => goTo('articles')}>Stock matières</button></div>
          <div className="list">
            {!low.length && <div className="item-empty ok">Toutes les matières sont au-dessus du minimum.</div>}
            {low.map(a => (
              <div key={a.id} className={'item' + (Number(a.stock) <= 0 ? ' out' : ' low')}>
                <span className="item-main"><span className="item-title">{a.name}</span></span>
                <span className="item-figure"><b>{num(a.stock, 3)}</b><span>min. {num(a.min_stock, 3)} {a.unit}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
