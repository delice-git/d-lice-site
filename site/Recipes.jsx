import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { loadCatalogue, allergensFromLines, lineCost, recipeCost, productName, groupByCategory, formatLabel, fmtOf, unitWord, sizeUnits } from './catalogue'
import { CategoryBar, CategoryManager, CategorySelect, FormatPicker, useCatFilter } from './categories'
import { eur, num, subUnit, toNumber } from './format'
import { ALLERGENS } from './allergenList'
import { AllergenBadges } from './AllergenBadges'
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, SearchBox } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'


export default function Recipes() {
  const cat = useData(loadCatalogue, [])
  const [selected, setSelected] = useState(null) // id | 'new' | null
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const [managing, setManaging] = useState(false)
  const filter = useCatFilter('recettes')

  // groupes pour la barre de filtres (recherche appliquée, catégorie non appliquée pour garder les compteurs)
  const searched = useMemo(() => {
    if (!cat.data) return []
    const s = search.trim().toLowerCase()
    return cat.data.recipes.filter(r => r.active !== archived && (!s || productName(r).toLowerCase().includes(s) || (r.category || '').toLowerCase().includes(s)))
  }, [cat.data, search, archived])
  const allGroups = useMemo(() => groupByCategory(searched.filter(r => !filter.format || (fmtOf(r) || 'piece') === filter.format), r => r.category, cat.data?.categories), [searched, filter.format, cat.data])
  const groups = allGroups.filter(g => !filter.cat || g.name === filter.cat)
  const formats = [...new Set(searched.map(r => fmtOf(r) || 'piece'))]
  const count = groups.reduce((s, g) => s + g.items.length, 0)

  if (cat.loading && !cat.data) return <Loading />
  const recipe = selected && selected !== 'new' ? cat.data?.recipes.find(r => r.id === selected) : null
  const open = id => { setSelected(id); window.scrollTo(0, 0) }

  return (
    <>
      <div className={selected ? 'only-desktop' : ''}>
        <PageHeader title="Recettes" subtitle="Fiches techniques : ingrédients, coût, marge et allergènes. Indépendantes du stock.">
          <button className="primary" onClick={() => open('new')}><Icon name="plus" size={20} />Nouvelle recette</button>
        </PageHeader>
      </div>
      <ErrorBox error={cat.error} />
      <div className={'split' + (selected ? ' has-sel' : '')}>
        <div className="list recipe-list">
          <div className="list-head">
            <SearchBox value={search} onChange={setSearch} placeholder="Rechercher une recette…" />
            <CategoryBar groups={allGroups} value={filter.cat} onChange={filter.setCat}
              formats={formats} format={filter.format} onFormat={filter.setFormat} onManage={() => setManaging(true)} />
            <label className="check small-text"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Voir les recettes archivées</label>
          </div>
          <div className="scroll">
            {groups.map(g => (
              <div key={g.name || '_'}>
                <div className="list-group">{g.label} <span className="muted small-text">· {g.items.length}</span></div>
                {g.items.map(r => (
                  <button key={r.id} className={'item' + (selected === r.id ? ' active' : '')} onClick={() => open(r.id)}>
                    <span className="item-main">
                      <span className="item-title">{r.name}{formatLabel(r) && <span className="badge fmt-badge">{formatLabel(r)}</span>}</span>
                    </span>
                    <span className="item-figure"><b style={{ fontSize: '1rem' }}>{eur(recipeCost(r, cat.data) / Number(r.yield_qty))}</b><span>par {unitWord(r)}</span></span>
                  </button>
                ))}
              </div>
            ))}
            {!count && <div className="item-empty">Aucune recette{filter.cat || filter.format || search ? ' pour ce filtre' : ''}.</div>}
          </div>
        </div>
        <div className="recipe-editor">
          {selected ? (
            <RecipeEditor key={selected} recipe={recipe} cat={cat.data} onBack={() => setSelected(null)}
              reloadCat={cat.reload}
              onSaved={id => { cat.reload(); setSelected(id) }}
              onArchived={() => { cat.reload(); setSelected(null) }} />
          ) : <Empty>Choisissez une recette dans la liste, ou créez-en une nouvelle.</Empty>}
        </div>
      </div>
      {managing && <CategoryManager categories={cat.data.categories} onClose={() => setManaging(false)} reload={cat.reload} />}
    </>
  )
}

function RecipeEditor({ recipe, cat, onBack, onSaved, onArchived, reloadCat }) {
  const isNew = !recipe
  const [form, setForm] = useState(() => recipe
    ? { ...recipe, yield_qty: String(recipe.yield_qty), sale_price: String(recipe.sale_price), servings: recipe.servings || null, format: fmtOf(recipe), bac_size: recipe.bac_size || null }
    : { name: '', category: cat.categories?.[0]?.name || 'Pain', yield_qty: '10', sale_price: '', extra_allergens: [], traces: [], instructions: '', active: true, servings: null, format: null, bac_size: null })
  const [lines, setLines] = useState(() => (recipe ? cat.itemsByRecipe[recipe.id] || [] : []).map(i => ({ article_id: i.article_id, quantity: String(i.quantity) })))
  const [extraArticles, setExtraArticles] = useState([])
  const [dirty, setDirty] = useState(isNew)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [newIng, setNewIng] = useState(null) // index de ligne qui attend un nouvel ingrédient

  const articles = useMemo(() => [...cat.articles, ...extraArticles].sort((a, b) => a.name.localeCompare(b.name)), [cat.articles, extraArticles])
  const articlesById = useMemo(() => Object.fromEntries(articles.map(a => [a.id, a])), [articles])

  const set = patch => { setForm(f => ({ ...f, ...patch })); setDirty(true) }
  const setLine = (i, patch) => { setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); setDirty(true) }

  const yieldQty = toNumber(form.yield_qty) || 1
  const siblings = cat.recipes.filter(x => x.id !== recipe?.id && x.active && x.name.trim().toLowerCase() === form.name.trim().toLowerCase()).map(formatLabel)
  const word = unitWord(form)
  const salePrice = toNumber(form.sale_price)
  const batchCost = lines.reduce((s, l) => s + lineCost(toNumber(l.quantity), articlesById[l.article_id]), 0)
  const unitCost = batchCost / yieldQty
  const margin = salePrice - unitCost
  const marginPct = salePrice ? (margin / salePrice) * 100 : 0
  const totalWeight = lines.reduce((s, l) => {
    const a = articlesById[l.article_id]
    return a && a.unit !== 'pièce' ? s + toNumber(l.quantity) : s
  }, 0)

  const autoAllergens = useMemo(() => allergensFromLines(lines, articlesById).contains, [lines, articlesById])
  const finalAlg = allergensFromLines(lines, articlesById, form.extra_allergens, form.traces)

  function toggleAllergen(key) {
    if (autoAllergens.includes(key)) return
    const inExtra = form.extra_allergens.includes(key)
    const inTraces = form.traces.includes(key)
    if (!inExtra && !inTraces) set({ extra_allergens: [...form.extra_allergens, key] })
    else if (inExtra) set({ extra_allergens: form.extra_allergens.filter(k => k !== key), traces: [...form.traces, key] })
    else set({ traces: form.traces.filter(k => k !== key) })
  }

  // Changer de format : propose de recalculer les quantités si on reste dans la même famille (personnes ou bacs)
  function changeFormat(next) {
    const a = sizeUnits(form), b = sizeUnits(next)
    const hasQty = lines.some(l => toNumber(l.quantity) > 0)
    if (a.family && a.family === b.family && a.units && b.units && a.units !== b.units && hasQty
      && confirm(`Recalculer les quantités et le prix pour « ${formatLabel(next)} » (au lieu de « ${formatLabel(form)} ») ?`)) {
      const f = b.units / a.units
      setLines(ls => ls.map(l => ({ ...l, quantity: String(Math.round(toNumber(l.quantity) * f * 10) / 10) })))
      if (toNumber(form.sale_price)) { set({ ...next, sale_price: String(Math.round(toNumber(form.sale_price) * f * 2) / 2) }); return }
    }
    set(next)
  }

  // Autres tailles possibles pour ce produit (même famille)
  const otherSizes = (() => {
    const fam = sizeUnits(form).family
    const opts = fam === 'pers'
      ? [{ format: 'gateau', servings: 4 }, { format: 'gateau', servings: 6 }, { format: 'gateau', servings: 8 }, { format: 'cadre', servings: 60 }]
      : fam === 'bac' ? [{ format: 'bac', bac_size: 'demi' }, { format: 'bac', bac_size: 'entier' }] : []
    return opts.map(o => ({ servings: null, bac_size: null, ...o }))
      .filter(o => formatLabel(o) !== formatLabel(form) && !siblings.includes(formatLabel(o)))
  })()

  // Créer la même recette dans une autre taille, quantités et prix recalculés
  async function createSize(next) {
    const f = sizeUnits(next).units / sizeUnits(form).units
    try {
      const id = await q(supabase.rpc('save_recipe', {
        p_id: null,
        p_recipe: { ...form, ...next, yield_qty: yieldQty, sale_price: Math.round(salePrice * f * 2) / 2 },
        p_items: lines.filter(l => l.article_id && toNumber(l.quantity) > 0)
          .map(l => ({ article_id: l.article_id, quantity: Math.round(toNumber(l.quantity) * f * 10) / 10 })),
      }))
      notify(`${form.name} — ${formatLabel(next)} créé (quantités recalculées)`)
      onSaved(id)
    } catch (e) { notify(e.message, 'error') }
  }

  async function save() {
    if (!form.name.trim()) return setError('Donnez un nom à la recette.')
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
      notify(recipe.active ? 'Recette archivée' : 'Recette réactivée'); onArchived()
    } catch (e) { notify(e.message, 'error') }
  }

  function back() {
    if (dirty && !isNew && !confirm('Quitter sans enregistrer les modifications ?')) return
    onBack()
  }

  return (
    <div className="stack" style={{ paddingBottom: dirty ? 70 : 0 }}>
      <div className="row only-mobile" style={{ display: 'flex' }}>
        <button className="ghost" onClick={back} style={{ paddingLeft: 4 }}><Icon name="back" size={20} />Recettes</button>
      </div>

      <div className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h2>{isNew ? 'Nouvelle recette' : form.name || 'Recette'}</h2>
          {!isNew && <button className="small danger" onClick={toggleArchive}>{recipe.active ? 'Archiver' : 'Réactiver'}</button>}
        </div>
        <ErrorBox error={error} />
        <div className="grid-2">
          <Field label="Nom"><input value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Ex. : Cramique aux raisins" /></Field>
          <Field label="Catégorie">
            <CategorySelect value={form.category} onChange={v => set({ category: v })} categories={cat.categories || []} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label={word === 'pièce' ? 'Rendement (pièces par fournée)' : `Nombre de ${word}s par fournée`}><input inputMode="decimal" value={form.yield_qty} onChange={e => set({ yield_qty: e.target.value })} /></Field>
          <Field label={word === 'pièce' ? 'Prix de vente TTC par pièce (€)' : `Prix de vente TTC — ${formatLabel(form)} (€)`}><input inputMode="decimal" value={form.sale_price} onChange={e => set({ sale_price: e.target.value })} /></Field>
        </div>
        <div className="field">
          <span>Format</span>
          <FormatPicker value={form} onChange={changeFormat} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{formatLabel(form) ? `Ingrédients — ${formatLabel(form)}` : 'Ingrédients pour une fournée'}</h2>
          {totalWeight > 0 && <span className="muted small-text">≈ {num(totalWeight / 1000, 3)} kg · {num(totalWeight / yieldQty, 0)} g / pièce</span>}
        </div>
        <div>
          {lines.map((l, i) => {
            const a = articlesById[l.article_id]
            return (
              <div key={i} className="ing-row">
                <select className="ing-art" value={l.article_id} aria-label="Ingrédient"
                  onChange={e => e.target.value === '__new' ? setNewIng(i) : setLine(i, { article_id: e.target.value })}>
                  <option value="">Choisir un ingrédient…</option>
                  {articles.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  <option value="__new">+ Nouvel ingrédient…</option>
                </select>
                <span className="ing-qty">
                  <input inputMode="decimal" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} aria-label="Quantité" placeholder="0" />
                  <span>{a ? subUnit(a.unit) : ''}</span>
                </span>
                <span className="ing-cost">{eur(lineCost(toNumber(l.quantity), a))}{a && <small>{eur(a.price)}/{a.unit}</small>}</span>
                <button className="ghost icon ing-del" aria-label="Retirer l’ingrédient" onClick={() => { setLines(ls => ls.filter((_, j) => j !== i)); setDirty(true) }}><Icon name="close" size={20} /></button>
              </div>
            )
          })}
          {!lines.length && <p className="muted" style={{ padding: '6px 0 12px' }}>Aucun ingrédient pour l’instant.</p>}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => { setLines(ls => [...ls, { article_id: '', quantity: '' }]); setDirty(true) }}><Icon name="plus" size={20} />Ajouter un ingrédient</button>
        </div>
      </div>

      {!isNew && !dirty && sizeUnits(form).family && (
        <div className="panel row">
          <span style={{ flex: '1 1 220px' }}><b>Autres tailles</b><br /><span className="muted small-text">Crée la même recette dans une autre taille, quantités et prix recalculés.</span></span>
          {otherSizes.map(o => (
            <button key={formatLabel(o)} onClick={() => createSize(o)}><Icon name="plus" size={18} />{formatLabel(o)}</button>
          ))}
          {!otherSizes.length && <span className="ok small-text">Toutes les tailles existent déjà.</span>}
        </div>
      )}

      <div className="totals">
        <div><span>Coût d’une fournée</span><b>{eur(batchCost)}</b></div>
        <div><span>Coût par {word}</span><b>{eur(unitCost)}</b></div>
        <div><span>Marge par {word}</span><b className={salePrice ? (margin < 0 ? 'neg' : 'pos') : ''}>{salePrice ? eur(margin) : '—'}</b></div>
        <div><span>Taux de marge</span><b className={salePrice ? (marginPct < 0 ? 'neg' : 'pos') : ''}>{salePrice ? `${num(marginPct, 1)} %` : '—'}</b></div>
      </div>

      <div className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}><h2>Allergènes</h2></div>
        <AllergenBadges {...finalAlg} />
        <p className="muted small-text">Ceux des ingrédients sont ajoutés seuls (grisés). Touchez un autre allergène : une fois = contient, deux fois = traces, trois fois = retirer.</p>
        <div className="chips">
          {ALLERGENS.map(a => {
            const auto = autoAllergens.includes(a.key)
            const on = auto || form.extra_allergens.includes(a.key)
            const trace = !on && form.traces.includes(a.key)
            return (
              <button type="button" key={a.key} onClick={() => toggleAllergen(a.key)} aria-pressed={on || trace}
                className={'chip-toggle' + (on ? ' on' : '') + (trace ? ' trace-on' : '') + (auto ? ' locked' : '')}>
                {a.icon} {a.label}{trace ? ' (traces)' : ''}
              </button>
            )
          })}
        </div>
      </div>

      <div className="panel">
        <Field label="Méthode / notes de fabrication">
          <textarea value={form.instructions || ''} onChange={e => set({ instructions: e.target.value })} rows={6} />
        </Field>
      </div>

      {(dirty || isNew) && (
        <div className="action-bar">
          <span>{isNew ? 'Nouvelle recette' : 'Modifications non enregistrées'}</span>
          <span className="spacer" />
          <button className="accent" onClick={save} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer la recette'}</button>
        </div>
      )}

      {newIng !== null && (
        <QuickIngredient onClose={() => setNewIng(null)} onCreated={a => {
          setExtraArticles(x => [...x, a]); setLine(newIng, { article_id: a.id }); setNewIng(null); reloadCat()
        }} />
      )}
    </div>
  )
}

function QuickIngredient({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', unit: 'kg', price: '', allergens: [] })
  const [error, setError] = useState(null)
  const set = p => setF(x => ({ ...x, ...p }))
  async function submit(e) {
    e.preventDefault()
    if (!f.name.trim()) return setError('Le nom est obligatoire.')
    try {
      const rows = await q(supabase.from('articles').insert({ name: f.name.trim(), unit: f.unit, price: toNumber(f.price), allergens: f.allergens }).select())
      notify('Ingrédient ajouté'); onCreated(rows[0])
    } catch (err) { setError(err.message) }
  }
  return (
    <Modal title="Nouvel ingrédient" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Nom"><input autoFocus value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Ex. : Raisins secs" /></Field>
        <div className="grid-2">
          <Field label="Acheté au">
            <select value={f.unit} onChange={e => set({ unit: e.target.value })}><option value="kg">kg</option><option value="L">L</option><option value="pièce">pièce</option></select>
          </Field>
          <Field label={`Prix par ${f.unit} (€)`}><input inputMode="decimal" value={f.price} onChange={e => set({ price: e.target.value })} /></Field>
        </div>
        <div className="field">
          <span>Allergènes</span>
          <div className="chips">
            {ALLERGENS.map(a => {
              const on = f.allergens.includes(a.key)
              return <button type="button" key={a.key} aria-pressed={on} className={'chip-toggle' + (on ? ' on' : '')}
                onClick={() => set({ allergens: on ? f.allergens.filter(k => k !== a.key) : [...f.allergens, a.key] })}>{a.icon} {a.label}</button>
            })}
          </div>
        </div>
        <div className="row end">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary">Ajouter l’ingrédient</button>
        </div>
      </form>
    </Modal>
  )
}
