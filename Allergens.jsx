import { Fragment, useMemo, useState } from 'react'
import { useData } from './useData'
import { loadCatalogue, allergensOf } from './catalogue'
import { ALLERGENS } from './allergenList'
import { AllergenBadges } from './AllergenBadges'
import { Empty, ErrorBox, Loading, PageHeader, SearchBox } from './ui'
import { Icon } from './icons'

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
  const ingredients = r => (cat.data.itemsByRecipe[r.id] || []).map(it => cat.data.articlesById[it.article_id]?.name).filter(Boolean).join(', ') || 'non renseignés'

  return (
    <>
      <PageHeader title="Allergènes" subtitle="Les 14 allergènes à déclaration obligatoire, pour chaque produit.">
        <button className="only-desktop" onClick={() => window.print()}><Icon name="print" size={20} />Imprimer</button>
      </PageHeader>
      <ErrorBox error={cat.error} />

      <div className="panel no-print" style={{ marginBottom: 16 }}>
        <div className="stack" style={{ gap: 12 }}>
          <SearchBox value={search} onChange={setSearch} placeholder="Rechercher un produit…" />
          <div>
            <p className="small-text muted" style={{ marginBottom: 8 }}>Client allergique ? Touchez ses allergies pour voir ce qu’il peut manger :</p>
            <div className="chips">
              {ALLERGENS.map(a => {
                const on = without.includes(a.key)
                return (
                  <button type="button" key={a.key} aria-pressed={on} className={'chip-toggle' + (on ? ' on' : '')}
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
        <>
          {/* Téléphone : une fiche par produit */}
          <div className="list only-mobile">
            {rows.map(({ r, alg }) => (
              <div key={r.id} className="item" style={{ alignItems: 'flex-start' }}>
                <button className="item-main tap" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                  <span className="item-title">{r.name}</span>
                  <AllergenBadges {...alg} />
                  {open === r.id && <span className="item-sub" style={{ marginTop: 4 }}>Ingrédients : {ingredients(r)}</span>}
                </button>
              </div>
            ))}
          </div>

          {/* Ordinateur : tableau croisé */}
          <div className="table-wrap only-desktop">
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
                      <tr><td colSpan={ALLERGENS.length + 1} style={{ background: 'var(--surface-2)' }}>
                        <div className="stack" style={{ gap: 8 }}>
                          <AllergenBadges {...alg} />
                          <p className="small-text"><b>Ingrédients :</b> {ingredients(r)}</p>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small-text muted only-desktop" style={{ marginTop: 10 }}>
            <span className="dot" style={{ width: 12, height: 12 }} /> contient &nbsp;&nbsp; <span className="dot trace" style={{ width: 12, height: 12 }} /> traces possibles
          </p>
        </>
      )}
    </>
  )
}
