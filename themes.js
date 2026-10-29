// Thèmes disponibles. Les couleurs réelles sont dans styles.css ([data-theme="..."]).
export const THEMES = [
  { key: 'delice', label: 'Délice', brand: '#3f2b21', accent: '#14a3da', bg: '#f1eeea', surface: '#ffffff' },
  { key: 'foret', label: 'Forêt', brand: '#1f4a43', accent: '#d4a23f', bg: '#eef0ec', surface: '#ffffff' },
  { key: 'framboise', label: 'Framboise', brand: '#6e1f3c', accent: '#f2b5c4', bg: '#f5eef0', surface: '#ffffff' },
  { key: 'ocean', label: 'Océan', brand: '#183a5a', accent: '#49b3b8', bg: '#ebf0f4', surface: '#ffffff' },
  { key: 'seigle', label: 'Seigle', brand: '#4b3427', accent: '#e2893a', bg: '#f1ece6', surface: '#fffdfa' },
  { key: 'nuit', label: 'Nuit', brand: '#161d20', accent: '#e3b450', bg: '#111517', surface: '#1a2023' },
]
const KEY = 'ltdd-theme'

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'delice' } catch { return 'delice' }
}

export function applyTheme(key) {
  const t = THEMES.find(x => x.key === key) || THEMES[0]
  document.documentElement.dataset.theme = t.key
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', t.brand)
  try { localStorage.setItem(KEY, t.key) } catch { /* navigation privée */ }
  return t.key
}
