import { ALLERGEN_BY_KEY } from './allergenList'

export function AllergenBadges({ contains = [], traces = [], compact = false }) {
  if (!contains.length && !traces.length) return <span className="alg-none">Aucun allergène majeur</span>
  return (
    <span className="allergens">
      {contains.map(k => {
        const a = ALLERGEN_BY_KEY[k]; if (!a) return null
        return <span key={k} className={'alg' + (compact ? ' compact' : '')} title={a.label}>{a.icon}{!compact && ' ' + a.label}</span>
      })}
      {traces.map(k => {
        const a = ALLERGEN_BY_KEY[k]; if (!a) return null
        return <span key={'t' + k} className={'alg trace' + (compact ? ' compact' : '')} title={'Traces possibles : ' + a.label}>{a.icon}{!compact && ' traces ' + a.label.toLowerCase()}</span>
      })}
    </span>
  )
}
