# Controle de Estoque e Vendas

HTML/CSS/JS puro (sem build) + Supabase + Vercel. Arquitetura, ER e backup: `docs/ARQUITETURA.md`.

## Implantação

### 1. Supabase
1. Crie um projeto em supabase.com.
2. **SQL Editor**: rode, nesta ordem, `001_schema.sql`, `002_backup.sql`, `004_loja.sql`, `005_fase2.sql` e `006_editar_venda.sql` (o `003_agendamento.sql` fica para o passo 2 abaixo). Quem já tem o projeto no ar roda **só o `006_editar_venda.sql`**, uma vez, **antes** de publicar o código novo. Rode cada arquivo **uma única vez**.
3. **Authentication > Providers > Email**: desative "Confirm email". Em **Sign In / Providers** desative novos cadastros públicos (sign ups).
4. **Authentication > Users > Add user**: crie primeiro o **administrador** (o primeiro usuário vira admin automaticamente). Depois crie os funcionários e ajuste o papel em Ajustes.
   - O login é por usuário e senha: digitar `maria` vira `maria@loja.local`. Crie os usuários com esse formato de e-mail (ou mude `DOMINIO_LOGIN` em `public/js/config.js`).
5. **Project Settings > API**: copie a URL e a chave `anon` para `public/js/config.js`.

### 2. Backup a cada 15 minutos
```bash
npm i -g supabase
supabase login && supabase link --project-ref SEU-PROJETO
supabase secrets set BACKUP_SECRET=um-segredo-longo-e-aleatorio
supabase functions deploy backup --no-verify-jwt
```
Edite `003_agendamento.sql` (troque `TROQUE_O_SEGREDO` pelo mesmo segredo; a URL já aponta para a função `backup` do projeto — confira se é o seu) e rode no SQL Editor.
Teste: em Ajustes, a tabela de backups deve ganhar uma linha em até 15 minutos.

Cópia externa (opcional, recomendada): suba o projeto para um repositório **privado** no GitHub e cadastre o segredo `DATABASE_URL` (string de conexão do Supabase, modo Session pooler).

### 2b. Primeiros passos depois de instalar (dono da loja)
1. **Ajustes > Dados da empresa**: nome, endereço, telefone, CNPJ, logotipo e informações adicionais. É isso que sai na nota impressa.
2. **Usuários**: crie cada pessoa em Supabase > Authentication > Users e defina o perfil em Ajustes: **Administrador** (tudo), **Vendedor** (Estoque, Clientes e os painéis de vendas) ou **Cliente** (só o estoque, com o preço dele).
3. **Funcionários e comissões**: cadastre cada funcionário (comissão, meta e comissão ao bater a meta) e **ligue ao usuário (login)** dele. Sem essa ligação as vendas não entram na comissão. O dia do pagamento (padrão: 5) é configurado na aba Comissões.
4. **Insumos**: cadastre óleo, bicos, filtros etc. com o estoque mínimo. O alerta de reposição aparece no menu e no painel.

### 3. Vercel
- Pelo GitHub: importe o repositório. Framework "Other", sem build command. O `vercel.json` já aponta para `public/`.
- Ou pela linha de comando: `npm i -g vercel && vercel --prod`.

### 4. Instalar no celular
Abra o endereço da Vercel no celular > menu do navegador > "Adicionar à tela inicial".

## O que o sistema tem
Veja `docs/CHECKLIST.md` (lista de funções e onde cada uma está). Resumo: venda da loja e do atacado em painéis separados, pagamento (dinheiro, PIX, débito, crédito com parcelas, múltiplo com até 4 formas e boletos a prazo com vencimento individual), status do pagamento, desconto, base de troca, nota impressa com os dados da sua empresa, perfis Administrador/Vendedor/Cliente, insumos com alerta de reposição, entrada de mercadorias, contas a pagar e a receber, funcionários com comissão por meta e painel administrativo.

## Observações importantes
- **Plano do Supabase**: projetos gratuitos podem ser pausados por inatividade. Para uso real da loja, use o plano pago, que também libera PITR.
- **Sem internet não vende**: o app abre offline, mas vendas e pagamentos exigem conexão. É proposital: gravar offline e sincronizar depois poderia vender o mesmo pneu em dois aparelhos.
- **Custo e lucro**: funcionários não veem relatórios nem Ajustes, mas o preço de custo continua legível pelo banco para quem sabe consultar a API. Se isso for um problema, o próximo passo é separar o custo em uma tabela só de administradores.
- **Relatórios** somam no navegador: bom para milhares de vendas; com volume muito maior, mova as somas para views no banco.
- Os arquivos SQL e o código foram escritos com cuidado, mas **não foram executados contra um Supabase real** durante a criação. Rode em um projeto de teste primeiro (venda simultânea em 2 abas, pagamento parcial, cancelamento) antes de colocar dados reais.
