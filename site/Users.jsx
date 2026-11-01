import { useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { ROLE_LABEL } from './format'
import { ErrorBox, Field, Loading, Modal, PageHeader } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'

export default function Users({ profile, shops, reloadShops }) {
  const users = useData(() => q(supabase.from('profiles').select('*').order('role').order('email')), [])
  const [creating, setCreating] = useState(false)
  const [newShop, setNewShop] = useState('')

  async function updateUser(u, patch) {
    if (u.id === profile.id && patch.role && !['production', 'admin'].includes(patch.role)
        && !confirm('Vous allez retirer vos propres droits de production. Continuer ?')) return
    const next = { ...patch }
    if (next.role && next.role !== 'magasin') next.shop_id = null
    try { await q(supabase.from('profiles').update(next).eq('id', u.id)); notify('Compte mis à jour'); users.reload() }
    catch (e) { notify(e.message, 'error') }
  }

  async function renameShop(s, name) {
    if (!name.trim() || name.trim() === s.name) return
    try { await q(supabase.from('shops').update({ name: name.trim() }).eq('id', s.id)); notify('Magasin renommé'); reloadShops() }
    catch (e) { notify(e.message, 'error') }
  }

  async function addShop(e) {
    e.preventDefault()
    if (!newShop.trim()) return
    try { await q(supabase.from('shops').insert({ name: newShop.trim() })); setNewShop(''); notify('Magasin ajouté'); reloadShops() }
    catch (err) { notify(err.message, 'error') }
  }

  if (users.loading && !users.data) return <Loading />
  const pending = (users.data || []).filter(u => u.role === 'en_attente').length

  return (
    <>
      <PageHeader title="Comptes & magasins" subtitle="Chaque magasin a son compte et ne voit que son stock et ses commandes. La production voit tout.">
        <button className="primary" onClick={() => setCreating(true)}><Icon name="plus" size={20} />Créer un compte</button>
      </PageHeader>
      <ErrorBox error={users.error} />
      {pending > 0 && <div className="info-box" style={{ marginBottom: 16 }}>{pending} compte{pending > 1 ? 's' : ''} en attente : choisissez un rôle pour {pending > 1 ? 'les' : 'l’'}activer.</div>}

      <div className="list">
        {users.data.map(u => (
          <div key={u.id} className={'item stack-sm' + (u.role === 'en_attente' || (u.role === 'magasin' && !u.shop_id) ? ' low' : '')}>
            <span className="item-main">
              <span className="item-title">{u.full_name || u.email}{u.id === profile.id && <span className="muted" style={{ fontWeight: 400 }}> (vous)</span>}</span>
              {u.full_name && u.full_name !== u.email && <span className="item-sub">{u.email}</span>}
            </span>
            <span className="item-side" style={{ flexWrap: 'wrap' }}>
              <select value={u.role} onChange={e => updateUser(u, { role: e.target.value })} aria-label={`Rôle de ${u.email}`} style={{ width: 170 }}>
                {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {u.role === 'magasin' && (
                <select value={u.shop_id || ''} onChange={e => updateUser(u, { shop_id: e.target.value || null })} aria-label={`Magasin de ${u.email}`} style={{ width: 170 }}>
                  <option value="">— Magasin —</option>
                  {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </span>
          </div>
        ))}
      </div>

      <h2 style={{ margin: '26px 0 10px' }}>Magasins</h2>
      <div className="panel stack" style={{ gap: 10 }}>
        {shops.map(s => (
          <div key={s.id} className="row" style={{ flexWrap: 'nowrap' }}>
            <Icon name="store" />
            <input defaultValue={s.name} onBlur={e => renameShop(s, e.target.value)} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Nom du magasin" />
          </div>
        ))}
        <form className="row" onSubmit={addShop} style={{ flexWrap: 'nowrap' }}>
          <input placeholder="Nom d’un nouveau magasin" value={newShop} onChange={e => setNewShop(e.target.value)} />
          <button>Ajouter</button>
        </form>
        <p className="muted small-text">Modifiez un nom puis touchez ailleurs pour l’enregistrer.</p>
      </div>

      {creating && <CreateUser shops={shops} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); users.reload() }} />}
    </>
  )
}

function CreateUser({ shops, onClose, onCreated }) {
  const [f, setF] = useState({ email: '', password: '', full_name: '', role: 'magasin', shop_id: shops[0]?.id || '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = p => setF(x => ({ ...x, ...p }))

  async function submit(e) {
    e.preventDefault()
    if (f.password.length < 8) return setError('Le mot de passe doit faire au moins 8 caractères.')
    if (f.role === 'magasin' && !f.shop_id) return setError('Choisissez le magasin de ce compte.')
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(f),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) throw new Error(body?.error || 'Création impossible depuis le site (fichier api/create-user.js ou clé SUPABASE_SERVICE_ROLE_KEY manquants). Créez le compte dans Supabase → Authentication → Add user : il apparaîtra ici en attente.')
      notify(`Compte ${f.email} créé`); onCreated()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Créer un compte" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Nom affiché"><input value={f.full_name} onChange={e => set({ full_name: e.target.value })} placeholder="Ex. : Magasin Thiange" /></Field>
        <Field label="E-mail de connexion"><input type="email" required value={f.email} onChange={e => set({ email: e.target.value })} autoCapitalize="none" /></Field>
        <Field label="Mot de passe" hint="8 caractères minimum. Communiquez-le au magasin.">
          <input type="text" required value={f.password} onChange={e => set({ password: e.target.value })} autoComplete="new-password" autoCapitalize="none" />
        </Field>
        <div className="grid-2">
          <Field label="Rôle">
            <select value={f.role} onChange={e => set({ role: e.target.value })}>
              <option value="magasin">Magasin</option><option value="production">Production</option><option value="admin">Administrateur</option>
            </select>
          </Field>
          {f.role === 'magasin' && (
            <Field label="Magasin">
              <select value={f.shop_id} onChange={e => set({ shop_id: e.target.value })}>{shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </Field>
          )}
        </div>
        <div className="row end">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy}>{busy ? 'Création…' : 'Créer le compte'}</button>
        </div>
      </form>
    </Modal>
  )
}
