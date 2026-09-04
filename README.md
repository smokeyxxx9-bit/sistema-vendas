# Sistema de Vendas — Deploy + Sincronização entre computadores

O app agora sincroniza automaticamente entre todos os aparelhos usando o
Supabase (banco de dados na nuvem, gratuito). Sem configurar, ele continua
funcionando 100% normal, só que sem sincronizar (cada aparelho isolado, como
antes).

## Passo 1 — Criar o projeto no Supabase (gratuito)

1. Entre em https://supabase.com e crie uma conta (dá pra usar login do GitHub).
2. Clique em **New Project**. Dê um nome (ex: `oficina-vendas`), crie uma senha
   de banco (guarde ela, mas não vai precisar usar no sistema) e escolha a
   região mais próxima (South America - São Paulo, se aparecer).
3. Espere ~1-2 minutos o projeto ser criado.

## Passo 2 — Criar a tabela de dados

1. No menu lateral do projeto, clique em **SQL Editor** → **New query**.
2. Abra o arquivo `supabase-setup.sql` (nesta mesma pasta), copie todo o
   conteúdo, cole no editor e clique em **Run**.
3. Isso cria a tabela `kv_store` e já libera o acesso e o tempo real.

## Passo 3 — Pegar a URL e a chave do projeto

1. No menu lateral, vá em **Project Settings** (ícone de engrenagem) → **API**.
2. Copie o valor de **Project URL** (algo como `https://xxxxx.supabase.co`).
3. Copie o valor de **anon public** (uma chave longa, em "Project API keys").

## Passo 4 — Colar no arquivo do sistema

1. Abra o `index.html` num editor de texto (Bloco de Notas, VS Code, etc.).
2. Procure por (perto do início do `<script>`):
   ```js
   var SUPABASE_URL = "COLE_AQUI_A_URL_DO_SEU_PROJETO_SUPABASE";
   var SUPABASE_ANON_KEY = "COLE_AQUI_A_ANON_KEY_DO_SEU_PROJETO_SUPABASE";
   ```
3. Troque pelos valores que você copiou no Passo 3, por exemplo:
   ```js
   var SUPABASE_URL = "https://xxxxx.supabase.co";
   var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
   ```
4. Salve o arquivo.

## Passo 5 — Publicar (ou atualizar) no Vercel

- Se ainda não publicou: suba `index.html` e `vercel.json` pro GitHub e
  importe o repositório na Vercel (add new project → import).
- Se já está publicado: é só subir o `index.html` atualizado no mesmo
  repositório do GitHub (substituindo o antigo, mesmo nome) — a Vercel
  republica sozinha em segundos.

## Como saber se funcionou

No topo do sistema, ao lado do título "Painel de Vendas", aparece uma
etiqueta:
- **● nuvem conectada** (verde) — sincronizando normalmente.
- **○ conectando…** (amarelo) — ainda carregando.
- **⚠ erro de conexão** (vermelho) — confira se colou a URL/chave certas e se
  rodou o SQL do Passo 2.
- **○ somente local** (cinza) — Supabase ainda não configurado (Passo 4).

Depois de configurado, uma venda lançada em um computador aparece nos outros
em poucos segundos — sem precisar mais de backup manual pra sincronizar. O
botão de Backup continua existindo, agora como uma cópia de segurança extra.

## Importante sobre segurança

Essa configuração libera leitura/escrita pra qualquer um que tenha o link do
site (mesma lógica de acesso que já existia com a senha do sistema). Isso é
adequado pra uso interno da oficina. Se um dia quiser um controle de acesso
mais forte (ex: cada vendedor com login próprio), dá pra evoluir depois.
