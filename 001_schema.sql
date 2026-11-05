-- =====================================================================
-- 001_schema.sql  |  Estoque, vendas, clientes e fiado
-- Execute no Supabase: SQL Editor > New query > Run
-- =====================================================================
create extension if not exists pgcrypto;

create type papel_usuario as enum ('admin','funcionario');
create type forma_pgto    as enum ('dinheiro','pix','cartao_debito','cartao_credito','transferencia','boleto','outro');
create type status_venda  as enum ('concluida','cancelada');
create type status_conta  as enum ('aberta','parcial','quitada','cancelada');

-- ---------- Usuários e configurações ----------
create table perfis (
  id        uuid primary key references auth.users(id) on delete cascade,
  nome      text not null,
  papel     papel_usuario not null default 'funcionario',
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table configuracoes (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now()
);
insert into configuracoes (chave, valor) values
  ('estoque_minimo_padrao',  '10'::jsonb),   -- limite de estoque baixo (por MEDIDA)
  ('dias_vencimento_padrao', '30'::jsonb);   -- prazo padrão do fiado

create or replace function is_ativo() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select ativo from perfis where id = auth.uid()), false) $$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from perfis where id = auth.uid() and ativo and papel = 'admin') $$;

-- ---------- Catálogo ----------
create table medidas (
  id             uuid primary key default gen_random_uuid(),
  descricao      text not null unique,                       -- ex.: 205/55R16
  estoque_minimo int check (estoque_minimo >= 0),            -- null = usa o padrão
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now()
);

create table marcas (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index marcas_nome_ci on marcas (lower(nome));

-- Um produto = uma medida + uma marca. A quantidade (estoque) vive aqui
-- e só muda por funções do banco, nunca por cálculo no navegador.
create table produtos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  medida_id     uuid not null references medidas(id),
  marca_id      uuid not null references marcas(id),
  categoria     text,
  quantidade    int  not null default 0 check (quantidade >= 0),
  preco_custo   numeric(12,2) not null default 0 check (preco_custo >= 0),
  preco_venda   numeric(12,2) not null default 0 check (preco_venda >= 0),
  ativo         boolean not null default true,
  versao        int not null default 1,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on produtos (medida_id);
create index on produtos (marca_id);
create unique index produtos_unico on produtos (medida_id, marca_id, lower(nome)) where ativo;

-- Livro-razão do estoque: toda entrada/saída fica registrada e é imutável.
create table movimentacoes_estoque (
  id         bigint generated always as identity primary key,
  produto_id uuid not null references produtos(id),
  tipo       text not null check (tipo in ('inicial','venda','cancelamento','ajuste')),
  quantidade int  not null,            -- positivo entra, negativo sai
  saldo_apos int  not null,
  venda_id   uuid,
  motivo     text,
  usuario_id uuid,
  criado_em  timestamptz not null default now()
);
create index on movimentacoes_estoque (produto_id, criado_em desc);

-- ---------- Clientes ----------
create table clientes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  telefone      text,
  cpf_cnpj      text,
  endereco      text,
  observacoes   text,
  tipo          text not null default 'varejo' check (tipo in ('varejo','atacado')),
  ativo         boolean not null default true,
  versao        int not null default 1,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on clientes (lower(nome));

create table precos_cliente (
  cliente_id uuid not null references clientes(id),
  produto_id uuid not null references produtos(id),
  preco      numeric(12,2) not null check (preco >= 0),
  primary key (cliente_id, produto_id)
);

-- ---------- Vendas ----------
create table vendas (
  id                  uuid primary key default gen_random_uuid(),
  numero              bigint generated always as identity unique,
  tipo                text not null check (tipo in ('balcao','atacado')),
  cliente_id          uuid references clientes(id),
  a_prazo             boolean not null default false,
  forma_pgto          forma_pgto,
  total               numeric(12,2) not null default 0 check (total >= 0),
  status              status_venda not null default 'concluida',
  observacoes         text,
  vendedor_id         uuid references perfis(id),
  chave_idempotencia  uuid not null unique,   -- impede venda duplicada em reenvio/duplo clique
  motivo_cancelamento text,
  cancelada_em        timestamptz,
  criado_em           timestamptz not null default now(),
  check (not a_prazo or cliente_id is not null)
);
create index on vendas (criado_em desc);
create index on vendas (cliente_id);

create table itens_venda (
  id             uuid primary key default gen_random_uuid(),
  venda_id       uuid not null references vendas(id),
  produto_id     uuid not null references produtos(id),
  quantidade     int  not null check (quantidade > 0),
  preco_unitario numeric(12,2) not null check (preco_unitario >= 0),
  custo_unitario numeric(12,2) not null check (custo_unitario >= 0),  -- custo no dia da venda (lucro correto)
  subtotal       numeric(12,2) generated always as (round(quantidade * preco_unitario, 2)) stored
);
create index on itens_venda (venda_id);
create index on itens_venda (produto_id);

-- ---------- Fiado ----------
create table contas_receber (
  id          uuid primary key default gen_random_uuid(),
  venda_id    uuid not null unique references vendas(id),
  cliente_id  uuid not null references clientes(id),
  valor_total numeric(12,2) not null check (valor_total >= 0),
  valor_pago  numeric(12,2) not null default 0 check (valor_pago >= 0),
  saldo       numeric(12,2) generated always as (valor_total - valor_pago) stored,
  status      status_conta not null default 'aberta',
  vencimento  date not null,
  criado_em   timestamptz not null default now(),
  check (valor_pago <= valor_total)
);
create index on contas_receber (cliente_id);
create index on contas_receber (status, vencimento);

create table pagamentos (
  id                 uuid primary key default gen_random_uuid(),
  conta_id           uuid not null references contas_receber(id),
  cliente_id         uuid not null references clientes(id),
  valor              numeric(12,2) not null check (valor > 0),
  forma              forma_pgto not null,
  observacao         text,
  chave_idempotencia uuid unique,
  registrado_por     uuid references perfis(id),
  recebido_em        timestamptz not null default now()
);
create index on pagamentos (conta_id);
create index on pagamentos (cliente_id);

-- ---------- Auditoria e backup ----------
create table log_alteracoes (
  id          bigint generated always as identity primary key,
  tabela      text not null,
  registro_id text,
  acao        text not null,
  antes       jsonb,
  depois      jsonb,
  usuario_id  uuid,
  criado_em   timestamptz not null default now()
);
create index on log_alteracoes (criado_em desc);

create table backup_log (
  id        bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  arquivo   text,
  bytes     bigint,
  ok        boolean not null,
  erro      text
);

-- =====================================================================
-- Triggers
-- =====================================================================
create or replace function trg_imutavel() returns trigger language plpgsql as
$$ begin raise exception 'registro_imutavel'; end $$;

create trigger imut_log before update or delete on log_alteracoes        for each row execute function trg_imutavel();
create trigger imut_mov before update or delete on movimentacoes_estoque for each row execute function trg_imutavel();
create trigger imut_pag before update or delete on pagamentos            for each row execute function trg_imutavel();

-- Produtos: a quantidade só muda pelas funções abaixo; edição concorrente é detectada por "versao".
create or replace function trg_produtos_antes_update() returns trigger language plpgsql as $$
begin
  if current_setting('app.sistema', true) = '1' then
    new.atualizado_em := now(); return new;
  end if;
  if new.quantidade is distinct from old.quantidade then raise exception 'use_ajustar_estoque'; end if;
  new.versao := old.versao + 1; new.atualizado_em := now(); return new;
end $$;
create trigger produtos_antes_update before update on produtos for each row execute function trg_produtos_antes_update();

create or replace function trg_versao() returns trigger language plpgsql as $$
begin new.versao := old.versao + 1; new.atualizado_em := now(); return new; end $$;
create trigger clientes_versao before update on clientes for each row execute function trg_versao();

create or replace function trg_produto_inicial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quantidade > 0 then
    insert into movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, motivo, usuario_id)
    values (new.id, 'inicial', new.quantidade, new.quantidade, 'Estoque inicial', auth.uid());
  end if;
  return new;
end $$;
create trigger produtos_inicial after insert on produtos for each row execute function trg_produto_inicial();

-- Histórico de alterações importantes
create or replace function trg_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into log_alteracoes (tabela, registro_id, acao, antes, depois, usuario_id)
  values (tg_table_name, coalesce(j->>'id', j->>'cliente_id'), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end, auth.uid());
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['medidas','marcas','clientes','precos_cliente','configuracoes','perfis','vendas','contas_receber','pagamentos'] loop
    execute format('create trigger aud_%1$s after insert or update or delete on %1$I for each row execute function trg_auditoria()', t);
  end loop;
end $$;

-- Produtos: não registra mudanças só de quantidade (isso já está no livro-razão)
create trigger aud_produtos_ins after insert or delete on produtos for each row execute function trg_auditoria();
create trigger aud_produtos_upd after update on produtos for each row
  when ((to_jsonb(old) - 'quantidade' - 'versao' - 'atualizado_em') is distinct from (to_jsonb(new) - 'quantidade' - 'versao' - 'atualizado_em'))
  execute function trg_auditoria();

-- Primeiro usuário criado vira administrador; os demais, funcionários.
create or replace function trg_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, nome, papel)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
          (case when exists (select 1 from perfis) then 'funcionario' else 'admin' end)::papel_usuario);
  return new;
end $$;
create trigger apos_criar_usuario after insert on auth.users for each row execute function trg_novo_usuario();

-- =====================================================================
-- Funções de negócio (atômicas: tudo acontece numa única transação)
-- =====================================================================
create or replace function registrar_venda(
  p_cliente uuid, p_tipo text, p_a_prazo boolean, p_forma forma_pgto,
  p_itens jsonb, p_chave uuid,
  p_obs text default null, p_entrada numeric default 0, p_vencimento date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_conta uuid; v_total numeric(12,2) := 0; v_entrada numeric(12,2) := coalesce(p_entrada, 0);
  it jsonb; v_qtd int; v_preco numeric(12,2); v_prod produtos%rowtype; v_desc text; v_dias int;
begin
  if not is_ativo() then raise exception 'sem_permissao'; end if;

  -- Reenvio da mesma venda (duplo clique, queda de rede): devolve a venda já gravada.
  select id into v_id from vendas where chave_idempotencia = p_chave;
  if found then return v_id; end if;

  if p_tipo not in ('balcao','atacado') then raise exception 'tipo_invalido'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'venda_sem_itens'; end if;
  if (p_a_prazo or p_tipo = 'atacado') and p_cliente is null then raise exception 'cliente_obrigatorio'; end if;
  if not p_a_prazo and p_forma is null then raise exception 'forma_obrigatoria'; end if;

  -- Trava as linhas dos produtos em ordem fixa: dois aparelhos vendendo ao mesmo tempo
  -- entram na fila, nunca vendem o mesmo pneu duas vezes e nunca se travam mutuamente.
  perform 1 from produtos
   where id in (select (x->>'produto_id')::uuid from jsonb_array_elements(p_itens) x)
   order by id for update;
  perform set_config('app.sistema', '1', true);

  insert into vendas (tipo, cliente_id, a_prazo, forma_pgto, observacoes, vendedor_id, chave_idempotencia)
  values (p_tipo, p_cliente, p_a_prazo, p_forma, p_obs, auth.uid(), p_chave)
  returning id into v_id;

  for it in select value from jsonb_array_elements(p_itens) loop
    v_qtd   := (it->>'quantidade')::int;
    v_preco := (it->>'preco_unitario')::numeric;
    if v_qtd is null or v_qtd <= 0 or v_preco is null or v_preco < 0 then raise exception 'item_invalido'; end if;

    update produtos set quantidade = quantidade - v_qtd
     where id = (it->>'produto_id')::uuid and ativo and quantidade >= v_qtd
     returning * into v_prod;
    if not found then
      select m.descricao || ' ' || mc.nome into v_desc
        from produtos p join medidas m on m.id = p.medida_id join marcas mc on mc.id = p.marca_id
       where p.id = (it->>'produto_id')::uuid;
      raise exception 'estoque_insuficiente: %', coalesce(v_desc, 'produto não encontrado');
    end if;

    insert into itens_venda (venda_id, produto_id, quantidade, preco_unitario, custo_unitario)
    values (v_id, v_prod.id, v_qtd, v_preco, v_prod.preco_custo);
    insert into movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, venda_id, usuario_id)
    values (v_prod.id, 'venda', -v_qtd, v_prod.quantidade, v_id, auth.uid());
    v_total := v_total + round(v_qtd * v_preco, 2);
  end loop;

  update vendas set total = v_total where id = v_id;

  if p_a_prazo then
    if v_entrada < 0 or v_entrada > v_total then raise exception 'valor_maior_que_saldo'; end if;
    select (valor #>> '{}')::int into v_dias from configuracoes where chave = 'dias_vencimento_padrao';
    insert into contas_receber (venda_id, cliente_id, valor_total, vencimento)
    values (v_id, p_cliente, v_total, coalesce(p_vencimento, current_date + coalesce(v_dias, 30)))
    returning id into v_conta;
    if v_entrada > 0 then
      insert into pagamentos (conta_id, cliente_id, valor, forma, observacao, registrado_por)
      values (v_conta, p_cliente, v_entrada, coalesce(p_forma, 'dinheiro'), 'Entrada', auth.uid());
      update contas_receber set valor_pago = v_entrada,
             status = (case when v_entrada >= v_total then 'quitada' else 'parcial' end)::status_conta
       where id = v_conta;
    end if;
  end if;
  return v_id;
end $$;

create or replace function registrar_pagamento(
  p_conta uuid, p_valor numeric, p_forma forma_pgto, p_chave uuid, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_c contas_receber%rowtype; v_id uuid;
begin
  if not is_ativo() then raise exception 'sem_permissao'; end if;
  select id into v_id from pagamentos where chave_idempotencia = p_chave;
  if found then return v_id; end if;

  select * into v_c from contas_receber where id = p_conta for update;   -- dois aparelhos recebendo da mesma conta: um espera o outro
  if not found then raise exception 'conta_inexistente'; end if;
  if v_c.status in ('quitada','cancelada') then raise exception 'conta_encerrada'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'valor_invalido'; end if;
  if p_valor > v_c.valor_total - v_c.valor_pago then raise exception 'valor_maior_que_saldo'; end if;

  insert into pagamentos (conta_id, cliente_id, valor, forma, observacao, chave_idempotencia, registrado_por)
  values (p_conta, v_c.cliente_id, p_valor, p_forma, p_obs, p_chave, auth.uid())
  returning id into v_id;

  update contas_receber
     set valor_pago = valor_pago + p_valor,
         status = (case when valor_pago + p_valor >= valor_total then 'quitada' else 'parcial' end)::status_conta
   where id = p_conta;
  return v_id;
end $$;

create or replace function cancelar_venda(p_venda uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v vendas%rowtype; r record; v_saldo int;
begin
  if not is_admin() then raise exception 'sem_permissao'; end if;
  select * into v from vendas where id = p_venda for update;
  if not found then raise exception 'venda_inexistente'; end if;
  if v.status = 'cancelada' then raise exception 'venda_ja_cancelada'; end if;
  if exists (select 1 from pagamentos p join contas_receber c on c.id = p.conta_id where c.venda_id = p_venda) then
    raise exception 'venda_com_pagamentos';
  end if;
  perform 1 from produtos where id in (select produto_id from itens_venda where venda_id = p_venda) order by id for update;
  perform set_config('app.sistema', '1', true);
  for r in select produto_id, sum(quantidade)::int as q from itens_venda where venda_id = p_venda group by produto_id loop
    update produtos set quantidade = quantidade + r.q where id = r.produto_id returning quantidade into v_saldo;
    insert into movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, venda_id, motivo, usuario_id)
    values (r.produto_id, 'cancelamento', r.q, v_saldo, p_venda, p_motivo, auth.uid());
  end loop;
  update vendas set status = 'cancelada', motivo_cancelamento = p_motivo, cancelada_em = now() where id = p_venda;
  update contas_receber set status = 'cancelada' where venda_id = p_venda;
end $$;

create or replace function ajustar_estoque(p_produto uuid, p_delta int, p_motivo text default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_q int;
begin
  if not is_admin() then raise exception 'sem_permissao'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'ajuste_invalido'; end if;
  select quantidade into v_q from produtos where id = p_produto for update;
  if not found then raise exception 'produto_inexistente'; end if;
  if v_q + p_delta < 0 then raise exception 'estoque_insuficiente: o ajuste deixaria o estoque negativo'; end if;
  perform set_config('app.sistema', '1', true);
  update produtos set quantidade = v_q + p_delta where id = p_produto;
  insert into movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, motivo, usuario_id)
  values (p_produto, 'ajuste', p_delta, v_q + p_delta, p_motivo, auth.uid());
  return v_q + p_delta;
end $$;

-- =====================================================================
-- Views (security_invoker: respeitam as permissões de quem consulta)
-- =====================================================================
create view v_estoque_produtos with (security_invoker = true) as
select p.id, p.nome as produto, p.quantidade, p.preco_custo, p.preco_venda, p.categoria,
       m.id as medida_id, m.descricao as medida, mc.id as marca_id, mc.nome as marca
  from produtos p join medidas m on m.id = p.medida_id join marcas mc on mc.id = p.marca_id
 where p.ativo;

-- Regra central: o alerta considera a SOMA de todas as marcas da mesma medida.
create view v_estoque_medida with (security_invoker = true) as
with base as (
  select m.id as medida_id, m.descricao as medida,
         coalesce(sum(p.quantidade) filter (where p.ativo), 0)::int as total,
         (count(p.id) filter (where p.ativo))::int as produtos,
         coalesce(m.estoque_minimo,
                  (select (valor #>> '{}')::int from configuracoes where chave = 'estoque_minimo_padrao')) as minimo
    from medidas m left join produtos p on p.medida_id = m.id
   where m.ativo
   group by m.id
  having count(p.id) filter (where p.ativo) > 0
)
select *, (total <= minimo) as baixo from base;

create view v_contas with (security_invoker = true) as
select c.id, c.venda_id, v.numero as venda_numero, c.cliente_id, cl.nome as cliente_nome, cl.telefone,
       c.valor_total, c.valor_pago, c.saldo, c.status, c.vencimento, c.criado_em,
       (c.status in ('aberta','parcial') and c.vencimento < (now() at time zone 'America/Sao_Paulo')::date) as vencida
  from contas_receber c join vendas v on v.id = c.venda_id join clientes cl on cl.id = c.cliente_id;

create view v_saldo_clientes with (security_invoker = true) as
select cliente_id, sum(saldo) as saldo, min(vencimento) as vencimento_mais_antigo
  from contas_receber where status in ('aberta','parcial') group by cliente_id;

create view v_vendas_detalhe with (security_invoker = true) as
select i.id as item_id, v.id as venda_id, v.numero, v.criado_em, v.status, v.a_prazo, v.cliente_id,
       coalesce(c.nome, 'Balcão') as cliente, m.descricao as medida, mc.nome as marca, p.nome as produto,
       i.quantidade, i.preco_unitario, i.custo_unitario, i.subtotal,
       round(i.quantidade * (i.preco_unitario - i.custo_unitario), 2) as lucro
  from itens_venda i
  join vendas v on v.id = i.venda_id
  left join clientes c on c.id = v.cliente_id
  join produtos p on p.id = i.produto_id
  join medidas m on m.id = p.medida_id
  join marcas mc on mc.id = p.marca_id;

create view v_pagamentos_detalhe with (security_invoker = true) as
select p.id, p.conta_id, p.cliente_id, cl.nome as cliente, v.numero as venda_numero,
       p.valor, p.forma, p.observacao, p.recebido_em
  from pagamentos p join clientes cl on cl.id = p.cliente_id
  join contas_receber c on c.id = p.conta_id join vendas v on v.id = c.venda_id;

create or replace function dashboard() returns jsonb
language sql stable security invoker set search_path = public as $$
with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d)
select jsonb_build_object(
  'unidades',       (select coalesce(sum(quantidade), 0) from produtos where ativo),
  'valor_estoque',  (select coalesce(sum(quantidade * preco_custo), 0) from produtos where ativo),
  'vendas_dia',     (select coalesce(sum(total), 0) from vendas, hoje
                      where status = 'concluida' and (criado_em at time zone 'America/Sao_Paulo')::date = hoje.d),
  'qtd_vendas_dia', (select count(*) from vendas, hoje
                      where status = 'concluida' and (criado_em at time zone 'America/Sao_Paulo')::date = hoje.d),
  'vendas_mes',     (select coalesce(sum(total), 0) from vendas, hoje
                      where status = 'concluida'
                        and date_trunc('month', criado_em at time zone 'America/Sao_Paulo') = date_trunc('month', hoje.d::timestamp)),
  'a_receber',      (select coalesce(sum(saldo), 0) from contas_receber where status in ('aberta','parcial')),
  'inadimplentes',  (select count(distinct cliente_id) from v_contas where vencida),
  'mais_vendidos',  (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                       select m.descricao as medida, mc.nome as marca, sum(i.quantidade)::int as qtd
                         from itens_venda i join vendas v on v.id = i.venda_id
                         join produtos p on p.id = i.produto_id join medidas m on m.id = p.medida_id join marcas mc on mc.id = p.marca_id
                        where v.status = 'concluida' and v.criado_em > now() - interval '30 days'
                        group by 1, 2 order by qtd desc limit 5) x),
  'estoque_baixo',  (select coalesce(jsonb_agg(to_jsonb(b) order by b.total), '[]'::jsonb) from v_estoque_medida b where b.baixo)
);
$$;

-- =====================================================================
-- Segurança (RLS) e tempo real
-- =====================================================================
do $$ declare t text; begin
  foreach t in array array['medidas','marcas','produtos','clientes','precos_cliente','vendas','itens_venda',
                           'contas_receber','pagamentos','movimentacoes_estoque','configuracoes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (is_ativo())', 'ler_' || t, t);
  end loop;
  -- Somente administrador escreve diretamente nestas tabelas
  foreach t in array array['medidas','marcas','produtos','precos_cliente','configuracoes'] loop
    execute format('create policy %I on %I for all to authenticated using (is_admin()) with check (is_admin())', 'admin_' || t, t);
  end loop;
end $$;
-- vendas, itens, contas, pagamentos e movimentações: SEM política de escrita => só pelas funções acima.

create policy clientes_inserir on clientes for insert to authenticated with check (is_ativo());
create policy clientes_alterar on clientes for update to authenticated using (is_ativo()) with check (is_ativo());

alter table perfis enable row level security;
create policy perfis_ler     on perfis for select to authenticated using (id = auth.uid() or is_admin());
create policy perfis_alterar on perfis for update to authenticated using (is_admin()) with check (is_admin());

alter table log_alteracoes enable row level security;
create policy log_ler on log_alteracoes for select to authenticated using (is_admin());
alter table backup_log enable row level security;
create policy backup_ler on backup_log for select to authenticated using (is_admin());

revoke all on all tables in schema public from anon;

-- Todos os aparelhos recebem mudanças em tempo real
alter publication supabase_realtime add table produtos, clientes, vendas, contas_receber, pagamentos, medidas, marcas, precos_cliente, configuracoes;
