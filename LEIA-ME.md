# Painel de Vendas — Oficina (Windows + iPhone)

## 1) Instalador do Windows (.exe) — sem instalar nada no PC
1. Crie uma conta grátis em github.com e um repositório **privado** (ex.: `pneus-os`).
2. Envie TODOS os arquivos desta pasta para o repositório (botão "Add file → Upload files"; inclua a pasta `.github`).
3. Aba **Actions** → "Gerar instalador Windows" → **Run workflow**. Em ~3 min aparece o arquivo **instalador-windows** na própria página da execução.
4. Baixe, descompacte e rode o `.exe`. Instala com atalho na área de trabalho.
   (O Windows pode mostrar "SmartScreen": clique em "Mais informações → Executar assim mesmo". Acontece porque o instalador não tem certificado pago.)

Para atualizar o sistema depois: troque `web/index.html` no GitHub e rode o workflow de novo.

## 2) iPhone (abrir O.S. pelo celular)
O iPhone não instala .exe/.apk; ele usa o sistema como app pela tela inicial:
1. Coloque a pasta **web** na internet com HTTPS, grátis: em app.netlify.com/drop (ou Cloudflare Pages) arraste a pasta `web`.
2. No iPhone, abra o link no **Safari** → botão Compartilhar → **Adicionar à Tela de Início**.
3. Entre com o login do montador (ele só vê a tela de O.S.).

Windows e iPhone usam o mesmo Supabase, então tudo sincroniza.
