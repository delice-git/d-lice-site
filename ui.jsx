import { useEffect, useState } from 'react'
import { toNumber, num } from './format'
import { Icon } from './icons'
import { THEMES } from './themes'

export const STATUS = {
  en_attente: 'En attente',
  en_production: 'En production',
  prete: 'Prête',
  livree: 'Livrée',
  annulee: 'Annulée',
}

export const StatusBadge = ({ status }) => <span className={'badge st-' + status}>{STATUS[status]}</span>
export const KindBadge = ({ kind }) => <span className={'badge kind-' + kind}>{kind === 'client' ? 'Client' : 'Réassort'}</span>

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev }
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="grab" />
        <header>
          <h2>{title}</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {children && <div className="actions">{children}</div>}
    </div>
  )
}

export function Seg({ value, onChange, options }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder = 'Rechercher…' }) {
  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  )
}

export function Stepper({ value, onMinus, onPlus, onOpen, label }) {
  return (
    <span className="stepper">
      <button type="button" onClick={onMinus} aria-label={`Retirer 1 ${label}`}><Icon name="minus" /></button>
      <button type="button" className="val" onClick={onOpen} aria-label={`Modifier le stock de ${label}`}>{num(value)}</button>
      <button type="button" onClick={onPlus} aria-label={`Ajouter 1 ${label}`}><Icon name="plus" /></button>
    </span>
  )
}

export const Loading = () => <div className="loading">Chargement…</div>
export const ErrorBox = ({ error }) => (error ? <div className="error-box">{error}</div> : null)
export const Empty = ({ children }) => <div className="empty">{children}</div>

export const DEFAULT_REASONS = [
  { key: 'entree', label: 'Entrée', sign: 1 },
  { key: 'sortie', label: 'Sortie / perte', sign: -1 },
  { key: 'inventaire', label: 'Inventaire', sign: 0 },
]

// Mouvement de stock. sign 1 = ajoute, -1 = retire, 0 = on saisit la quantité comptée.
export function StockMoveModal({ title, unit, current, reasons = DEFAULT_REASONS, onClose, onSubmit, children }) {
  const [reason, setReason] = useState(reasons[0].key)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const r = reasons.find(x => x.key === reason)
  const v = toNumber(value)
  const delta = r.sign === 0 ? v - Number(current) : r.sign * v
  async function submit(e) {
    e.preventDefault()
    if (value === '' || (r.sign !== 0 && v <= 0)) return
    setBusy(true)
    try { await onSubmit(delta, reason); onClose() } catch { /* erreur déjà affichée */ } finally { setBusy(false) }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">Stock actuel : <b style={{ color: 'var(--ink)' }}>{num(current, 3)} {unit}</b></p>
        <div className="chips" role="radiogroup" aria-label="Type de mouvement">
          {reasons.map(x => (
            <button type="button" key={x.key} role="radio" aria-checked={reason === x.key}
              className={'chip-toggle' + (reason === x.key ? ' trace-on' : '')}
              style={reason === x.key ? { borderStyle: 'solid', borderColor: 'var(--primary)', color: 'var(--ink)' } : undefined}
              onClick={() => setReason(x.key)}>{x.label}</button>
          ))}
        </div>
        <Field label={r.sign === 0 ? `Quantité comptée (${unit})` : `Quantité (${unit})`}>
          <input autoFocus inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} />
        </Field>
        {value !== '' && <p className="muted">Nouveau stock : <b style={{ color: 'var(--ink)' }}>{num(Number(current) + delta, 3)} {unit}</b></p>}
        <div className="row end">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy || value === ''}>Enregistrer</button>
        </div>
        {children}
      </form>
    </Modal>
  )
}

export function ThemePicker({ value, onChange }) {
  return (
    <div className="themes" role="radiogroup" aria-label="Thème">
      {THEMES.map(t => (
        <button key={t.key} type="button" role="radio" aria-checked={value === t.key}
          className={'theme-card' + (value === t.key ? ' on' : '')} onClick={() => onChange(t.key)}>
          <span className="theme-prev" style={{ '--pa': t.accent }}>
            <span className="side" style={{ background: t.brand }}><i /><i /><i /></span>
            <span className="body" style={{ background: t.bg }}>
              <i style={{ background: t.surface, width: '90%' }} />
              <i style={{ background: t.surface, width: '70%' }} />
              <i style={{ background: t.accent, width: '40%' }} />
            </span>
          </span>
          <span className="theme-name">{t.label}{value === t.key && <Icon name="check" size={18} />}</span>
        </button>
      ))}
    </div>
  )
}
