import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { eur, num, toNumber } from './format'
import { ALLERGENS } from './allergenList'
import { Empty, ErrorBox, Field, Loading, Modal, NumberCell, PageHeader, QtyCell, SearchBox } from './ui'
import { Icon } from './icons'
import { notify } from './Toast'

export default function Articles() {
  const data = useData(() => q(supabase.from('articles').select('*').order('category').order('name')), [])
  const [edit, setEdit] = useState(null)
  const [search, setSearch] = useState('')
  const [lowOnly, setLowOnly] = useState(false)

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (data.data || []).filter(a =>
      (!s || a.name.toLowerCase().includes(s) || (a.category || '').toLowerCase().includes(s) || (a.supplier || '').toLowerCase().includes(s)) &&
      (!lowOnly || Number(a.stock) < Number(a.min_stock)))
  }, [data.data, search, lowOnly])

  const lowCount = (data.data || []).filter(a => Number(a.stock) < Number(a.min_stock)).length
  const value = (data.data || []).reduce((s, a) => s + Math.max(0, Number(a.stock)) * Number(a.price), 0)

  async function adjust(a, delta) {
    try {
      const stock = await q(supabase.rpc('adjust_article_stock', { p_article: a.id, p_delta: delta }))
      data.setData(rows => rows.map(r => (r.id === a.id ? { ...r, stock } : r)))
    } catch (e) { notify(e.message, 'error') }
  }
  async function saveMin(a, v) {
    try {
      await q(supabase.from('articles').update({ min_stock: v }).eq('id', a.id))
      data.setData(rows => rows.map(r => (r.id === a.id ? { ...r, min_stock: v } : r)))
    } catch (e) { notify(e.message, 'error') }
  }

  if (data.loading && !data.data) return <Loading />
  let lastCat = null

  return (
    <>
      <PageHeader title="Stock matières"
        subtitle={`Matières premières, indépendantes des recettes. Tapez directement les quantités. Valeur : ${eur(value)}${lowCount ? ` · ${lowCount} sous le minimum` : ''}.`}>
        <button className="primary" onClick={() => setEdit({})}><Icon name="plus" size={20} />Nouvel article</button>
      </PageHeader>
      <ErrorBox error={data.error} />
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Article, catégorie, fournisseur…" />
        <label className="check small-text"><input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} />Seulement à racheter</label>
      </div>
      {!rows.length ? <Empty>{data.data?.length ? 'Aucun article ne correspond.' : 'Aucun article. Ajoutez vos matières premières : farine, beurre, œufs…'}</Empty> : (
        <div className="table-wrap stock">
          <table className="stock-table">
            <thead>
              <tr>
                <th>Article</th>
                <th className="c">En stock</th>
                <th className="c">Minimum</th>
                <th className="r hide-sm">Prix</th>
                <th className="r">État</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap(a => {
                const out = []
                if (a.category !== lastCat) { lastCat = a.category; out.push(<tr key={'g' + a.id} className="grp"><td colSpan={5}>{a.category || 'Sans catégorie'}</td></tr>) }
                const stock = Number(a.stock), min = Number(a.min_stock)
                const state = min > 0 && stock <= 0 ? 'out' : stock < min ? 'low' : ''
                out.push(
                  <tr key={a.id} className={state}>
                    <td><button className="name" onClick={() => setEdit(a)}>{a.name}</button><span className="sub">{a.unit}{a.supplier ? ` · ${a.supplier}` : ''}</span></td>
                    <td className="c"><QtyCell value={stock} label={a.name} onStep={d => adjust(a, d)} onSet={n => adjust(a, n - stock)} /></td>
                    <td className="c"><NumberCell value={min} label={`Minimum ${a.name}`} onSave={v => saveMin(a, v)} /></td>
                    <td className="r hide-sm">{eur(a.price)}/{a.unit}</td>
                    <td className="r">{state ? <span className="state-ko">Racheter</span> : <span className="state-ok">✓</span>}</td>
                  </tr>
                )
                return out
              })}
            </tbody>
          </table>
        </div>
      )}

      {edit && <ArticleForm article={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); data.reload() }}
        categories={[...new Set((data.data || []).map(a => a.category).filter(Boolean))]} />}
    </>
  )
}

function ArticleForm({ article, onClose, onSaved, categories }) {
  const isNew = !article.id
  const [f, setF] = useState({
    name: article.name || '', category: article.category || '', unit: article.unit || 'kg',
    price: article.price ?? '', stock: '', min_stock: article.min_stock ?? '',
    supplier: article.supplier || '', allergens: article.allergens || [],
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = p => setF(x => ({ ...x, ...p }))

  async function submit(e) {
    e.preventDefault()
    if (!f.name.trim()) return setError('Le nom est obligatoire.')
    setBusy(true); setError(null)
    const payload = { name: f.name.trim(), category: f.category.trim() || null, unit: f.unit, price: toNumber(f.price),
      min_stock: toNumber(f.min_stock), supplier: f.supplier.trim() || null, allergens: f.allergens }
    if (isNew) payload.stock = toNumber(f.stock)
    try {
      await q(isNew ? supabase.from('articles').insert(payload) : supabase.from('articles').update(payload).eq('id', article.id))
      notify(isNew ? 'Article ajouté' : 'Article enregistré'); onSaved()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function remove() {
    if (!confirm(`Supprimer « ${article.name} » ?`)) return
    try { await q(supabase.from('articles').delete().eq('id', article.id)); notify('Article supprimé'); onSaved() }
    catch (e) { setError(/foreign key|violates/i.test(e.message) ? 'Cet article est utilisé dans une recette : retirez-le de la recette d’abord.' : e.message) }
  }

  return (
    <Modal title={isNew ? 'Nouvel article' : article.name} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <div className="grid-2">
          <Field label="Nom"><input autoFocus={isNew} value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Ex. : Farine T55" /></Field>
          <Field label="Catégorie">
            <input list="art-cats" value={f.category} onChange={e => set({ category: e.target.value })} placeholder="Ex. : Farines" />
            <datalist id="art-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </Field>
        </div>
        <div className="grid-3">
          <Field label="Unité" hint={f.unit === 'pièce' ? 'Recettes en pièces' : `Recettes en ${f.unit === 'kg' ? 'grammes' : 'millilitres'}`}>
            <select value={f.unit} onChange={e => set({ unit: e.target.value })}><option value="kg">kg</option><option value="L">L</option><option value="pièce">pièce</option></select>
          </Field>
          <Field label={`Prix par ${f.unit} (€ HTVA)`}><input inputMode="decimal" value={f.price} onChange={e => set({ price: e.target.value })} /></Field>
          <Field label="Fournisseur"><input value={f.supplier} onChange={e => set({ supplier: e.target.value })} /></Field>
        </div>
        <div className="grid-2">
          {isNew
            ? <Field label={`Stock de départ (${f.unit})`}><input inputMode="decimal" value={f.stock} onChange={e => set({ stock: e.target.value })} /></Field>
            : <Field label={`Stock actuel (${f.unit})`} hint="Modifiable directement dans le tableau"><input value={num(article.stock, 3)} disabled /></Field>}
          <Field label={`Stock minimum (${f.unit})`} hint="En dessous, l’article est signalé à racheter"><input inputMode="decimal" value={f.min_stock} onChange={e => set({ min_stock: e.target.value })} /></Field>
        </div>
        <div className="field">
          <span>Allergènes contenus</span>
          <div className="chips">
            {ALLERGENS.map(a => {
              const on = f.allergens.includes(a.key)
              return <button type="button" key={a.key} aria-pressed={on} className={'chip-toggle' + (on ? ' on' : '')}
                onClick={() => set({ allergens: on ? f.allergens.filter(k => k !== a.key) : [...f.allergens, a.key] })}>{a.icon} {a.label}</button>
            })}
          </div>
        </div>
        <div className="row">
          {!isNew && <button type="button" className="danger" onClick={remove}>Supprimer</button>}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy}>{isNew ? 'Ajouter' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  )
}
