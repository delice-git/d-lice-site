import { useCallback, useEffect, useState } from 'react'

// Lance une requête Supabase et lève une erreur lisible si elle échoue
export async function q(request) {
  const { data, error } = await request
  if (error) throw new Error(error.message)
  return data
}

export function useData(loader, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    setLoading(true)
    try { setData(await loader()); setError(null) }
    catch (e) { setError(e.message || String(e)) }
    finally { setLoading(false) }
  }, deps)
  useEffect(() => { reload() }, [reload])
  return { data, error, loading, reload, setData }
}
