// Les 14 allergènes à déclaration obligatoire (règlement UE 1169/2011)
export const ALLERGENS = [
  { key: 'gluten', label: 'Gluten', icon: '🌾' },
  { key: 'crustaces', label: 'Crustacés', icon: '🦐' },
  { key: 'oeufs', label: 'Œufs', icon: '🥚' },
  { key: 'poissons', label: 'Poissons', icon: '🐟' },
  { key: 'arachides', label: 'Arachides', icon: '🥜' },
  { key: 'soja', label: 'Soja', icon: '🫘' },
  { key: 'lait', label: 'Lait', icon: '🥛' },
  { key: 'fruits_coque', label: 'Fruits à coque', icon: '🌰' },
  { key: 'celeri', label: 'Céleri', icon: '🥬' },
  { key: 'moutarde', label: 'Moutarde', icon: '🟡' },
  { key: 'sesame', label: 'Sésame', icon: '⚪' },
  { key: 'sulfites', label: 'Sulfites', icon: '🍷' },
  { key: 'lupin', label: 'Lupin', icon: '🌼' },
  { key: 'mollusques', label: 'Mollusques', icon: '🦪' },
]
export const ALLERGEN_BY_KEY = Object.fromEntries(ALLERGENS.map(a => [a.key, a]))
