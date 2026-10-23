import { useMemo, useState } from 'react'
import { supabase } from './supabase'
import { q, useData } from './useData'
import { eur, num, toNumber } from './format'
import { ALLERGENS } from './allergenList'
import { AllergenBadges } from './AllergenBadges'
import { Empty, ErrorBox, Field, Loading, Modal, PageHeader, StockMoveModal } from './ui'
import { notify } from './Toast'

export default function Articles() {
  const data = useData(() => q(supabase.from('articles').select('*').order('category').order('name')), [])
  const [edit, setEdit] = useState(null)
  const [move, setMove] = useState(null)
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

  async function remove(a) {
    if (!confirm(`Supprimer l’article « ${a.name} » ?`)) return
    try {
      await q(supabase.from('articles').delete().eq('id', a.id))
      notify('Article supprimé'); data.reload()
    } catch (e) {
      notify(/foreign key|violates/i.test(e.message) ? 'Cet article est utilisé dans une recette : retirez-le de la recette d’abord.' : e.message, 'error')
    }
  }

  if (data.loading && !data.data) return <Loading />
  let lastCat = null

  return (
    <>
      <PageHeader title="Stock matières" subtitle={`Valeur du stock : ${eur(value)}${lowCount ? ` · ${lowCount} article${lowCount > 1 ? 's' : ''} sous le minimum` : ''}`}>
        <button className="primary" onClick={() => setEdit({})}>Nouvel article</button>
      </PageHeader>
      <ErrorBox error={data.error} />
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Rechercher un article, une catégorie, un fournisseur…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 380 }} aria-label="Rechercher" />
        <label className="row small-text" style={{ gap: 8 }}>
          <input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} /> Seulement à racheter
        </label>
      </div>
      {!rows.length ? <Empty>{data.data?.length ? 'Aucun article ne correspond.' : 'Aucun article. Ajoutez vos matières premières : farine, beurre, œufs…'}</Empty> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Article</th><th className="num">Stock</th><th className="num">Minimum</th><th className="num">Prix</th><th className="num">Valeur</th><th>Allergènes</th><th>Fournisseur</th><th></th></tr>
            </thead>
            <tbody>
              {rows.flatMap(a => {
                const out = []
                if (a.category !== lastCat) { lastCat = a.category; out.push(<tr key={'g' + a.id} className="group"><td colSpan={8}>{a.category || 'Sans catégorie'}</td></tr>) }
                const low = Number(a.stock) < Number(a.min_stock)
                out.push(
                  <tr key={a.id} className={Number(a.stock) <= 0 ? 'out' : low ? 'low' : ''}>
                    <td><b>{a.name}</b></td>
                    <td className="num"><b>{num(a.stock, 3)}</b> {a.unit}</td>
                    <td className="num muted">{num(a.min_stock, 3)}</td>
                    <td className="num">{eur(a.price)}/{a.unit}</td>
                    <td className="num">{eur(Math.max(0, a.stock) * a.price)}</td>
                    <td><AllergenBadges contains={a.allergens} compact /></td>
                    <td className="muted">{a.supplier}</td>
                    <td className="num">
                      <span className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                        <button className="small" onClick={() => setMove(a)}>Mouvement</button>
                        <button className="small ghost" onClick={() => setEdit(a)}>Modifier</button>
                      </span>
                    </td>
                  </tr>
                )
                return out
              })}
            </tbody>
          </table>
        </div>
      )}

      {edit && <ArticleForm article={edit} onClose={() => setEdit(null)} onDelete={edit.id ? () => { setEdit(null); remove(edit) } : null}
        onSaved={() => { setEdit(null); data.reload() }} categories={[...new Set((data.data || []).map(a => a.category).filter(Boolean))]} />}
      {move && (
        <StockMoveModal title={`Stock — ${move.name}`} unit={move.unit} current={move.stock} onClose={() => setMove(null)}
          onSubmit={async delta => {
            try { await q(supabase.rpc('adjust_article_stock', { p_article: move.id, p_delta: delta })); notify('Stock mis à jour'); data.reload() }
            catch (e) { notify(e.message, 'error'); throw e }
          }} />
      )}
    </>
  )
}

function ArticleForm({ article, onClose, onSaved, onDelete, categories }) {
  const isNew = !article.id
  const [f, setF] = useState({
    name: article.name || '', category: article.category || '', unit: article.unit || 'kg',
    price: article.price ?? '', stock: article.stock ?? '', min_stock: article.min_stock ?? '',
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

  return (
    <Modal title={isNew ? 'Nouvel article' : `Modifier — ${article.name}`} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <div className="grid-2">
          <Field label="Nom"><input autoFocus value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Ex. : Farine T55" /></Field>
          <Field label="Catégorie">
            <input list="art-cats" value={f.category} onChange={e => set({ category: e.target.value })} placeholder="Ex. : Farines" />
            <datalist id="art-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </Field>
        </div>
        <div className="grid-3">
          <Field label="Unité de stock" hint={f.unit === 'pièce' ? 'Recettes saisies en pièces' : `Recettes saisies en ${f.unit === 'kg' ? 'grammes' : 'millilitres'}`}>
            <select value={f.unit} onChange={e => set({ unit: e.target.value })}>
              <option value="kg">kg</option><option value="L">L</option><option value="pièce">pièce</option>
            </select>
          </Field>
          <Field label={`Prix d’achat par ${f.unit} (€ HTVA)`}><input inputMode="decimal" value={f.price} onChange={e => set({ price: e.target.value })} /></Field>
          <Field label="Fournisseur"><input value={f.supplier} onChange={e => set({ supplier: e.target.value })} /></Field>
        </div>
        <div className="grid-2">
          {isNew
            ? <Field label={`Stock de départ (${f.unit})`}><input inputMode="decimal" value={f.stock} onChange={e => set({ stock: e.target.value })} /></Field>
            : <Field label={`Stock actuel (${f.unit})`} hint="Utilisez « Mouvement » pour le modifier"><input value={num(article.stock, 3)} disabled /></Field>}
          <Field label={`Stock minimum (${f.unit})`} hint="En dessous, l’article est signalé à racheter"><input inputMode="decimal" value={f.min_stock} onChange={e => set({ min_stock: e.target.value })} /></Field>
        </div>
        <div className="field">
          <span>Allergènes contenus</span>
          <div className="row" style={{ gap: 6 }}>
            {ALLERGENS.map(a => {
              const on = f.allergens.includes(a.key)
              return (
                <button type="button" key={a.key} aria-pressed={on} className={'alg-toggle' + (on ? ' on' : '')}
                  onClick={() => set({ allergens: on ? f.allergens.filter(k => k !== a.key) : [...f.allergens, a.key] })}>
                  {a.icon} {a.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="row">
          {onDelete && <button type="button" className="danger" onClick={onDelete}>Supprimer</button>}
          <span className="spacer" />
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={busy}>{isNew ? 'Ajouter l’article' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  )
}
