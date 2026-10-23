import { Fragment, useMemo, useState } from 'react'
import { useData } from './useData'
import { loadCatalogue, allergensOf } from './catalogue'
import { ALLERGENS } from './allergenList'
import { AllergenBadges } from './AllergenBadges'
import { Empty, ErrorBox, Loading, PageHeader } from './ui'

export default function Allergens() {
  const cat = useData(loadCatalogue, [])
  const [search, setSearch] = useState('')
  const [without, setWithout] = useState([])
  const [open, setOpen] = useState(null)

  const rows = useMemo(() => {
    if (!cat.data) return []
    const s = search.trim().toLowerCase()
    return cat.data.recipes
      .filter(r => r.active && (!s || r.name.toLowerCase().includes(s)))
      .map(r => ({ r, alg: allergensOf(r, cat.data) }))
      .filter(({ alg }) => without.every(k => !alg.contains.includes(k) && !alg.traces.includes(k)))
  }, [cat.data, search, without])

  if (cat.loading && !cat.data) return <Loading />

  return (
    <>
      <PageHeader title="Allergènes par recette" subtitle="Les 14 allergènes à déclaration obligatoire. Touchez un produit pour voir sa composition.">
        <button onClick={() => window.print()}>Imprimer le tableau</button>
      </PageHeader>
      <ErrorBox error={cat.error} />

      <div className="panel no-print" style={{ marginBottom: 16 }}>
        <div className="stack" style={{ gap: 10 }}>
          <input placeholder="Rechercher un produit…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 320 }} aria-label="Rechercher" />
          <div>
            <p className="small-text muted" style={{ marginBottom: 6 }}>Un client est allergique ? Sélectionnez ses allergies pour voir ce qu’il peut manger :</p>
            <div className="row" style={{ gap: 6 }}>
              {ALLERGENS.map(a => {
                const on = without.includes(a.key)
                return (
                  <button type="button" key={a.key} aria-pressed={on} className={'alg-toggle' + (on ? ' on' : '')}
                    onClick={() => setWithout(w => on ? w.filter(k => k !== a.key) : [...w, a.key])}>
                    {on ? 'Sans ' : ''}{a.icon} {a.label}
                  </button>
                )
              })}
              {without.length > 0 && <button className="small ghost" onClick={() => setWithout([])}>Tout effacer</button>}
            </div>
          </div>
        </div>
      </div>

      {!rows.length ? (
        <Empty>{without.length ? 'Aucun produit ne convient à ces allergies (traces comprises).' : 'Aucune recette active.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th>Produit</th>
                {ALLERGENS.map(a => <th key={a.key} className="rot" title={a.label}>{a.icon} {a.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, alg }) => (
                <Fragment key={r.id}>
                  <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                    <td><b>{r.name}</b><br /><span className="muted small-text">{r.category}</span></td>
                    {ALLERGENS.map(a => (
                      <td key={a.key} className="cell">
                        {alg.contains.includes(a.key) ? <span className="dot" title={`Contient : ${a.label}`} />
                          : alg.traces.includes(a.key) ? <span className="dot trace" title={`Traces possibles : ${a.label}`} /> : null}
                      </td>
                    ))}
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={ALLERGENS.length + 1} style={{ background: '#f8f9f6' }}>
                        <div className="stack" style={{ gap: 8 }}>
                          <AllergenBadges {...alg} />
                          <p className="small-text"><b>Ingrédients :</b> {(cat.data.itemsByRecipe[r.id] || []).map(it => cat.data.articlesById[it.article_id]?.name).filter(Boolean).join(', ') || 'non renseignés'}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small-text muted" style={{ marginTop: 10 }}>
        <span className="dot" style={{ width: 12, height: 12, verticalAlign: 'middle' }} /> contient &nbsp;&nbsp;
        <span className="dot trace" style={{ width: 12, height: 12, verticalAlign: 'middle' }} /> traces possibles
      </p>
    </>
  )
}
