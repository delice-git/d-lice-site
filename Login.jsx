import { useState } from 'react'
import { supabase } from './supabase'
import { Field } from './ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message === 'Invalid login credentials' ? 'E-mail ou mot de passe incorrect.' : error.message)
    setBusy(false)
  }

  return (
    <div className="login-wrap">
      <div className="login-side">
        <div className="brand-name">Le Temps<br />d'un Délice</div>
        <p>Stocks des magasins, commandes à la production, recettes et allergènes — au même endroit.</p>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <h1>Connexion</h1>
          <p className="muted">Chaque magasin et la production ont leur propre compte.</p>
          {error && <div className="error-box">{error}</div>}
          <Field label="E-mail">
            <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
          </Field>
          <Field label="Mot de passe">
            <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
          </Field>
          <button className="primary" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        </form>
      </div>
    </div>
  )
}
