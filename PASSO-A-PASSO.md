# Passo a passo para testar o RetroSync

Seu app vai ficar em: **https://lromano000.github.io/RetroSyncEmu/**

Detalhes extras de cada etapa estão no `README.md`. Siga na ordem.

---

## Etapa 1 — Google Cloud (só uma vez, ~10 min)

1. Abra https://console.cloud.google.com/ com a conta Google onde quer guardar os jogos.
2. Topo da página → seletor de projetos → **Novo projeto** → nome `RetroSync` → **Criar**.
   Confira que o projeto `RetroSync` está selecionado no topo.
3. Menu ☰ → **APIs e serviços** → **Biblioteca** → busque **Google Drive API** → **Ativar**.
4. Menu ☰ → **APIs e serviços** → **Tela de consentimento OAuth** (pode aparecer como
   **Google Auth Platform**) → **Começar**:
   - Nome do app: `RetroSync` · E-mail de suporte: o seu
   - Público: **Externo**
   - Contato: o seu e-mail → aceite → **Criar**
   - Não envie logotipo.
5. **Acesso a dados** → **Adicionar ou remover escopos** → marque
   `.../auth/drive.file` → **Atualizar** → **Salvar**.
6. **Público** → **Publicar app** → **Confirmar** (status: **Em produção**).
7. **Clientes** → **Criar cliente**:
   - Tipo: **Aplicativo da Web** · Nome: `RetroSync web`
   - **Origens JavaScript autorizadas** → **Adicionar URI** duas vezes:
     - `https://lromano000.github.io`
     - `http://localhost:5173`
   - **Criar**.
8. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`). Guarde: você vai usar na etapa 2.

---

## Etapa 2 — Ligar o GitHub Pages (só uma vez, ~3 min)

No repositório https://github.com/LRomano000/RetroSyncEmu:

1. **Settings** → (menu lateral) **Pages** → em **Build and deployment / Source**, escolha **GitHub Actions**.
2. **Settings** → **Secrets and variables** → **Actions** → aba **Variables** → **New repository variable**:
   - Name: `GOOGLE_CLIENT_ID`
   - Value: o ID do cliente da etapa 1 → **Add variable**.
3. Aba **Actions** → clique em **Publicar no GitHub Pages** → **Run workflow** → **Run workflow**.
4. Espere a bolinha ficar verde (~2 min). Pronto: o app está em https://lromano000.github.io/RetroSyncEmu/

> Se a bolinha ficar vermelha, clique nela, abra o passo que falhou e me mande uma captura.

---

## Etapa 3 — Testar no PC (Chrome ou Edge)

1. Abra https://lromano000.github.io/RetroSyncEmu/
2. Clique **Entrar com Google**, escolha sua conta. Se aparecer "O Google não verificou este app",
   clique **Avançado → Acessar RetroSync** e permita o acesso.
3. Confira: o indicador no topo fica **verde (Sincronizado)** e no seu Google Drive aparece a pasta
   **RetroSync** com `ROMs`, `Saves`, `States`, `Backups`.
4. **＋ Importar ROMs** → selecione algumas ROMs (dá para escolher várias). Espere o indicador
   voltar ao verde e confira os arquivos em `RetroSync/ROMs/...` no Drive.
5. Abra um jogo que tenha save (ex.: um RPG). Jogue e **salve dentro do jogo**.
6. Aperte **Esc** (ou o botão ☰) → **Salvar state** → **Continuar**. Jogue mais um pouco.
7. **Esc → Sair do jogo**. No Drive devem aparecer:
   - `Saves/<sistema>/<jogo>.srm`
   - `States/<sistema>/<jogo>/` com `.state` e `.png`
   - `Backups/<sistema>/<jogo>/`
8. A capa do jogo na biblioteca vira a screenshot do último state.
9. Abra o jogo de novo: ele deve voltar exatamente de onde você saiu (autosave).
10. **Controle**: conecte um controle (USB ou Bluetooth) → ⚙ → **Controle** → aperte botões e veja
    eles acenderem. Use **Mudar** se algum estiver trocado. Teste dentro de um jogo.
11. **Instalar**: ícone de instalar na barra de endereço → **Instalar**.

## Etapa 4 — Testar no celular Android (Chrome)

1. Abra https://lromano000.github.io/RetroSyncEmu/ no Chrome do celular.
2. **Entrar com Google** com a **mesma conta**.
3. A biblioteca aparece com as ROMs do PC marcadas como **☁ na nuvem**.
4. Toque no jogo que você jogou no PC: ele baixa a ROM e abre **no ponto em que você parou no PC**.
5. Menu ⋮ do Chrome → **Instalar app**. Abra pelo ícone na tela inicial e use **☰ → Tela cheia**.
6. Jogue, salve e saia. Volte ao PC, toque no indicador de sync e abra o jogo: o progresso do celular está lá.

## Etapa 5 — Testes de segurança dos saves

- **Offline**: no celular, ative o modo avião, abra um jogo já baixado (marcado **● offline**),
  jogue e salve. O indicador fica **amarelo (Offline)**. Desligue o modo avião: ele sincroniza sozinho.
- **Conflito**: com os dois aparelhos sem internet, jogue o mesmo jogo e salve nos dois. Ligue a
  internet nos dois. Em **⋯ → Backups** do jogo aparece uma versão marcada como **conflito**:
  nada foi perdido, e você pode restaurá-la.
- **Backups**: **⋯ → Backups** → **Restaurar** em um backup antigo. O jogo abre com aquele save
  (o save atual fica guardado como "Antes de restaurar").

---

## O que me mandar se der problema
- Em que etapa e passo parou.
- Uma captura de tela, inclusive do indicador de sync (passe o mouse ou segure o dedo sobre ele
  para ver a mensagem).
- No PC, se puder: **F12 → aba Console**, captura das linhas em vermelho.
