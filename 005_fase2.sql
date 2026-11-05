-- =====================================================================
-- 005_fase2.sql  |  FASE 2
-- Insumos e serviços, entrada de mercadorias, contas a pagar,
-- funcionários e comissões, dashboard administrativo e avisos.
-- Rode UMA vez no SQL Editor do Supabase (depois do 001, 002, 003 e 004).
-- =====================================================================

-- ---------- 0) Pequenos ajustes em tabelas existentes ----------
-- O livro-razão de pneus passa a aceitar "entrada" (compra de mercadoria).
alter table movimentacoes_estoque drop constraint if exists movimentacoes_estoque_tipo_check;
alter table movimentacoes_estoque add constraint movimentacoes_estoque_tipo_check
  check (tipo in ('inicial','venda','cancelamento','ajuste','entrada'));

-- Boleto de venda cancelada deixa de aparecer como "a receber".
alter table venda_boletos drop constraint if exists venda_boletos_status_check;
alter table venda_boletos add constraint venda_boletos_status_check check (status in ('pendente','pago','cancelado'));

insert into configuracoes (chave, valor) values ('comissao_dia_pagamento', '5'::jsonb) on conflict (chave) do nothing;

-- ---------- 1) Insumos e serviços (óleo, bicos, filtros...) ----------
-- Ficam FORA do estoque de pneus: não entram no custo nem no alerta de pneus.
create table itens_complementares (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  categoria      text not null,
  unidade        text not null default 'un',
  quantidade     numeric(12,2) not null default 0 check (quantidade >= 0),
  estoque_minimo numeric(12,2) not null default 0 check (estoque_minimo >= 0),
  custo_unitario numeric(12,2) not null default 0 check (custo_unitario >= 0),
  ativo          boolean not null default true,
  versao         int not null default 1,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index on itens_complementares (categoria, nome);

create table movimentacoes_itens (
  id         bigint generated always as identity primary key,
  item_id    uuid not null references itens_complementares(id),
  tipo       text not null check (tipo in ('inicial','entrada','ajuste')),
  quantidade numeric(12,2) not null,
  saldo_apos numeric(12,2) not null,
  motivo     text,
  usuario_id uuid,
  criado_em  timestamptz not null default now()
);
create index on movimentacoes_itens (item_id, criado_em desc);
create trigger imut_mov_itens before update or delete on movimentacoes_itens for each row execute function trg_imutavel();

-- A quantidade só muda pelas funções (ajustar_item / registrar_entrada); edição concorrente é detectada por "versao".
create or replace function trg_itens_antes_update() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.sistema', true), '') <> '1' and new.quantidade is distinct from old.quantidade then
    raise exception 'use_ajustar_item';
  end if;
  new.versao := old.versao + 1; new.atualizado_em := now(); return new;
end $$;
create trigger itens_antes_update before update on itens_complementares for each row execute function trg_itens_antes_update();

create or replace function trg_item_inicial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quantidade > 0 then
    insert into movimentacoes_itens (item_id, tipo, quantidade, saldo_apos, motivo, usuario_id)
    values (new.id, 'inicial', new.quantidade, new.quantidade, 'Estoque inicial', auth.uid());
  end if;
  return new;
end $$;
create trigger itens_inicial after insert on itens_complementares for each row execute function trg_item_inicial();

-- ---------- 2) Entrada de mercadorias e contas a pagar ----------
create table entradas_mercadoria (
  id                 uuid primary key default gen_random_uuid(),
  numero             bigint generated always as identity unique,
  data               date not null,
  fornecedor         text,
  documento          text,
  total              numeric(12,2) not null default 0 check (total >= 0),
  a_prazo            boolean not null default false,
  forma              forma_pgto,
  chave_idempotencia uuid not null unique,
  usuario_id         uuid,
  criado_em          timestamptz not null default now()
);
create index on entradas_mercadoria (criado_em desc);

create table entradas_itens (
  id             uuid primary key default gen_random_uuid(),
  entrada_id     uuid not null references entradas_mercadoria(id),
  produto_id     uuid references produtos(id),
  item_id        uuid references itens_complementares(id),
  quantidade     numeric(12,2) not null check (quantidade > 0),
  custo_unitario numeric(12,2) not null check (custo_unitario >= 0),
  check ((produto_id is null) <> (item_id is null))
);
create index on entradas_itens (entrada_id);

create table contas_pagar (
  id         uuid primary key default gen_random_uuid(),
  descricao  text not null,
  fornecedor text,
  categoria  text,
  valor      numeric(12,2) not null check (valor > 0),
  vencimento date not null,
  status     text not null default 'pendente' check (status in ('pendente','pago')),
  pago_em    timestamptz,
  forma      forma_pgto,
  entrada_id uuid references entradas_mercadoria(id),
  criado_em  timestamptz not null default now()
);
create index on contas_pagar (status, vencimento);

-- ---------- 3) Funcionários e comissões ----------
create table funcionarios (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  cargo             text,
  comissao_pct      numeric(5,2) not null default 0 check (comissao_pct between 0 and 100),
  meta_valor        numeric(12,2) not null default 0 check (meta_valor >= 0),
  comissao_meta_pct numeric(5,2) not null default 0 check (comissao_meta_pct between 0 and 100),
  perfil_id         uuid unique references perfis(id),   -- usuário (login) cujas vendas contam para a comissão
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now()
);

-- Comissão paga fica congelada: mudar % ou meta depois não altera o histórico.
create table comissoes_pagas (
  funcionario_id uuid not null references funcionarios(id),
  competencia    date not null,                 -- sempre o dia 1 do mês das vendas
  total_vendido  numeric(12,2) not null,
  meta           numeric(12,2) not null default 0,
  atingiu        boolean not null default false,
  pct            numeric(5,2) not null,
  valor          numeric(12,2) not null check (valor >= 0),
  pago_em        timestamptz not null default now(),
  pago_por       uuid,
  observacao     text,
  primary key (funcionario_id, competencia)
);
create trigger imut_com_pagas before update or delete on comissoes_pagas for each row execute function trg_imutavel();

-- ---------- 4) Segurança (RLS), auditoria e tempo real ----------
do $$ declare t text; begin
  foreach t in array array['itens_complementares','movimentacoes_itens','entradas_mercadoria','entradas_itens','contas_pagar','funcionarios','comissoes_pagas'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (is_admin())', 'ler_' || t, t);
  end loop;
  -- escrita direta só do administrador, e só nestas três (o resto entra por funções)
  foreach t in array array['itens_complementares','funcionarios'] loop
    execute format('create policy %I on %I for insert to authenticated with check (is_admin())', 'ins_' || t, t);
    execute format('create policy %I on %I for update to authenticated using (is_admin()) with check (is_admin())', 'upd_' || t, t);
  end loop;
end $$;
create policy ins_contas_pagar on contas_pagar for insert to authenticated with check (is_admin());
create policy upd_contas_pagar on contas_pagar for update to authenticated using (is_admin()) with check (is_admin());
create policy del_contas_pagar on contas_pagar for delete to authenticated using (is_admin() and status = 'pendente');

create trigger aud_funcionarios       after insert or update or delete on funcionarios  for each row execute function trg_auditoria();
create trigger aud_contas_pagar       after insert or update or delete on contas_pagar  for each row execute function trg_auditoria();
create trigger aud_comissoes_pagas    after insert on comissoes_pagas                   for each row execute function trg_auditoria();
create trigger aud_itens_ins          after insert or delete on itens_complementares    for each row execute function trg_auditoria();
create trigger aud_itens_upd          after update on itens_complementares for each row
  when ((to_jsonb(old) - 'quantidade' - 'versao' - 'atualizado_em') is distinct from (to_jsonb(new) - 'quantidade' - 'versao' - 'atualizado_em'))
  execute function trg_auditoria();

alter publication supabase_realtime add table itens_complementares, contas_pagar, funcionarios, entradas_mercadoria, comissoes_pagas;

-- ---------- 5) Funções ----------

-- Entrada/saída/ajuste de um insumo (administrador).
create or replace function ajustar_item(p_item uuid, p_delta numeric, p_motivo text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_q numeric;
begin
  if not is_admin() then raise exception 'sem_permissao'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'ajuste_invalido'; end if;
  select quantidade into v_q from itens_complementares where id = p_item and ativo for update;
  if not found then raise exception 'item_inexistente'; end if;
  if v_q + p_delta < 0 then raise exception 'estoque_insuficiente: o ajuste deixaria o insumo negativo'; end if;
  perform set_config('app.sistema', '1', true);
  update itens_complementares set quantidade = v_q + p_delta where id = p_item;
  insert into movimentacoes_itens (item_id, tipo, quantidade, saldo_apos, motivo, usuario_id)
  values (p_item, 'ajuste', p_delta, v_q + p_delta, p_motivo, auth.uid());
  return v_q + p_delta;
end $$;

-- Entrada de mercadorias (pneus e insumos) numa única transação.
-- p = { chave, data, fornecedor, documento, atualizar_custo,
--       itens:[{tipo:'pneu'|'item', id, quantidade, custo_unitario}],
--       forma (à vista)  OU  parcelas:[{vencimento, valor}] (a prazo -> gera contas a pagar) }
create or replace function registrar_entrada(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_chave uuid := (p->>'chave')::uuid;
  v_data  date := coalesce(nullif(p->>'data', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
  v_forn  text := nullif(trim(coalesce(p->>'fornecedor', '')), '');
  v_doc   text := nullif(trim(coalesce(p->>'documento', '')), '');
  v_upd   boolean := coalesce((p->>'atualizar_custo')::boolean, false);
  v_itens jsonb := coalesce(p->'itens', '[]'::jsonb);
  v_parc  jsonb := coalesce(p->'parcelas', '[]'::jsonb);
  v_forma forma_pgto := nullif(p->>'forma', '')::forma_pgto;
  v_id uuid; v_num bigint; v_total numeric(12,2) := 0; v_somap numeric(12,2) := 0;
  it jsonb; pc jsonb; v_q numeric; v_c numeric; v_qi int; v_n int := 0; v_np int;
  v_pr produtos%rowtype; v_it itens_complementares%rowtype;
begin
  if not is_admin() then raise exception 'sem_permissao'; end if;
  if v_chave is null then raise exception 'item_invalido'; end if;

  select id into v_id from entradas_mercadoria where chave_idempotencia = v_chave;   -- reenvio: devolve a já gravada
  if found then return v_id; end if;

  if jsonb_typeof(v_itens) <> 'array' or jsonb_typeof(v_parc) <> 'array' then raise exception 'item_invalido'; end if;
  if jsonb_array_length(v_itens) = 0 then raise exception 'entrada_sem_itens'; end if;
  if jsonb_array_length(v_parc) = 0 and v_forma is null then raise exception 'forma_obrigatoria'; end if;
  if jsonb_array_length(v_parc) > 12 then raise exception 'item_invalido'; end if;

  -- trava as linhas em ordem fixa (nunca duas entradas/vendas mexendo no mesmo item ao mesmo tempo)
  perform 1 from produtos
   where id in (select (x->>'id')::uuid from jsonb_array_elements(v_itens) x where x->>'tipo' = 'pneu') order by id for update;
  perform 1 from itens_complementares
   where id in (select (x->>'id')::uuid from jsonb_array_elements(v_itens) x where x->>'tipo' = 'item') order by id for update;
  perform set_config('app.sistema', '1', true);

  insert into entradas_mercadoria (data, fornecedor, documento, chave_idempotencia, usuario_id)
  values (v_data, v_forn, v_doc, v_chave, auth.uid())
  returning id, numero into v_id, v_num;

  for it in select value from jsonb_array_elements(v_itens) loop
    v_q := (it->>'quantidade')::numeric;
    v_c := (it->>'custo_unitario')::numeric;
    if v_q is null or v_q <= 0 or v_c is null or v_c < 0 then raise exception 'item_invalido'; end if;

    if it->>'tipo' = 'pneu' then
      if v_q <> trunc(v_q) then raise exception 'item_invalido'; end if;
      v_qi := v_q::int;
      update produtos
         set quantidade  = quantidade + v_qi,
             preco_custo = case when v_upd then v_c else preco_custo end,
             versao      = versao + 1
       where id = (it->>'id')::uuid and ativo
       returning * into v_pr;
      if not found then raise exception 'produto_inexistente'; end if;
      insert into entradas_itens (entrada_id, produto_id, quantidade, custo_unitario) values (v_id, v_pr.id, v_qi, v_c);
      insert into movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, motivo, usuario_id)
      values (v_pr.id, 'entrada', v_qi, v_pr.quantidade, 'Entrada #' || v_num::text, auth.uid());
    elsif it->>'tipo' = 'item' then
      update itens_complementares
         set quantidade     = quantidade + v_q,
             custo_unitario = case when v_upd then v_c else custo_unitario end
       where id = (it->>'id')::uuid and ativo
       returning * into v_it;
      if not found then raise exception 'item_inexistente'; end if;
      insert into entradas_itens (entrada_id, item_id, quantidade, custo_unitario) values (v_id, v_it.id, v_q, v_c);
      insert into movimentacoes_itens (item_id, tipo, quantidade, saldo_apos, motivo, usuario_id)
      values (v_it.id, 'entrada', v_q, v_it.quantidade, 'Entrada #' || v_num::text, auth.uid());
    else
      raise exception 'item_invalido';
    end if;
    v_total := v_total + round(v_q * v_c, 2);
  end loop;

  -- a prazo: cada parcela vira uma conta a pagar com o próprio vencimento
  v_np := jsonb_array_length(v_parc);
  if v_np > 0 then
    for pc in select value from jsonb_array_elements(v_parc) loop
      if jnum(pc, 'valor') <= 0 or nullif(pc->>'vencimento', '') is null then raise exception 'item_invalido'; end if;
      v_somap := v_somap + jnum(pc, 'valor');
    end loop;
    if abs(v_somap - v_total) > 0.01 then raise exception 'pagamento_inconsistente'; end if;
    for pc in select value from jsonb_array_elements(v_parc) loop
      v_n := v_n + 1;
      insert into contas_pagar (descricao, fornecedor, categoria, valor, vencimento, entrada_id)
      values ('Entrada #' || v_num::text || coalesce(' — ' || v_forn, '') || case when v_np > 1 then ' (' || v_n::text || '/' || v_np::text || ')' else '' end,
              v_forn, 'Mercadoria', jnum(pc, 'valor'), (pc->>'vencimento')::date, v_id);
    end loop;
  end if;

  update entradas_mercadoria set total = v_total, a_prazo = v_np > 0, forma = case when v_np > 0 then null else v_forma end where id = v_id;
  return v_id;
end $$;

-- Comissão de cada funcionário em um mês (competência = dia 1 do mês das vendas).
-- Regra: soma das vendas concluídas do usuário ligado ao funcionário; se bateu a meta,
-- vale o % da meta para todas as vendas do mês. Mês já pago devolve os valores congelados.
create or replace function comissoes(p_competencia date)
returns table (funcionario_id uuid, nome text, vendas_qtd int, total_vendido numeric, meta numeric, atingiu boolean,
               pct numeric, valor numeric, pago boolean, pago_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_ini date := date_trunc('month', p_competencia)::date;
  v_fim date := (date_trunc('month', p_competencia) + interval '1 month')::date;
begin
  if not is_admin() then raise exception 'sem_permissao'; end if;
  return query
  with ven as (
    select f.id as fid, count(v.id)::int as qtd, coalesce(sum(v.total), 0) as tot
      from funcionarios f
      left join vendas v on v.vendedor_id = f.perfil_id and v.status = 'concluida'
                        and (v.criado_em at time zone 'America/Sao_Paulo')::date >= v_ini
                        and (v.criado_em at time zone 'America/Sao_Paulo')::date <  v_fim
     where f.ativo or exists (select 1 from comissoes_pagas cp where cp.funcionario_id = f.id and cp.competencia = v_ini)
     group by f.id
  ), calc as (
    select f.id as fid, f.nome as fnome, ven.qtd, ven.tot, f.meta_valor as fmeta,
           (f.meta_valor > 0 and ven.tot >= f.meta_valor) as bateu,
           case when f.meta_valor > 0 and ven.tot >= f.meta_valor and f.comissao_meta_pct > 0 then f.comissao_meta_pct else f.comissao_pct end as fpct
      from funcionarios f join ven on ven.fid = f.id
  )
  select c.fid, c.fnome, c.qtd,
         coalesce(cp.total_vendido, c.tot)::numeric,
         coalesce(cp.meta, c.fmeta)::numeric,
         coalesce(cp.atingiu, c.bateu),
         coalesce(cp.pct, c.fpct)::numeric,
         coalesce(cp.valor, round(c.tot * c.fpct / 100, 2))::numeric,
         (cp.funcionario_id is not null),
         cp.pago_em
    from calc c
    left join comissoes_pagas cp on cp.funcionario_id = c.fid and cp.competencia = v_ini
   order by c.fnome;
end $$;

-- Marca a comissão de um mês já encerrado como paga (congela os valores).
create or replace function pagar_comissao(p_funcionario uuid, p_competencia date, p_obs text default null) returns void
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  if not is_admin() then raise exception 'sem_permissao'; end if;
  if v_comp >= date_trunc('month', v_hoje)::date then raise exception 'periodo_aberto'; end if;
  perform 1 from funcionarios where id = p_funcionario for update;       -- serializa pagamentos do mesmo funcionário
  if not found then raise exception 'funcionario_inexistente'; end if;

  select * into r from comissoes(v_comp) c where c.funcionario_id = p_funcionario;
  if not found then raise exception 'funcionario_inexistente'; end if;
  if r.pago then raise exception 'comissao_paga'; end if;
  if r.valor <= 0 then raise exception 'comissao_zerada'; end if;

  insert into comissoes_pagas (funcionario_id, competencia, total_vendido, meta, atingiu, pct, valor, pago_por, observacao)
  values (p_funcionario, v_comp, r.total_vendido, r.meta, r.atingiu, r.pct, r.valor, auth.uid(), p_obs);
end $$;

-- Números dos avisos no menu.
create or replace function alertas_resumo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_ant date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) - interval '1 month')::date;
begin
  if not is_admin() then raise exception 'sem_permissao'; end if;
  return jsonb_build_object(
    'itens_baixos',    (select count(*) from itens_complementares where ativo and estoque_minimo > 0 and quantidade <= estoque_minimo),
    'contas_vencidas', (select count(*) from contas_pagar where status = 'pendente' and vencimento < v_hoje),
    'comissoes',       (select count(*) from comissoes(v_ant) c where not c.pago and c.valor > 0),
    'pneus_baixos',    (select count(*) from v_estoque_medida where baixo)
  );
end $$;

-- Dashboard administrativo (um período).
create or replace function dashboard_adm(p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r jsonb;
begin
  if not is_admin() then raise exception 'sem_permissao'; end if;
  with v as (
    select * from vendas
     where status = 'concluida'
       and (criado_em at time zone 'America/Sao_Paulo')::date between p_ini and p_fim
  )
  select jsonb_build_object(
    'total_vendido',      coalesce((select sum(total) from v), 0),
    'qtd_vendas',         (select count(*) from v),
    'faturamento_loja',   coalesce((select sum(total) from v where tipo = 'balcao'), 0),
    'qtd_loja',           (select count(*) from v where tipo = 'balcao'),
    'faturamento_atacado', coalesce((select sum(total) from v where tipo = 'atacado'), 0),
    'qtd_atacado',        (select count(*) from v where tipo = 'atacado'),
    'custo_pneus_vendidos', coalesce((select sum(i.quantidade * i.custo_unitario) from itens_venda i join v on v.id = i.venda_id), 0),
    'entradas_valor',     coalesce((select sum(total) from entradas_mercadoria where data between p_ini and p_fim), 0),
    'entradas_qtd',       (select count(*) from entradas_mercadoria where data between p_ini and p_fim),
    'pagar_pendente',     coalesce((select sum(valor) from contas_pagar where status = 'pendente'), 0),
    'pagar_vencido',      coalesce((select sum(valor) from contas_pagar where status = 'pendente' and vencimento < v_hoje), 0),
    'pagar_vencidas_qtd', (select count(*) from contas_pagar where status = 'pendente' and vencimento < v_hoje),
    'devedores_total',    coalesce((select sum(saldo) from contas_receber where status in ('aberta','parcial')), 0),
    'devedores_qtd',      (select count(distinct cliente_id) from contas_receber where status in ('aberta','parcial')),
    'unidades_pneus',     coalesce((select sum(quantidade) from produtos where ativo), 0),
    'valor_estoque_pneus', coalesce((select sum(quantidade * preco_custo) from produtos where ativo), 0),
    'valor_estoque_itens', coalesce((select sum(quantidade * custo_unitario) from itens_complementares where ativo), 0),
    'dia_pagamento_comissao', coalesce((select (valor #>> '{}')::int from configuracoes where chave = 'comissao_dia_pagamento'), 5),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('dia', to_char(d, 'YYYY-MM-DD'), 'total', t) order by d), '[]'::jsonb)
                from (select (criado_em at time zone 'America/Sao_Paulo')::date as d, sum(total) as t from v group by 1) s),
    'por_vendedor', (select coalesce(jsonb_agg(jsonb_build_object('nome', n, 'qtd', q, 'total', t) order by t desc), '[]'::jsonb)
                from (select coalesce(vendedor_nome, '—') as n, count(*) as q, sum(total) as t from v group by 1) s),
    'mais_vendidos', (select coalesce(jsonb_agg(jsonb_build_object('medida', m, 'marca', mc, 'qtd', q) order by q desc), '[]'::jsonb)
                from (select md.descricao as m, mk.nome as mc, sum(i.quantidade)::int as q
                        from itens_venda i join v on v.id = i.venda_id
                        join produtos p on p.id = i.produto_id join medidas md on md.id = p.medida_id join marcas mk on mk.id = p.marca_id
                       group by 1, 2 order by q desc limit 10) s),
    'proximas_pagar', (select coalesce(jsonb_agg(jsonb_build_object('vencimento', vencimento, 'descricao', descricao, 'valor', valor) order by vencimento), '[]'::jsonb)
                from (select vencimento, descricao, valor from contas_pagar where status = 'pendente' order by vencimento limit 8) s),
    'top_devedores', (select coalesce(jsonb_agg(jsonb_build_object('nome', x.n, 'saldo', x.tot, 'vencida', x.venc) order by x.tot desc), '[]'::jsonb)
                from (select cl.nome as n, sum(c.saldo) as tot, bool_or(c.vencimento < v_hoje) as venc
                        from contas_receber c join clientes cl on cl.id = c.cliente_id
                       where c.status in ('aberta','parcial') group by cl.id, cl.nome order by 2 desc limit 8) x),
    'itens_baixos', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'categoria', categoria, 'quantidade', quantidade, 'unidade', unidade, 'estoque_minimo', estoque_minimo) order by nome), '[]'::jsonb)
                from itens_complementares where ativo and estoque_minimo > 0 and quantidade <= estoque_minimo),
    'estoque_baixo', (select coalesce(jsonb_agg(jsonb_build_object('medida', medida, 'total', total, 'minimo', minimo) order by total), '[]'::jsonb)
                from v_estoque_medida where baixo)
  ) into r;
  return r;
end $$;

-- Cancelar venda: agora também cancela os boletos pendentes (não aparecem mais em "a receber").
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
  update venda_boletos set status = 'cancelado' where venda_id = p_venda and status = 'pendente';
end $$;

-- Backup completo: agora inclui as tabelas da fase 1 e da fase 2.
create or replace function exportar_backup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := jsonb_build_object('gerado_em', now(), 'versao_schema', 2); t text; v jsonb;
begin
  if not (is_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then raise exception 'sem_permissao'; end if;
  foreach t in array array['perfis','configuracoes','medidas','marcas','produtos','movimentacoes_estoque','clientes',
                           'precos_cliente','vendas','itens_venda','contas_receber','pagamentos','log_alteracoes',
                           'venda_pagamentos','venda_boletos','trocas',
                           'itens_complementares','movimentacoes_itens','entradas_mercadoria','entradas_itens',
                           'contas_pagar','funcionarios','comissoes_pagas'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v;
    r := r || jsonb_build_object(t, v);
  end loop;
  return r;
end $$;

revoke execute on function ajustar_item(uuid, numeric, text), registrar_entrada(jsonb), comissoes(date), pagar_comissao(uuid, date, text),
                           alertas_resumo(), dashboard_adm(date, date) from public, anon;
grant  execute on function ajustar_item(uuid, numeric, text), registrar_entrada(jsonb), comissoes(date), pagar_comissao(uuid, date, text),
                           alertas_resumo(), dashboard_adm(date, date) to authenticated;
