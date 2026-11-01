// Fonction Vercel : création d'un compte magasin / production depuis l'onglet « Comptes ».
// Nécessite la variable SUPABASE_SERVICE_ROLE_KEY dans Vercel (jamais exposée au navigateur).
import { createClient } from '@supabase/supabase-js'

const ROLES = ['magasin', 'production', 'admin']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY n’est pas configurée sur Vercel.' })
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // 1. Vérifier que la personne qui demande est bien la production
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const { data: auth, error: authError } = await admin.auth.getUser(token)
  if (authError || !auth?.user) return res.status(401).json({ error: 'Session expirée, reconnectez-vous.' })
  const { data: me } = await admin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (!me || !['production', 'admin'].includes(me.role)) {
    return res.status(403).json({ error: 'Seule la production peut créer des comptes.' })
  }

  // 2. Valider la demande
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const fullName = String(body.full_name || '').trim() || email
  const role = body.role
  const shopId = role === 'magasin' ? body.shop_id : null
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' })
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' })
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide.' })
  if (role === 'magasin' && !shopId) return res.status(400).json({ error: 'Choisissez un magasin.' })

  // 3. Créer le compte (déjà confirmé) puis son profil
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  })
  if (error) {
    const msg = /already|registered|exists/i.test(error.message) ? 'Un compte existe déjà avec cet e-mail.' : error.message
    return res.status(400).json({ error: msg })
  }
  const { error: pErr } = await admin.from('profiles')
    .upsert({ id: created.user.id, email, full_name: fullName, role, shop_id: shopId })
  if (pErr) return res.status(500).json({ error: 'Compte créé mais rôle non enregistré : ' + pErr.message })

  return res.status(200).json({ id: created.user.id })
}
