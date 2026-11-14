import { useEffect, useState } from 'preact/hooks'
import { getFile, onFileChange } from '../lib/db'

/** URL de objeto para um arquivo guardado no IndexedDB (ex.: screenshot de save state). */
export function useBlobUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) { setUrl(null); return }
    let u: string | null = null
    let alive = true
    void getFile(path).then(f => {
      if (!alive || !f?.blob) return
      u = URL.createObjectURL(f.blob)
      setUrl(u)
    })
    return () => { alive = false; if (u) URL.revokeObjectURL(u) }
  }, [path])
  return url
}

/** Incrementa quando arquivos com o prefixo mudam (para recarregar listas). */
export function useFilesVersion(prefix = '') {
  const [v, setV] = useState(0)
  useEffect(() => {
    let t = 0
    return onFileChange(p => {
      if (!p.startsWith(prefix)) return
      clearTimeout(t)
      t = window.setTimeout(() => setV(x => x + 1), 150)
    })
  }, [prefix])
  return v
}
