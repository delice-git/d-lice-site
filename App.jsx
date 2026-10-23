import { useCallback, useEffect, useState } from 'react'
import { supabase, configured } from './supabase'
import { Toaster } from './Toast'
import { Loading } from './ui'
import { ROLE_LABEL } from './format'
import Login from './Login'
import Dashboard from './Dashboard'
import Orders from './Orders'
import Agenda from './Agenda'
import Recipes from './Recipes'
import Articles from './Articles'
import ProductStock from './ProductStock'
import ShopStock from './ShopStock'
import Allergens from './Allergens'
import Users from './Users'

const STAFF_TABS = [
  ['dashboard', 'Tableau de bord', Dashboard],
  ['orders', 'Commandes', Orders],
  ['agenda', 'Agenda', Agenda],
  ['recipes', 'Recettes', Recipes],
  ['articles', 'Stock matières', Articles],
  ['products', 'Stock produits', ProductStock],
  ['shops', 'Stocks magasins', ShopStock],
  ['allergens', 'Allergènes', Allergens],
  ['users', 'Comptes & magasins', Users],
]
const SHOP_TABS = [
  ['shop', 'Mon stock', ShopStock],
  ['orders', 'Commandes', Orders],
  ['allergens', 'Allergènes', Allergens],
]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [shops, setShops] = useState([])
  const [tab, setTab] = useState(null)

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id
  const loadProfile = useCallback(async () => {
    if (!userId) { setProfile(null); return }
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('shops').select('*').order('name'),
    ])
    setProfile(p || { id: userId, email: session?.user?.email, role: 'en_attente' })
    setShops(s || [])
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadProfile() }, [loadProfile])

  if (!configured) return <SetupMissing />
  if (session === undefined || (session && !profile)) return <div className="center-screen"><Loading /></div>
  if (!session) return <><Login /><Toaster /></>

  const logout = () => supabase.auth.signOut()

  if (profile.role === 'en_attente' || (profile.role === 'magasin' && !profile.shop_id)) {
    return (
      <div className="center-screen">
        <div className="panel stack">
          <h2>Compte en attente de validation</h2>
          <p className="muted">
            Le compte {profile.email} existe mais n'a pas encore de rôle
            {profile.role === 'magasin' ? ' (aucun magasin associé)' : ''}.
            La production doit l'activer dans l'onglet « Comptes & magasins ».
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button onClick={loadProfile}>Vérifier à nouveau</button>
            <button onClick={logout}>Se déconnecter</button>
          </div>
        </div>
      </div>
    )
  }

  const isStaff = profile.role === 'production' || profile.role === 'admin'
  const tabs = isStaff ? STAFF_TABS : SHOP_TABS
  const current = tabs.find(t => t[0] === tab) || tabs[0]
  const Page = current[2]
  const myShop = shops.find(s => s.id === profile.shop_id)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">Le Temps<br />d'un Délice</div>
          <div className="brand-sub">{isStaff ? 'Atelier de production' : myShop?.name}</div>
        </div>
        <nav className="nav" aria-label="Navigation principale">
          {tabs.map(([key, label]) => (
            <button key={key} className={current[0] === key ? 'active' : ''} onClick={() => setTab(key)}
                    aria-current={current[0] === key ? 'page' : undefined}>
              {label}
            </button>
          ))}
        </nav>
        <div className="user-box">
          <div>
            <strong>{profile.full_name || profile.email}</strong>
            {ROLE_LABEL[profile.role]}{myShop ? ' · ' + myShop.name : ''}
          </div>
          <button onClick={logout}>Se déconnecter</button>
        </div>
      </aside>
      <main className="main">
        <Page key={current[0]} profile={profile} shops={shops} isStaff={isStaff}
              reloadShops={loadProfile} goTo={setTab} />
      </main>
      <Toaster />
    </div>
  )
}

function SetupMissing() {
  return (
    <div className="center-screen">
      <div className="panel stack" style={{ textAlign: 'left' }}>
        <h2>Connexion à Supabase manquante</h2>
        <p>Ajoutez ces deux variables (fichier <code>.env</code> en local, ou Settings → Environment Variables sur Vercel), puis redéployez :</p>
        <pre style={{ background: '#f1f3ef', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
VITE_SUPABASE_URL=https://xxxx.supabase.co{'\n'}VITE_SUPABASE_ANON_KEY=eyJ...
        </pre>
        <p className="muted">Vous les trouvez dans Supabase → Project Settings → API.</p>
      </div>
    </div>
  )
}
