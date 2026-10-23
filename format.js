const eurFmt = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' })
export const eur = n => eurFmt.format(Number(n) || 0)
export const num = (n, d = 2) => new Intl.NumberFormat('fr-BE', { maximumFractionDigits: d }).format(Number(n) || 0)
export const toNumber = v => Number(String(v ?? '').replace(',', '.')) || 0

export const isoDate = d => d.toLocaleDateString('sv-SE') // AAAA-MM-JJ en heure locale
export const todayISO = () => isoDate(new Date())
export const addDaysISO = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return isoDate(d) }
export const fmtDate = iso => iso
  ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' })
  : ''
export const fmtDateTime = iso => new Date(iso).toLocaleString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
export const fmtTime = iso => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })

// Unités : article en kg / L / pièce ; recette saisie en g / ml / pièce
export const unitFactor = u => (u === 'kg' || u === 'L' ? 1000 : 1)
export const subUnit = u => ({ kg: 'g', L: 'ml' }[u] || 'pc')
export const ROLE_LABEL = { en_attente: 'En attente', magasin: 'Magasin', production: 'Production', admin: 'Administrateur' }
