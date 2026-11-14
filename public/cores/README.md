# Cores libretro (fixos)

Servidos pelo próprio app, nunca por CDN, para que save states sejam compatíveis entre aparelhos.

| Core | Sistemas | Origem |
|---|---|---|
| mgba_libretro.js/.wasm | GB, GBC, GBA | RetroArch 1.21.0 (Emscripten), pacote npm `@rebitplay/retroarch-emscripten@2.0.0` |
| snes9x_libretro.js/.wasm | SNES | idem |

Hashes em `SHA256SUMS`. Não troque estes arquivos sem necessidade: um core diferente pode
não abrir save states antigos (saves .srm continuam compatíveis).
