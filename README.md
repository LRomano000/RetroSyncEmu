# RetroSync

📋 **Para testar, siga o [PASSO-A-PASSO.md](PASSO-A-PASSO.md).**

Emulador pessoal de **Game Boy, Game Boy Color, Game Boy Advance e Super Nintendo** que roda no
navegador (Chrome/Edge) e pode ser instalado como app no Android, Windows e macOS.
Todas as ROMs, saves e save states ficam **no seu Google Drive**. Não existe servidor: o app
fala direto com o Drive a partir do navegador, e funciona offline com uma cópia local.

---

## Decisões técnicas (resumo)

| Parte | Escolha | Por quê |
|---|---|---|
| Base | Vite + TypeScript | Build rápido, gera site estático (ideal para o GitHub Pages). |
| Interface | Preact + Signals | Mesmo jeito de programar do React, mas com ~10 KB. |
| Emulação | [Nostalgist.js](https://nostalgist.js.org) 0.23.0 | API direta para SRAM, save states (com screenshot), screenshots e sistema de arquivos do emulador. O EmulatorJS traz uma interface pronta e dá menos controle sobre esses arquivos. |
| Cores | mGBA (GB/GBC/GBA) e Snes9x (SNES), RetroArch 1.21.0 WebAssembly | Versão fixa, servida pelo próprio app (pasta `public/cores`, com hashes em `SHA256SUMS`). Assim um save state feito no PC abre no celular. |
| Cache local | IndexedDB + armazenamento persistente | Joga offline; o navegador é instruído a não apagar os dados. |
| Login/Drive | Google Identity Services + Drive API v3 | Só o escopo `drive.file` (não sensível): o app enxerga apenas os arquivos que ele mesmo criou. |
| App instalável | Service worker (Workbox) + manifest | Os cores (~11 MB) ficam em cache para abrir sem internet. |

### Como a sincronização funciona
- Cada arquivo tem um **md5** local, o md5 que o Drive informa e o md5 "base" da última sync.
  Comparando os três, o app sabe quem mudou: só o aparelho → envia; só o Drive → baixa.
- **Conflito** (o mesmo arquivo mudou nos dois lados): a versão mais nova fica valendo e a outra
  **é guardada**. Para saves, a cópia vai para `Backups/<sistema>/<jogo>/…-conflito-<aparelho>.srm`
  e aparece na tela de backups para restaurar. O `library.json` é mesclado item por item.
- A sync roda ao abrir o app, ao entrar e ao sair de um jogo, quando o app vai para segundo
  plano, quando a internet volta e a cada 2 minutos. O indicador no topo mostra o status
  (verde = sincronizado, azul = sincronizando, amarelo = offline/reconectar, vermelho = erro) e
  quantas alterações estão pendentes. Toque nele para sincronizar na hora.

### Estrutura no Google Drive
```
RetroSync/                       (nome configurável nas Configurações)
  ROMs/gb, ROMs/gbc, ROMs/gba, ROMs/snes
  Saves/<sistema>/<jogo>.srm     (+ extras, ex.: .rtc)
  States/<sistema>/<jogo>/<data>.state + .png        (manual)
  States/<sistema>/<jogo>/auto_<data>.state + .png   (autosave; ficam os 3 mais recentes)
  Backups/<sistema>/<jogo>/<data>.srm
  library.json                   (biblioteca e configurações)
```
> ⚠️ Por causa do escopo `drive.file`, **ROMs colocadas manualmente no Drive não aparecem**.
> Importe sempre pelo botão **Importar ROMs** do app.

---

## Passo 1 — Configurar o Google Cloud (uma vez só, ~10 minutos)

1. Acesse <https://console.cloud.google.com/> com a sua conta Google.
2. No topo, clique no seletor de projetos → **Novo projeto** → nome `RetroSync` → **Criar**.
   Confirme que o projeto novo está selecionado no topo.
3. Ative a API do Drive: menu ☰ → **APIs e serviços** → **Biblioteca** → busque
   **Google Drive API** → **Ativar**.
4. Configure a tela de consentimento: menu ☰ → **APIs e serviços** → **Tela de consentimento OAuth**
   (em algumas contas aparece como **Google Auth Platform**) → **Começar**.
   - Nome do app: `RetroSync`; e-mail de suporte: o seu.
   - Público: **Externo**.
   - Dados de contato: o seu e-mail. Aceite os termos → **Criar**.
   - **Não envie logotipo** (logotipo exige verificação da marca pelo Google).
5. Escopos: em **Acesso a dados** (ou "Escopos") → **Adicionar ou remover escopos** → marque
   `.../auth/drive.file` ("Ver, editar, criar e excluir apenas os arquivos do Google Drive que você usa com este app")
   → **Atualizar** → **Salvar**.
6. Publique: em **Público** (ou "Status de publicação") clique **Publicar app** → **Confirmar**.
   O status muda para **Em produção**. Como `drive.file` não é sensível, não é preciso
   enviar o app para verificação, e a autorização não expira toda semana (o que acontece no modo "Teste").
7. Crie o Client ID: **Clientes** (ou **Credenciais** → **Criar credenciais** → **ID do cliente OAuth**):
   - Tipo: **Aplicativo da Web**; nome: `RetroSync web`.
   - **Origens JavaScript autorizadas** → adicione:
     - `http://localhost:5173` (para testar no PC)
     - `https://SEU-USUARIO.github.io` (para o app publicado; só o domínio, sem a pasta)
   - Deixe "URIs de redirecionamento" vazio → **Criar**.
8. Copie o **ID do cliente** (algo como `1234-abcd.apps.googleusercontent.com`). Ele não é
   segredo, pode ficar no código/configuração do site.

> Na primeira vez que entrar, o Google pode mostrar "O Google não verificou este app" ou pedir
> para confirmar o acesso. Como o app é seu, clique em **Avançado → Acessar RetroSync** e permita.

---

## Passo 2 — Rodar no seu PC

1. Instale o **Node.js 22 (LTS)**: <https://nodejs.org> (Windows/macOS: baixe o instalador e avance).
2. Baixe este projeto (botão **Code → Download ZIP** no GitHub, depois descompacte) ou use `git clone`.
3. Abra um terminal **dentro da pasta do projeto** (Windows: clique com o botão direito na pasta →
   "Abrir no Terminal"; macOS: app Terminal, digite `cd ` e arraste a pasta) e rode:

```bash
npm install
```

```bash
npm run dev
```

4. Abra <http://localhost:5173> no Chrome ou Edge.
5. Vá em **⚙ Configurações → Client ID do Google**, cole o ID do passo 1 e clique **Salvar Client ID**.
   (Alternativa: crie um arquivo `.env.local` com a linha `VITE_GOOGLE_CLIENT_ID=seu-id` e reinicie o `npm run dev`.)
6. Clique **Entrar com Google**, autorize e importe suas ROMs.

Para testar o app como ele fica publicado (com modo offline), rode `npm run build` e depois
`npx vite preview --port 5173`.

---

## Passo 3 — Publicar no GitHub Pages

1. Crie uma conta em <https://github.com> (se não tiver) e um repositório novo, por exemplo `retrosync`
   (pode ser privado só se sua conta permitir Pages em repositório privado; senão, público.
   Não há ROMs nem dados pessoais no código).
2. Envie o projeto para o repositório. Pelo site: **Add file → Upload files** e arraste o conteúdo
   da pasta (exceto `node_modules` e `dist`). Ou pelo terminal:

```bash
git remote add origin https://github.com/SEU-USUARIO/retrosync.git
```

```bash
git push -u origin main
```

3. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Settings → Secrets and variables → Actions → aba Variables → New repository variable**:
   nome `GOOGLE_CLIENT_ID`, valor = o ID do cliente.
5. Vá em **Actions**, abra "Publicar no GitHub Pages" e clique **Run workflow** (ou faça qualquer push na `main`).
   Em ~2 minutos o app fica em `https://SEU-USUARIO.github.io/retrosync/`.
6. Confirme que `https://SEU-USUARIO.github.io` está nas origens autorizadas do Client ID (passo 1.7).

> Se o repositório se chamar `SEU-USUARIO.github.io`, o app fica na raiz do domínio; nesse caso
> edite `.github/workflows/deploy.yml` e troque `VITE_BASE: /${{ github.event.repository.name }}/` por `VITE_BASE: /`.

---

## Instalar como app

- **Android (Chrome)**: abra o endereço do app → menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").
- **Windows/macOS (Chrome ou Edge)**: ícone de instalar (monitor com seta) na barra de endereço → **Instalar**.

Depois de instalado e aberto uma vez com internet, o app abre offline e os jogos já baixados
funcionam sem conexão. Tudo que você jogar offline é sincronizado quando a internet voltar.

---

## Como usar

- **Importar ROMs**: botão **＋ Importar ROMs**, escolha vários arquivos `.gb`, `.gbc`, `.gba`,
  `.sfc` ou `.smc`. O sistema é detectado pela extensão; para trocar, use **⋯ → Jogo → Sistema**
  (ROM, saves, states e backups são movidos juntos).
- **Jogar**: toque na capa. Num aparelho novo, a ROM é baixada do Drive na primeira vez
  ("☁ na nuvem" → "● offline"). **⋯ → Liberar espaço neste aparelho** apaga só a cópia local.
- **Menu do jogo**: botão ☰ no canto, tecla **Esc** ou botão **Home/Guide** do controle.
  Lá ficam: salvar/carregar state, backups do save, configurações do jogo, tela cheia, reiniciar e sair.
- **Saves do jogo (SRAM)**: gravados automaticamente a cada 10 s quando mudam, e ao sair.
- **Autosave**: save state automático no intervalo escolhido (30 s a 30 min) e ao sair.
- **Ao abrir o jogo, carregar**: último state (auto ou manual), último autosave, último manual,
  só o save do jogo, ou nada. "Nada / Começar do zero" guarda o save atual em Backups antes.
- **Backups do save**: cópia da SRAM no intervalo escolhido (10 s a 30 min), só quando mudou,
  mantendo os N mais recentes. Restaurar reinicia o jogo com aquele save, guardando o atual antes.
- **Controles na tela** (celular/tablet): aparecem sozinhos em telas de toque. Tamanho, opacidade e
  mostrar/ocultar ficam em **☰ → Configurações deste jogo → Controles na tela**. Em pé, o jogo fica
  no topo e os botões embaixo; deitado, os botões ficam sobre as bordas.
- **Pastas**: escolha um sistema (GB, GBC, GBA ou SNES) e use **＋ Nova pasta**. Para colocar um jogo
  numa pasta: **⋯ → Jogo → Pasta**. Apagar uma pasta não apaga os jogos, só os tira dela.
- **Grade ou lista**: botões ▦ / ☰ na barra da biblioteca.
- **Controle**: ⚙ Configurações → Controle. Escolha o sistema, toque em **Mudar** e aperte o botão
  desejado. O analógico esquerdo funciona como direcional. Fora do jogo, o controle navega o app:
  direcional move o foco, **A** confirma, **B** volta/fecha. Com o menu do jogo aberto, o mesmo vale
  para o menu e nenhum botão chega ao jogo. (Caixas de texto, como o nome de uma pasta, ainda pedem teclado.)
- **Aplicar para todos os jogos** (⚙ → Padrões): remove as configurações individuais de cada jogo,
  para todos seguirem os padrões. Os intervalos vão de 30 s a 30 min; o padrão é 10 min.
- **Teclado** (fixo): setas = direcional · X = A · Z = B · S = X · A = Y · Q = L · W = R ·
  Enter = Start · Shift direito = Select · Esc = menu.

---

## Limitações conhecidas

- O login do Google no navegador dura 1 hora e é renovado sozinho; se o navegador bloquear a
  renovação, o indicador fica amarelo com **Reconectar**: toque nele. Dá para jogar offline enquanto isso.
- Save states só são garantidos com os mesmos cores. Se um dia os cores forem trocados, os
  states antigos podem não abrir, mas os saves `.srm` continuam funcionando.
- Foco em Chrome/Edge. Safari/iOS não são alvo deste projeto.

---

## Para desenvolvimento

- `npm run dev`: servidor local · `npm run build`: checa tipos e gera `dist/`.
- **Teste ponta a ponta** com um Google Drive falso e dois "aparelhos" (importação, SRAM,
  states, backups, sync, conflito, troca de sistema, offline e controle):

```bash
python3 scripts/make-test-roms.py test-roms
```

```bash
npm run build && npx vite preview --port 5199
```

```bash
node tests/e2e.mjs
```

```bash
node tests/pause.mjs
```

  (o último comando em outro terminal; requer Playwright instalado). As ROMs de teste são
  homebrew mínimas geradas pelo script, sem nenhum conteúdo comercial.

Estrutura do código: `src/drive` (login e API do Drive), `src/sync` (motor de sincronização),
`src/library` (biblioteca, saves, states, backups), `src/emulator` (sessão de jogo e controle),
`src/ui` (telas).
