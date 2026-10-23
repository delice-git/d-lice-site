import { supabase } from './supabase'
import { q, useData } from './useData'
import { addDaysISO, fmtDate, num, todayISO } from './format'
import { ErrorBox, KindBadge, Loading, PageHeader, StatusBadge } from './ui'

export default function Dashboard({ profile, goTo }) {
  const today = todayISO(), tomorrow = addDaysISO(1)
  const data = useData(async () => {
    const [orders, articles, stock, recipes] = await Promise.all([
      q(supabase.from('orders').select('id, kind, status, due_date, customer_name, shops(name), order_items(quantity)')
        .in('status', ['en_attente', 'en_production', 'prete']).order('due_date').order('id')),
      q(supabase.from('articles').select('id, name, unit, stock, min_stock').order('name')),
      q(supabase.from('production_stock').select('recipe_id, qty')),
      q(supabase.from('recipes').select('id, name').eq('active', true)),
    ])
    return { orders, articles, stock, recipes }
  }, [])

  if (data.loading && !data.data) return <Loading />
  if (!data.data) return <ErrorBox error={data.error} />
  const { orders, articles, stock, recipes } = data.data
  const waiting = orders.filter(o => o.status === 'en_attente').length
  const dueToday = orders.filter(o => o.due_date <= today).length
  const dueTomorrow = orders.filter(o => o.due_date === tomorrow).length
  const low = articles.filter(a => Number(a.stock) < Number(a.min_stock))
  const recipeName = Object.fromEntries(recipes.map(r => [r.id, r.name]))
  const negative = stock.filter(s => Number(s.qty) < 0 && recipeName[s.recipe_id])
  const hour = new Date().getHours()

  return (
    <>
      <PageHeader title={`${hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'}${profile.full_name && profile.full_name !== profile.email ? ', ' + profile.full_name : ''}`}
        subtitle={new Date().toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />
      <ErrorBox error={data.error} />

      <div className="stats">
        <button className={'stat' + (waiting ? ' alert' : '')} onClick={() => goTo('orders')}><b>{waiting}</b>commande{waiting > 1 ? 's' : ''} à prendre en charge</button>
        <button className={'stat' + (dueToday ? ' alert' : '')} onClick={() => goTo('orders')}><b>{dueToday}</b>à livrer aujourd’hui ou en retard</button>
        <button className="stat" onClick={() => goTo('agenda')}><b>{dueTomorrow}</b>à livrer demain</button>
        <button className={'stat' + (low.length ? ' alert' : '')} onClick={() => goTo('articles')}><b>{low.length}</b>matière{low.length > 1 ? 's' : ''} sous le minimum</button>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head"><h2>Prochaines livraisons</h2><button className="small ghost" onClick={() => goTo('orders')}>Toutes les commandes</button></div>
          {!orders.length ? <p className="muted">Aucune commande en cours.</p> : (
            <ul className="list-plain">
              {orders.slice(0, 8).map(o => (
                <li key={o.id}>
                  <div>
                    <b>n°{o.id} · {o.shops?.name}</b>
                    <div className="muted small-text">{o.customer_name || 'Réassort'} · {num(o.order_items.reduce((s, i) => s + Number(i.quantity), 0))} pièces</div>
                    <div className="row" style={{ gap: 4, marginTop: 4 }}><KindBadge kind={o.kind} /><StatusBadge status={o.status} /></div>
                  </div>
                  <span className={o.due_date < today ? 'ko' : ''} style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.due_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel">
          <div className="panel-head"><h2>À racheter</h2><button className="small ghost" onClick={() => goTo('articles')}>Stock matières</button></div>
          {!low.length ? <p className="ok">Toutes les matières sont au-dessus du minimum.</p> : (
            <ul className="list-plain">
              {low.map(a => (
                <li key={a.id}><span>{a.name}</span><span className="tabular"><b className={Number(a.stock) <= 0 ? 'ko' : ''}>{num(a.stock, 3)}</b> / {num(a.min_stock, 3)} {a.unit}</span></li>
              ))}
            </ul>
          )}
          {negative.length > 0 && (
            <>
              <h3 style={{ margin: '18px 0 6px' }}>Stock produit négatif</h3>
              <p className="muted small-text" style={{ marginBottom: 6 }}>Des livraisons ont été faites sans stock suffisant : corrigez par un inventaire.</p>
              <ul className="list-plain">
                {negative.map(s => <li key={s.recipe_id}><span>{recipeName[s.recipe_id]}</span><b className="ko">{num(s.qty)}</b></li>)}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  )
}
