import { useEffect, useState } from 'react'

let push = () => {}
export function notify(message, type = 'ok') { push({ id: Math.random(), message, type }) }

export function Toaster() {
  const [items, setItems] = useState([])
  useEffect(() => {
    push = t => {
      setItems(x => [...x, t])
      setTimeout(() => setItems(x => x.filter(i => i.id !== t.id)), t.type === 'error' ? 7000 : 3500)
    }
    return () => { push = () => {} }
  }, [])
  return <div className="toasts" aria-live="polite">{items.map(t => <div key={t.id} className={'toast ' + t.type}>{t.message}</div>)}</div>
}
