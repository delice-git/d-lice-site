import { useEffect, useState } from 'react'
import { toNumber } from './format'

export const STATUS = {
  en_attente: 'En attente',
  en_production: 'En production',
  prete: 'Prête',
  livree: 'Livrée',
  annulee: 'Annulée',
}

export function StatusBadge({ status }) {
  return <span className={'badge st-' + status}>{STATUS[status]}</span>
}

export function KindBadge({ kind }) {
  return <span className={'badge kind-' + kind}>{kind === 'client' ? 'Commande client' : 'Réassort'}</span>
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">×</button>
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

export const Loading = () => <div className="loading">Chargement…</div>
export const ErrorBox = ({ error }) => (error ? <div className="error-box">{error}</div> : null)
export const Empty = ({ children }) => <div className="empty">{children}</div>

// Mouvement de stock : entrée, sortie ou inventaire (valeur exacte)
export function StockMoveModal({ title, unit, current, onClose, onSubmit }) {
  const [mode, setMode] = useState('in')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const v = toNumber(value)
  const delta = mode === 'in' ? v : mode === 'out' ? -v : v - Number(current)
  async function submit(e) {
    e.preventDefault()
    if (!value || (mode !== 'set' && v <= 0)) return
    setBusy(true)
    try { await onSubmit(delta); onClose() } catch { /* erreur déjà affichée */ } finally { setBusy(false) }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="tabs" role="tablist">
          <button type="button" className={mode === 'in' ? 'active' : ''} onClick={() => setMode('in')}>Entrée</button>
          <button type="button" className={mode === 'out' ? 'active' : ''} onClick={() => setMode('out')}>Sortie / perte</button>
          <button type="button" className={mode === 'set' ? 'active' : ''} onClick={() => setMode('set')}>Inventaire</button>
        </div>
        <Field label={mode === 'set' ? `Quantité comptée (${unit})` : `Quantité (${unit})`}
               hint={`Stock actuel : ${current} ${unit}`}>
          <input autoFocus inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} />
        </Field>
        {value && <p className="muted">Nouveau stock : <b>{Math.round((Number(current) + delta) * 1000) / 1000} {unit}</b></p>}
        <div className="row end">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy || !value}>Enregistrer le mouvement</button>
        </div>
      </form>
    </Modal>
  )
}
