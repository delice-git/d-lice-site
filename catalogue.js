import { supabase } from './supabase'
import { q } from './useData'
import { unitFactor } from './format'

export async function loadCatalogue() {
  const [articles, recipes, items] = await Promise.all([
    q(supabase.from('articles').select('*').order('name')),
    q(supabase.from('recipes').select('*').order('category').order('name')),
    q(supabase.from('recipe_items').select('*')),
  ])
  const articlesById = Object.fromEntries(articles.map(a => [a.id, a]))
  const itemsByRecipe = {}
  for (const it of items) (itemsByRecipe[it.recipe_id] ||= []).push(it)
  return { articles, recipes, items, articlesById, itemsByRecipe }
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
