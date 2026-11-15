/**
 * Extrai a SRAM atual de um save state do mGBA.
 *
 * Por quê: no mGBA (libretro), depois que um save state é carregado, o arquivo .srm que o
 * RetroArch grava deixa de acompanhar o que o jogo salva. O state, porém, sempre leva uma
 * cópia viva da SRAM (bloco "extdata" SAVEDATA). Então, nesse caso, a SRAM vem do state.
 *
 * Formato: [rzip "#RZIPv1#" com blocos zlib] -> "RASTATE" com blocos (MEM, END) ->
 * MEM = estado do mGBA + cabeçalhos extdata { tag u32, tamanho i32, offset u64 }, terminados por tag 0.
 */

const EXTDATA_SAVEDATA = 2
/** Tamanho da estrutura de estado do mGBA (onde começam os cabeçalhos extdata): GB e GBA. */
const KNOWN_STRUCT_SIZES = [0x11800, 0x61000]

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len))

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function unrzip(b: Uint8Array): Promise<Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const total = Number(v.getBigUint64(12, true))
  const out = new Uint8Array(total)
  let pos = 20
  let w = 0
  while (pos + 4 <= b.length && w < total) {
    const n = v.getUint32(pos, true)
    pos += 4
    const chunk = await inflate(b.subarray(pos, pos + n))
    out.set(chunk.subarray(0, total - w), w)
    w += chunk.length
    pos += n
  }
  return out
}

function memChunk(b: Uint8Array): Uint8Array {
  if (ascii(b, 0, 7) !== 'RASTATE') return b // estado "cru" do core
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let pos = 8
  while (pos + 8 <= b.length) {
    const tag = ascii(b, pos, 4)
    const n = v.getUint32(pos + 4, true)
    if (tag === 'MEM ') return b.subarray(pos + 8, pos + 8 + n)
    if (tag === 'END ') break
    pos += 8 + ((n + 7) & ~7)
  }
  throw new Error('save state sem bloco MEM')
}

function findSavedata(mem: Uint8Array): Uint8Array | null {
  const v = new DataView(mem.buffer, mem.byteOffset, mem.byteLength)
  const header = (off: number) => ({ tag: v.getUint32(off, true), size: v.getInt32(off + 4, true), offset: Number(v.getBigUint64(off + 8, true)) })
  const validAt = (off: number) => {
    // Percorre a lista de cabeçalhos a partir de `off` até a tag 0; todos precisam apontar para dentro do buffer.
    let found: Uint8Array | null = null
    for (let i = 0; i < 16 && off + 16 * (i + 1) <= mem.length; i++) {
      const h = header(off + 16 * i)
      if (h.tag === 0) return found
      if (h.tag > 16 || h.size <= 0 || h.offset < off || h.offset + h.size > mem.length) return null
      if (h.tag === EXTDATA_SAVEDATA) found = mem.subarray(h.offset, h.offset + h.size)
    }
    return null
  }
  for (const off of KNOWN_STRUCT_SIZES) {
    if (off + 16 <= mem.length) { const r = validAt(off); if (r) return r }
  }
  for (let off = 0; off + 32 <= mem.length; off += 4) {
    if (v.getUint32(off, true) === EXTDATA_SAVEDATA) { const r = validAt(off); if (r) return r }
  }
  return null
}

/** SRAM (com `length` bytes, o tamanho do .srm do jogo) contida no save state, ou null. */
export async function sramFromMgbaState(state: Blob, length: number): Promise<Blob | null> {
  let b: Uint8Array = new Uint8Array(await state.arrayBuffer())
  if (ascii(b, 0, 6) === '#RZIPv') b = await unrzip(b)
  const data = findSavedata(memChunk(b))
  if (!data || data.length < length) return null
  return new Blob([data.slice(0, length)], { type: 'application/octet-stream' })
}
