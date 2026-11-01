import { supabase } from './supabase'
import { q } from './useData'
import { unitFactor } from './format'

export async function loadCatalogue() {
  const [articles, recipes, items, categories] = await Promise.all([
    q(supabase.from('articles').select('*').order('name')),
    q(supabase.from('recipes').select('*').order('category').order('name')),
    q(supabase.from('recipe_items').select('*')),
    loadCategories(),
  ])
  const articlesById = Object.fromEntries(articles.map(a => [a.id, a]))
  const itemsByRecipe = {}
  for (const it of items) (itemsByRecipe[it.recipe_id] ||= []).push(it)
  return { articles, recipes, items, articlesById, itemsByRecipe, categories }
}

export function allergensFromLines(lines, articlesById, extra = [], traces = []) {
  const contains = new Set(extra)
  for (const l of lines) for (const a of articlesById[l.article_id]?.allergens || []) contains.add(a)
  return { contains: [...contains], traces: traces.filter(t => !contains.has(t)) }
}

export function allergensOf(recipe, cat) {
  return allergensFromLines(cat.itemsByRecipe[recipe.id] || [], cat.articlesById, recipe.extra_allergens || [], recipe.traces || [])
}

export const lineCost = (qty, article) => article ? (Number(qty) || 0) / unitFactor(article.unit) * Number(article.price) : 0

export function recipeCost(recipe, cat) {
  return (cat.itemsByRecipe[recipe.id] || []).reduce((s, it) => s + lineCost(it.quantity, cat.articlesById[it.article_id]), 0)
}

// ---------- Catégories ----------
// Liste ordonnée des catégories (table « categories », gérée depuis le site)
export async function loadCategories() {
  const { data, error } = await supabase.from('categories').select('*').order('position').order('name')
  return error ? [] : data // avant la mise à jour SQL : pas encore de table
}

// Regroupe des éléments par catégorie, dans l'ordre choisi sur le site, « Sans catégorie » à la fin
export function groupByCategory(items, getCat, categories) {
  const order = new Map((categories || []).map((c, i) => [c.name, i]))
  const groups = new Map()
  for (const it of items) {
    const c = (getCat(it) || '').trim()
    if (!groups.has(c)) groups.set(c, [])
    groups.get(c).push(it)
  }
  const rank = c => (c === '' ? 1e9 : order.has(c) ? order.get(c) : 1e6)
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([name, list]) => ({ name, label: name || 'Sans catégorie', items: list }))
}

// ---------- Formats : pièce, gâteau (pers.), cadre (60 pers.), bac (½ / entier) ----------
export const fmtOf = r => (r ? r.format || (r.servings ? 'gateau' : null) : null)

export function formatLabel(r) {
  switch (fmtOf(r)) {
    case 'gateau': return r.servings ? `${r.servings} pers.` : 'gâteau'
    case 'cadre': return `cadre ${r.servings || 60} pers.`
    case 'bac': return r.bac_size === 'demi' ? 'bac ½' : 'bac'
    default: return ''
  }
}

export const unitWord = r => ({ gateau: 'gâteau', cadre: 'cadre', bac: 'bac' }[fmtOf(r)] || 'pièce')

// Pour recalculer les quantités entre deux tailles d'une même famille
export function sizeUnits(r) {
  const f = fmtOf(r)
  if (f === 'bac') return { family: 'bac', units: r.bac_size === 'demi' ? 1 : 2 }
  if (f === 'gateau' || f === 'cadre') return { family: 'pers', units: Number(r.servings) || (f === 'cadre' ? 60 : 0) }
  return { family: null, units: 0 }
}

export const FORMAT_FILTERS = [['piece', 'À la pièce'], ['gateau', 'Gâteaux'], ['cadre', 'Cadres'], ['bac', 'Bacs']]
export const matchesFormat = (r, f) => !f || (fmtOf(r) || 'piece') === f

// Nom affiché d'un produit : « Fraisier — 6 pers. », « Forêt noire — cadre 60 pers. », « Riz — bac ½ »
export const productName = r => {
  if (!r) return ''
  const l = formatLabel(r)
  return l ? `${r.name} — ${l}` : r.name
}
