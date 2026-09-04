# Sistema de Vendas — Deploy na Vercel

Esse é um app 100% estático (1 arquivo HTML), sem backend. Os dados (vendas, clientes,
metas) ficam salvos no `localStorage` do navegador de cada dispositivo — ou seja,
o site fica acessível por um link, mas os dados **não sincronizam** entre
computador/celular sozinhos. Pra levar os dados de um aparelho pra outro, use o
botão de **Backup** (baixa um `.json`) e depois **Restaurar backup** no outro
aparelho.

## Opção 1 — Deploy com a Vercel CLI (mais rápido, sem precisar de GitHub)

1. Instale o Node.js (se ainda não tiver): https://nodejs.org
2. Abra o terminal dentro desta pasta (`deploy/`) e rode:
   ```
   npx vercel
   ```
3. Ele vai pedir login (abre o navegador — pode entrar com GitHub, GitLab, e-mail etc.).
4. Responda as perguntas do assistente (pode aceitar as opções padrão).
5. Ao final ele te dá um link tipo `https://sistema-vendas-xxxx.vercel.app` — já é o site no ar.
6. Pra publicar atualizações depois, rode `npx vercel --prod` na mesma pasta.

## Opção 2 — Deploy pelo site da Vercel (com GitHub)

1. Crie um repositório no GitHub e suba os arquivos desta pasta (`index.html` e `vercel.json`).
2. Entre em https://vercel.com → **Add New... → Project**.
3. Selecione o repositório que você criou.
4. Não precisa configurar nada (é só HTML estático) — clique em **Deploy**.
5. Em alguns segundos o site estará no ar com uma URL `.vercel.app`.

## Domínio próprio (opcional)

Depois do deploy, em **Project → Settings → Domains** dá pra adicionar um domínio
próprio (ex: `vendas.suaoficina.com.br`), seguindo as instruções de DNS que a
Vercel mostra.
