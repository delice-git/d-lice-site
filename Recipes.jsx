import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { loadCatalogue, allergensFromLines, lineCost, recipeCost } from './catalogue'
import { eur, num, subUnit, toNumber, unitFactor } from './format'
import { ALLERGENS } from './allergenList'
import { AllergenBadges } from './AllergenBadges'
import { Empty, ErrorBox, Field, Loading, PageHeader } from './ui'
import { notify } from './Toast'

const CATEGORIES = ['Pain', 'Viennoiserie', 'Pâtisserie', 'Snacking', 'Gâteau', 'Autre']

export default function Recipes() {
  const cat = useData(loadCatalogue, [])
  const [selected, setSelected] = useState(null) // id | 'new' | null
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)

  const list = useMemo(() => {
    if (!cat.data) return []
    const s = search.trim().toLowerCase()
    return cat.data.recipes.filter(r => r.active !== archived && (!s || r.name.toLowerCase().includes(s) || (r.category || '').toLowerCase().includes(s)))
  }, [cat.data, search, archived])

  if (cat.loading && !cat.data) return <Loading />
  const recipe = selected && selected !== 'new' ? cat.data?.recipes.find(r => r.id === selected) : null

  return (
    <>
      <PageHeader title="Recettes" subtitle="Le coût, la marge et les allergènes se calculent à partir des articles du stock matières.">
        <button className="primary" onClick={() => setSelected('new')}>Nouvelle recette</button>
      </PageHeader>
      <ErrorBox error={cat.error} />
      <div className="split">
        <div className="recipe-list">
          <div className="search">
            <input placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Rechercher une recette" />
            <label className="row small-text" style={{ gap: 8 }}>
              <input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Voir les recettes archivées
            </label>
          </div>
          <ul>
            {list.map(r => (
              <li key={r.id}>
                <button className={selected === r.id ? 'active' : ''} onClick={() => setSelected(r.id)}>
                  <span>{r.name}<br /><small>{r.category || 'Sans catégorie'}</small></span>
                  <small className="tabular">{eur(recipeCost(r, cat.data) / Number(r.yield_qty))}/pc</small>
                </button>
              </li>
            ))}
            {!list.length && <li className="muted" style={{ padding: 16 }}>Aucune recette.</li>}
          </ul>
        </div>
        <div>
          {selected ? (
            <RecipeEditor key={selected} recipe={recipe} cat={cat.data}
              onSaved={id => { cat.reload(); setSelected(id) }}
              onArchived={() => { cat.reload(); setSelected(null) }} />
          ) : (
            <Empty>Choisissez une recette dans la liste, ou créez-en une nouvelle.</Empty>
          )}
        </div>
      </div>
    </>
  )
}

function RecipeEditor({ recipe, cat, onSaved, onArchived }) {
  const isNew = !recipe
  const [form, setForm] = useState(() => recipe
    ? { ...recipe, yield_qty: String(recipe.yield_qty), sale_price: String(recipe.sale_price) }
    : { name: '', category: 'Pain', yield_qty: '10', sale_price: '', extra_allergens: [], traces: [], instructions: '', active: true })
  const [lines, setLines] = useState(() => (recipe ? cat.itemsByRecipe[recipe.id] || [] : []).map(i => ({ article_id: i.article_id, quantity: String(i.quantity) })))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [batches, setBatches] = useState('1')

  const set = patch => { setForm(f => ({ ...f, ...patch })); setDirty(true) }
  const setLine = (i, patch) => { setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); setDirty(true) }

  const yieldQty = toNumber(form.yield_qty) || 1
  const salePrice = toNumber(form.sale_price)
  const batchCost = lines.reduce((s, l) => s + lineCost(toNumber(l.quantity), cat.articlesById[l.article_id]), 0)
  const unitCost = batchCost / yieldQty
  const margin = salePrice - unitCost
  const marginPct = salePrice ? (margin / salePrice) * 100 : 0
  const totalWeight = lines.reduce((s, l) => {
    const a = cat.articlesById[l.article_id]
    return a && a.unit !== 'pièce' ? s + toNumber(l.quantity) : s
  }, 0)

  const autoAllergens = useMemo(() => allergensFromLines(lines, cat.articlesById).contains, [lines, cat.articlesById])
  const finalAlg = allergensFromLines(lines, cat.articlesById, form.extra_allergens, form.traces)

  function toggleAllergen(key) {
    if (autoAllergens.includes(key)) return
    const inExtra = form.extra_allergens.includes(key)
    const inTraces = form.traces.includes(key)
    // cycle : absent → contient → traces → absent
    if (!inExtra && !inTraces) set({ extra_allergens: [...form.extra_allergens, key] })
    else if (inExtra) set({ extra_allergens: form.extra_allergens.filter(k => k !== key), traces: [...form.traces, key] })
    else set({ traces: form.traces.filter(k => k !== key) })
  }

  async function save() {
    if (!form.name.trim()) return setError('Donnez un nom à la recette.')
    if (yieldQty <= 0) return setError('Le rendement doit être supérieur à 0.')
    setBusy(true); setError(null)
    try {
      const id = await q(supabase.rpc('save_recipe', {
        p_id: recipe?.id || null,
        p_recipe: { ...form, yield_qty: yieldQty, sale_price: salePrice },
        p_items: lines.filter(l => l.article_id && toNumber(l.quantity) > 0).map(l => ({ article_id: l.article_id, quantity: toNumber(l.quantity) })),
      }))
      setDirty(false)
      notify(isNew ? 'Recette créée' : 'Recette enregistrée')
      onSaved(id)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function toggleArchive() {
    if (!confirm(recipe.active ? `Archiver « ${recipe.name} » ? Elle ne sera plus commandable.` : `Réactiver « ${recipe.name} » ?`)) return
    try {
      await q(supabase.from('recipes').update({ active: !recipe.active }).eq('id', recipe.id))
      notify(recipe.active ? 'Recette archivée' : 'Recette réactivée')
      onArchived()
    } catch (e) { notify(e.message, 'error') }
  }

  // Simulation de production
  const b = toNumber(batches)
  const needs = lines.filter(l => l.article_id && toNumber(l.quantity) > 0).map(l => {
    const a = cat.articlesById[l.article_id]
    const need = (toNumber(l.quantity) * b) / unitFactor(a.unit)
    return { a, need, ok: Number(a.stock) >= need }
  })
  const allOk = needs.every(n => n.ok)

  async function produce() {
    try {
      let qty
      try { qty = await q(supabase.rpc('produce_recipe', { p_recipe: recipe.id, p_batches: b })) }
      catch (e) {
        if (!/insuffisant/i.test(e.message) || !confirm(e.message + '\n\nProduire quand même ? Le stock matières passera en négatif.')) throw e
        qty = await q(supabase.rpc('produce_recipe', { p_recipe: recipe.id, p_batches: b, p_allow_negative: true }))
      }
      notify(`${num(qty)} × ${recipe.name} ajoutés au stock produit`)
      onSaved(recipe.id)
    } catch (e) { notify(e.message, 'error') }
  }

  return (
    <div className="stack">
      <div className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h2>{isNew ? 'Nouvelle recette' : form.name || 'Recette'}</h2>
          <div className="row">
            {!isNew && <button className="small danger" onClick={toggleArchive}>{recipe.active ? 'Archiver' : 'Réactiver'}</button>}
            <button className="primary" onClick={save} disabled={busy || (!dirty && !isNew)}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </div>
        <ErrorBox error={error} />
        <div className="grid-2">
          <Field label="Nom"><input value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Ex. : Cramique aux raisins" /></Field>
          <Field label="Catégorie">
            <input list="recipe-cats" value={form.category || ''} onChange={e => set({ category: e.target.value })} />
            <datalist id="recipe-cats">{CATEGORIES.map(c => <option key={c} value={c} />)}</datalist>
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Rendement (pièces par fournée)"><input inputMode="decimal" value={form.yield_qty} onChange={e => set({ yield_qty: e.target.value })} /></Field>
          <Field label="Prix de vente TTC par pièce (€)"><input inputMode="decimal" value={form.sale_price} onChange={e => set({ sale_price: e.target.value })} /></Field>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Ingrédients pour une fournée</h2>
          {totalWeight > 0 && <span className="muted small-text">Poids de pâte ≈ {num(totalWeight / 1000, 3)} kg · {num(totalWeight / yieldQty, 0)} g par pièce</span>}
        </div>
        {!cat.articles.length ? (
          <Empty>Ajoutez d’abord des articles dans « Stock matières ».</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Article</th><th className="num">Quantité</th><th className="num">Prix unitaire</th><th className="num">Coût</th><th></th></tr></thead>
                <tbody>
                  {lines.map((l, i) => {
                    const a = cat.articlesById[l.article_id]
                    return (
                      <tr key={i}>
                        <td style={{ minWidth: 200 }}>
                          <select value={l.article_id} onChange={e => setLine(i, { article_id: e.target.value })} aria-label="Article">
                            <option value="">Choisir un article…</option>
                            {cat.articles.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </td>
                        <td className="num">
                          <span className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
                            <input className="qty" inputMode="decimal" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} aria-label="Quantité" />
                            <span className="muted" style={{ width: 22 }}>{a ? subUnit(a.unit) : ''}</span>
                          </span>
                        </td>
                        <td className="num muted">{a ? `${eur(a.price)}/${a.unit}` : ''}</td>
                        <td className="num"><b>{eur(lineCost(toNumber(l.quantity), a))}</b></td>
                        <td className="num"><button className="ghost square" aria-label="Retirer" onClick={() => { setLines(ls => ls.filter((_, j) => j !== i)); setDirty(true) }}>×</button></td>
                      </tr>
                    )
                  })}
                  {!lines.length && <tr><td colSpan={5} className="muted">Aucun ingrédient pour l’instant.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10 }}>
              <button onClick={() => { setLines(ls => [...ls, { article_id: '', quantity: '' }]); setDirty(true) }}>Ajouter un ingrédient</button>
            </div>
          </>
        )}
      </div>

      <div className="totals">
        <div><span>Coût d’une fournée</span><b>{eur(batchCost)}</b></div>
        <div><span>Coût par pièce</span><b>{eur(unitCost)}</b></div>
        <div><span>Marge par pièce</span><b className={salePrice ? (margin < 0 ? 'neg' : 'pos') : ''}>{salePrice ? eur(margin) : '—'}</b></div>
        <div><span>Taux de marge</span><b className={salePrice ? (marginPct < 0 ? 'neg' : 'pos') : ''}>{salePrice ? `${num(marginPct, 1)} %` : '—'}</b></div>
      </div>

      <div className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h2>Allergènes</h2>
          <AllergenBadges {...finalAlg} />
        </div>
        <p className="muted small-text">
          Les allergènes des articles sont ajoutés automatiquement (grisés). Touchez un autre allergène pour l’ajouter : une fois = contient, deux fois = traces possibles, trois fois = retirer.
        </p>
        <div className="row" style={{ gap: 6 }}>
          {ALLERGENS.map(a => {
            const auto = autoAllergens.includes(a.key)
            const on = auto || form.extra_allergens.includes(a.key)
            const trace = !on && form.traces.includes(a.key)
            return (
              <button type="button" key={a.key} onClick={() => toggleAllergen(a.key)} aria-pressed={on || trace}
                className={'alg-toggle' + (on ? ' on' : '') + (trace ? ' trace-on' : '') + (auto ? ' locked' : '')}
                title={auto ? 'Vient des ingrédients' : undefined}>
                {a.icon} {a.label}{trace ? ' (traces)' : ''}
              </button>
            )
          })}
        </div>
      </div>

      <div className="panel">
        <Field label="Méthode / notes de fabrication">
          <textarea value={form.instructions || ''} onChange={e => set({ instructions: e.target.value })} rows={5} />
        </Field>
      </div>

      {!isNew && (
        <div className="panel stack">
          <h2>Lancer une production</h2>
          {dirty && <div className="info-box">Enregistrez d’abord vos modifications : la production utilise la recette enregistrée.</div>}
          <div className="grid-3">
            <Field label="Nombre de fournées"><input inputMode="decimal" value={batches} onChange={e => setBatches(e.target.value)} /></Field>
            <Field label="Ou nombre de pièces voulues">
              <input inputMode="decimal" value={b ? Math.round(b * yieldQty * 100) / 100 : ''}
                onChange={e => setBatches(String(Math.round((toNumber(e.target.value) / yieldQty) * 1000) / 1000))} />
            </Field>
            <Field label="Coût de cette production"><input value={eur(batchCost * b)} disabled /></Field>
          </div>
          {needs.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Article</th><th className="num">Nécessaire</th><th className="num">En stock</th><th className="num">État</th></tr></thead>
                <tbody>
                  {needs.map(n => (
                    <tr key={n.a.id} className={n.ok ? '' : 'out'}>
                      <td>{n.a.name}</td>
                      <td className="num">{num(n.need, 3)} {n.a.unit}</td>
                      <td className="num">{num(n.a.stock, 3)} {n.a.unit}</td>
                      <td className="num">{n.ok ? <span className="ok">OK</span> : <span className="ko">Manque {num(n.need - n.a.stock, 3)}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row end">
            <button className="primary" onClick={produce} disabled={dirty || b <= 0 || !needs.length}>
              Produire {num(b * yieldQty)} pièce{b * yieldQty > 1 ? 's' : ''}{allOk ? '' : ' (stock insuffisant)'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
