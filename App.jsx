import { useCallback, useEffect, useState } from 'react'
import { supabase, configured } from './supabase'
import { Toaster } from './Toast'
import { Loading, Modal, ThemePicker } from './ui'
import { Icon } from './icons'
import { applyTheme, getTheme } from './themes'
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

// [clé, libellé, libellé court, icône, page, dans la barre du bas sur téléphone]
const STAFF_TABS = [
  ['dashboard', 'Tableau de bord', 'Accueil', 'home', Dashboard, true],
  ['orders', 'Commandes', 'Commandes', 'orders', Orders, true],
  ['recipes', 'Recettes', 'Recettes', 'book', Recipes, true],
  ['agenda', 'Agenda', 'Agenda', 'calendar', Agenda, true],
  ['products', 'Stock produits', 'Produits', 'bread', ProductStock, false],
  ['articles', 'Stock matières', 'Matières', 'box', Articles, false],
  ['shops', 'Stocks magasins', 'Magasins', 'store', ShopStock, false],
  ['allergens', 'Allergènes', 'Allergènes', 'leaf', Allergens, false],
  ['users', 'Comptes & magasins', 'Comptes', 'users', Users, false],
]
const SHOP_TABS = [
  ['shop', 'Mon stock', 'Stock', 'box', ShopStock, true],
  ['orders', 'Commandes', 'Commandes', 'orders', Orders, true],
  ['allergens', 'Allergènes', 'Allergènes', 'leaf', Allergens, true],
]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [shops, setShops] = useState([])
  const [tab, setTab] = useState(null)
  const [theme, setTheme] = useState(getTheme)
  const [moreOpen, setMoreOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)

  useEffect(() => { applyTheme(theme) }, [theme])

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

  const go = key => { setTab(key); setMoreOpen(false); window.scrollTo(0, 0) }

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
            Le compte {profile.email} n’a pas encore de rôle{profile.role === 'magasin' ? ' (aucun magasin associé)' : ''}.
            La production doit l’activer dans « Comptes & magasins ».
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
  const Page = current[4]
  const myShop = shops.find(s => s.id === profile.shop_id)
  const place = isStaff ? 'Atelier de production' : myShop?.name
  const secondary = tabs.filter(t => !t[5])
  const moreActive = !current[5]

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">Le Temps<br />d’un Délice</div>
          <div className="brand-sub">{place}</div>
        </div>
        <nav className="nav" aria-label="Navigation principale">
          {tabs.map(([key, label, , icon]) => (
            <button key={key} className={current[0] === key ? 'active' : ''} onClick={() => go(key)} aria-current={current[0] === key ? 'page' : undefined}>
              <Icon name={icon} size={20} />{label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <strong>{profile.full_name || profile.email}</strong>
            {ROLE_LABEL[profile.role]}{myShop ? ' · ' + myShop.name : ''}
          </div>
          <button onClick={() => setThemeOpen(true)}><Icon name="palette" size={20} />Thème</button>
          <button onClick={logout}><Icon name="logout" size={20} />Se déconnecter</button>
        </div>
      </aside>

      <header className="topbar">
        <div className="t-brand">Le Temps d’un Délice<small>{place}</small></div>
        <button className="icon" onClick={() => setThemeOpen(true)} aria-label="Changer de thème"><Icon name="palette" /></button>
      </header>

      <main className="main">
        <Page key={current[0]} profile={profile} shops={shops} isStaff={isStaff} reloadShops={loadProfile} goTo={go} />
      </main>

      <nav className="bottomnav" aria-label="Navigation">
        {tabs.filter(t => t[5]).map(([key, , short, icon]) => (
          <button key={key} className={current[0] === key ? 'active' : ''} onClick={() => go(key)} aria-current={current[0] === key ? 'page' : undefined}>
            <span className="ic"><Icon name={icon} /></span>{short}
          </button>
        ))}
        <button className={moreActive ? 'active' : ''} onClick={() => setMoreOpen(true)}>
          <span className="ic"><Icon name="more" /></span>{moreActive ? current[2] : 'Plus'}
        </button>
      </nav>

      {moreOpen && (
        <Modal title="Menu" onClose={() => setMoreOpen(false)}>
          {secondary.length > 0 && (
            <div className="menu-list">
              {secondary.map(([key, label, , icon]) => (
                <button key={key} className={current[0] === key ? 'active' : ''} onClick={() => go(key)}>
                  <Icon name={icon} />{label}
                </button>
              ))}
            </div>
          )}
          <p className="menu-title">Thème</p>
          <ThemePicker value={theme} onChange={setTheme} />
          <p className="menu-title">Compte</p>
          <div className="menu-list">
            <p className="muted small-text" style={{ padding: '0 10px 8px' }}>
              {profile.full_name || profile.email} · {ROLE_LABEL[profile.role]}{myShop ? ' · ' + myShop.name : ''}
            </p>
            <button onClick={logout}><Icon name="logout" />Se déconnecter</button>
          </div>
        </Modal>
      )}
      {themeOpen && (
        <Modal title="Thème" onClose={() => setThemeOpen(false)}>
          <p className="muted" style={{ marginBottom: 14 }}>Le thème est propre à cet appareil : chaque magasin peut choisir le sien.</p>
          <ThemePicker value={theme} onChange={setTheme} />
        </Modal>
      )}
      <Toaster />
    </div>
  )
}

function SetupMissing() {
  return (
    <div className="center-screen">
      <div className="panel stack" style={{ textAlign: 'left' }}>
        <h2>Connexion à Supabase manquante</h2>
        <p>Ajoutez ces deux variables dans Vercel (Settings → Environment Variables), puis redéployez :</p>
        <pre style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
VITE_SUPABASE_URL=https://xxxx.supabase.co{'\n'}VITE_SUPABASE_ANON_KEY=eyJ...
        </pre>
        <p className="muted">Vous les trouvez dans Supabase → Project Settings → API Keys (onglet « Legacy »).</p>
      </div>
    </div>
  )
}
