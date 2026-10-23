import { useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { ROLE_LABEL } from './format'
import { ErrorBox, Field, Loading, Modal, PageHeader } from './ui'
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
    try {
      await q(supabase.from('profiles').update(next).eq('id', u.id))
      notify('Compte mis à jour'); users.reload()
    } catch (e) { notify(e.message, 'error') }
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
      <PageHeader title="Comptes & magasins" subtitle="Chaque magasin se connecte avec son propre compte et ne voit que son stock et ses commandes. La production voit tout.">
        <button className="primary" onClick={() => setCreating(true)}>Créer un compte</button>
      </PageHeader>
      <ErrorBox error={users.error} />
      {pending > 0 && <div className="info-box" style={{ marginBottom: 16 }}>{pending} compte{pending > 1 ? 's' : ''} en attente : choisissez un rôle pour {pending > 1 ? 'les' : 'l’'}activer.</div>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Compte</th><th>Rôle</th><th>Magasin</th></tr></thead>
          <tbody>
            {users.data.map(u => (
              <tr key={u.id} className={u.role === 'en_attente' || (u.role === 'magasin' && !u.shop_id) ? 'low' : ''}>
                <td><b>{u.full_name || u.email}</b>{u.full_name && u.full_name !== u.email && <><br /><span className="muted small-text">{u.email}</span></>}{u.id === profile.id && <span className="muted small-text"> (vous)</span>}</td>
                <td style={{ width: 200 }}>
                  <select value={u.role} onChange={e => updateUser(u, { role: e.target.value })} aria-label={`Rôle de ${u.email}`}>
                    {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td style={{ width: 220 }}>
                  {u.role === 'magasin' ? (
                    <select value={u.shop_id || ''} onChange={e => updateUser(u, { shop_id: e.target.value || null })} aria-label={`Magasin de ${u.email}`}>
                      <option value="">— Choisir —</option>
                      {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : <span className="muted">Tous</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginTop: 22 }}>
        <div className="panel-head"><h2>Magasins</h2></div>
        <div className="stack" style={{ gap: 10 }}>
          {shops.map(s => (
            <div key={s.id} className="row">
              <input defaultValue={s.name} onBlur={e => renameShop(s, e.target.value)} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} style={{ maxWidth: 340 }} aria-label="Nom du magasin" />
              <span className="muted small-text">{(users.data || []).filter(u => u.shop_id === s.id).length} compte(s)</span>
            </div>
          ))}
          <form className="row" onSubmit={addShop}>
            <input placeholder="Nom d’un nouveau magasin" value={newShop} onChange={e => setNewShop(e.target.value)} style={{ maxWidth: 340 }} />
            <button>Ajouter le magasin</button>
          </form>
        </div>
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
      if (!res.ok || !body) throw new Error(body?.error || 'La création de compte ne fonctionne qu’une fois le site déployé sur Vercel avec SUPABASE_SERVICE_ROLE_KEY. Sinon, créez le compte dans Supabase → Authentication → Add user : il apparaîtra ici en attente.')
      notify(`Compte ${f.email} créé`)
      onCreated()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Créer un compte" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Nom affiché"><input value={f.full_name} onChange={e => set({ full_name: e.target.value })} placeholder="Ex. : Magasin centre-ville" /></Field>
        <Field label="E-mail de connexion"><input type="email" required value={f.email} onChange={e => set({ email: e.target.value })} /></Field>
        <Field label="Mot de passe" hint="8 caractères minimum. Communiquez-le au magasin.">
          <input type="text" required value={f.password} onChange={e => set({ password: e.target.value })} autoComplete="new-password" />
        </Field>
        <div className="grid-2">
          <Field label="Rôle">
            <select value={f.role} onChange={e => set({ role: e.target.value })}>
              <option value="magasin">Magasin</option><option value="production">Production</option><option value="admin">Administrateur</option>
            </select>
          </Field>
          {f.role === 'magasin' && (
            <Field label="Magasin">
              <select value={f.shop_id} onChange={e => set({ shop_id: e.target.value })}>
                {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
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
