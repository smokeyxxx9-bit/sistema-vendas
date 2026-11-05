-- =====================================================================
-- 004_loja.sql  |  FASE 1
-- Perfis (admin / vendedor / cliente), venda completa da loja e do atacado,
-- pagamento múltiplo, boletos a prazo, base de troca e dados da empresa.
-- Rode UMA vez no SQL Editor do Supabase (depois do 001, 002 e 003).
-- =====================================================================

-- ---------- 1) Perfis: papel vira texto (admin | vendedor | cliente) ----------
alter table perfis alter column papel drop default;
alter table perfis alter column papel type text using papel::text;
update perfis set papel = 'vendedor' where papel = 'funcionario';
alter table perfis alter column papel set default 'vendedor';
alter table perfis add constraint perfis_papel_check check (papel in ('admin','vendedor','cliente'));
alter table perfis add column if not exists cliente_id uuid references clientes(id);  -- cliente de login: usa os preços dele

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from perfis where id = auth.uid() and ativo and papel = 'admin') $$;

-- is_ativo() passa a significar "equipe" (admin ou vendedor). O perfil "cliente" NÃO lê nenhuma tabela:
-- só enxerga o estoque pela função estoque_cliente(), que nunca devolve custo.
create or replace function is_ativo() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select ativo and papel in ('admin','vendedor') from perfis where id = auth.uid()), false) $$;

create or replace function trg_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, nome, papel)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
          case when exists (select 1 from perfis) then 'vendedor' else 'admin' end);
  return new;
end $$;

-- Financeiro (recebimentos) só para administrador
drop policy if exists ler_contas_receber on contas_receber;
create policy ler_contas_receber on contas_receber for select to authenticated using (is_admin());
drop policy if exists ler_pagamentos on pagamentos;
create policy ler_pagamentos on pagamentos for select to authenticated using (is_admin());

-- Estoque para o perfil Cliente: quantidade, medida, marca, modelo e o preço que ELE paga
create or replace function estoque_cliente()
returns table (medida text, marca text, modelo text, quantidade int, preco numeric)
language sql stable security definer set search_path = public as $$
  select m.descricao, mc.nome, p.nome, p.quantidade, coalesce(pc.preco, p.preco_venda)
    from produtos p
    join medidas m on m.id = p.medida_id
    join marcas mc on mc.id = p.marca_id
    left join perfis pf on pf.id = auth.uid()
    left join precos_cliente pc on pc.produto_id = p.id and pc.cliente_id = pf.cliente_id
   where p.ativo and exists (select 1 from perfis where id = auth.uid() and ativo)
   order by m.descricao, mc.nome, p.nome
$$;

-- ---------- 2) Dados da empresa (nota impressa) ----------
insert into configuracoes (chave, valor) values ('empresa', '{}'::jsonb) on conflict (chave) do nothing;

-- ---------- 3) Campos da venda da loja ----------
alter table vendas
  add column if not exists vendedor_nome     text,
  add column if not exists status_pagamento  text not null default 'pago' check (status_pagamento in ('pago','pendente','parcial')),
  add column if not exists forma_resumo      text,
  add column if not exists subtotal_pneus    numeric(12,2) not null default 0,
  add column if not exists alinhamento_qtd   int not null default 0,
  add column if not exists alinhamento_valor numeric(12,2) not null default 0,
  add column if not exists bicos_qtd         int not null default 0,
  add column if not exists bicos_valor       numeric(12,2) not null default 0,
  add column if not exists cambagem_qtd      int not null default 0,
  add column if not exists cambagem_valor    numeric(12,2) not null default 0,
  add column if not exists rodas_qtd         int not null default 0,
  add column if not exists rodas_valor       numeric(12,2) not null default 0,
  add column if not exists pecas_valor       numeric(12,2) not null default 0,
  add column if not exists servicos_valor    numeric(12,2) not null default 0,
  add column if not exists desconto_total    numeric(12,2) not null default 0,
  add column if not exists descontos         jsonb not null default '[]'::jsonb,
  add column if not exists troca_total       numeric(12,2) not null default 0;

create table venda_pagamentos (
  id        uuid primary key default gen_random_uuid(),
  venda_id  uuid not null references vendas(id),
  forma     forma_pgto not null,
  valor     numeric(12,2) not null check (valor > 0),
  parcelas  int not null default 1 check (parcelas between 1 and 24),
  criado_em timestamptz not null default now()
);
create index on venda_pagamentos (venda_id);

create table venda_boletos (
  id          uuid primary key default gen_random_uuid(),
  venda_id    uuid not null references vendas(id),
  conta_id    uuid references contas_receber(id),
  parcela     int not null,
  vencimento  date not null,
  valor       numeric(12,2) not null check (valor > 0),
  status      text not null default 'pendente' check (status in ('pendente','pago')),
  pago_em     timestamptz,
  forma_baixa forma_pgto
);
create index on venda_boletos (venda_id);
create index on venda_boletos (status, vencimento);

create table trocas (
  id          uuid primary key default gen_random_uuid(),
  venda_id    uuid not null references vendas(id),
  medida      text,
  descricao   text,
  estado      text,
  valor       numeric(12,2) not null default 0 check (valor >= 0),
  abatido     boolean not null default true,   -- true = desconta do total da venda
  observacoes text,
  criado_em   timestamptz not null default now()
);
create index on trocas (venda_id);

do $$ declare t text; begin
  foreach t in array array['venda_pagamentos','venda_boletos','trocas'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (is_ativo())', 'ler_' || t, t);
  end loop;
end $$;
-- Sem política de escrita: tudo entra só pelas funções abaixo.

alter publication supabase_realtime add table venda_boletos;

-- ---------- 4) Funções ----------
create or replace function jnum(j jsonb, k text) returns numeric language sql immutable as
$$ select coalesce(nullif(j->>k, '')::numeric, 0) $$;
create or replace function jint(j jsonb, k text) returns int language sql immutable as
$$ select coalesce(nullif(j->>k, '')::int, 0) $$;

-- Registra a venda inteira numa única transação.
-- p = { chave, tipo, cliente_id, obs, vencimento, status_pagamento,
--       itens:[{produto_id,quantidade,preco_unitario}], extras:{alinhamento_qtd,alinhamento_valor,bicos_*,cambagem_*,rodas_*,pecas_valor,servicos_valor},
--       descontos:[{origem,tipo,entrada,valor}], trocas:[{medida,descricao,estado,valor,abatido,observacoes}],
--       pagamentos:[{forma,valor,parcelas}]  (até 4),  boletos:[{vencimento,valor}] }
create or replace function registrar_venda_loja(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_chave   uuid    := (p->>'chave')::uuid;
  v_tipo    text    := coalesce(p->>'tipo', 'balcao');
  v_cliente uuid    := nullif(p->>'cliente_id', '')::uuid;
  v_status  text    := coalesce(p->>'status_pagamento', 'pago');
  ex        jsonb   := coalesce(p->'extras', '{}'::jsonb);
  v_itens   jsonb   := coalesce(p->'itens', '[]'::jsonb);
  v_pags    jsonb   := coalesce(p->'pagamentos', '[]'::jsonb);
  v_bols    jsonb   := coalesce(p->'boletos', '[]'::jsonb);
  v_id uuid; v_conta uuid; v_nome text; v_dias int;
  it jsonb; d jsonb; pg jsonb; bl jsonb; tr jsonb;
  v_qtd int; v_preco numeric(12,2); v_prod produtos%rowtype; v_desc text;
  v_pneus numeric(12,2) := 0; v_extras numeric(12,2); v_descontos numeric(12,2) := 0; v_troca numeric(12,2) := 0; v_total numeric(12,2);
  v_pago numeric(12,2); v_boletos numeric(12,2); v_venc date; v_n int := 0;
  v_forma forma_pgto; v_parc int; v_resumo text; v_forma_venda forma_pgto; v_prazo boolean := false;
begin
  if not is_ativo() then raise exception 'sem_permissao'; end if;
  if v_chave is null then raise exception 'item_invalido'; end if;

  select id into v_id from vendas where chave_idempotencia = v_chave;   -- reenvio: devolve a venda já gravada
  if found then return v_id; end if;

  if v_tipo not in ('balcao','atacado') then raise exception 'tipo_invalido'; end if;
  if v_tipo = 'atacado' and v_cliente is null then raise exception 'cliente_obrigatorio'; end if;
  if jsonb_typeof(v_itens) <> 'array' or jsonb_typeof(v_pags) <> 'array' or jsonb_typeof(v_bols) <> 'array' then raise exception 'item_invalido'; end if;
  if jsonb_array_length(v_pags) > 4 then raise exception 'max_4_formas'; end if;
  if v_status not in ('pago','pendente','parcial') then raise exception 'item_invalido'; end if;

  if least(jnum(ex,'alinhamento_valor'), jnum(ex,'bicos_valor'), jnum(ex,'cambagem_valor'), jnum(ex,'rodas_valor'), jnum(ex,'pecas_valor'), jnum(ex,'servicos_valor')) < 0
     or least(jint(ex,'alinhamento_qtd'), jint(ex,'bicos_qtd'), jint(ex,'cambagem_qtd'), jint(ex,'rodas_qtd')) < 0 then
    raise exception 'item_invalido';
  end if;
  v_extras := jnum(ex,'alinhamento_valor') + jnum(ex,'bicos_valor') + jnum(ex,'cambagem_valor')
            + jnum(ex,'rodas_valor') + jnum(ex,'pecas_valor') + jnum(ex,'servicos_valor');
  if jsonb_array_length(v_itens) = 0 and v_extras = 0 then raise exception 'venda_sem_itens'; end if;

  select nome into v_nome from perfis where id = auth.uid();

  -- trava os produtos em ordem fixa: aparelhos simultâneos entram na fila, sem vender o mesmo pneu duas vezes
  perform 1 from produtos
   where id in (select (x->>'produto_id')::uuid from jsonb_array_elements(v_itens) x)
   order by id for update;
  perform set_config('app.sistema', '1', true);

  insert into vendas (tipo, cliente_id, vendedor_id, vendedor_nome, observacoes, chave_idempotencia)
  values (v_tipo, v_cliente, auth.uid(), v_nome, p->>'obs', v_chave)
  returning id into v_id;

  -- pneus: baixa o estoque da marca escolhida
  for it in select value from jsonb_array_elements(v_itens) loop
    v_qtd   := (it->>'quantidade')::int;
    v_preco := (it->>'preco_unitario')::numeric;
    if v_qtd is null or v_qtd <= 0 or v_preco is null or v_preco < 0 then raise exception 'item_invalido'; end if;

    update produtos set quantidade = quantidade - v_qtd
     where id = (it->>'produto_id')::uuid and ativo and quantidade >= v_qtd
     returning * into v_prod;
    if not found then
      select m.descricao || ' ' || mc.nome into v_desc
        from produtos pr join medidas m on m.id = pr.medida_id join marcas mc on mc.id = pr.marca_id
       where pr.id = (it->>'produto_id')::uuid;
      raise exception 'estoque_insuficiente: %', coalesce(v_desc, 'produto não encontrado');
    end if;

    insert into itens_venda (venda_id, produto_id, quantidade, preco_unitario, custo_unitario)
    values (v_id, v_prod.id, v_qtd, v_preco, v_prod.preco_custo);
    insert into movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, venda_id, usuario_id)
    values (v_prod.id, 'venda', -v_qtd, v_prod.quantidade, v_id, auth.uid());
    v_pneus := v_pneus + round(v_qtd * v_preco, 2);
  end loop;

  -- descontos (o valor em R$ já vem resolvido; origem/tipo ficam só como registro)
  for d in select value from jsonb_array_elements(coalesce(p->'descontos', '[]'::jsonb)) loop
    if jnum(d,'valor') < 0 then raise exception 'item_invalido'; end if;
    v_descontos := v_descontos + jnum(d,'valor');
  end loop;
  if v_descontos > v_pneus + v_extras then raise exception 'desconto_maior_que_total'; end if;

  -- base de troca
  for tr in select value from jsonb_array_elements(coalesce(p->'trocas', '[]'::jsonb)) loop
    if jnum(tr,'valor') < 0 then raise exception 'item_invalido'; end if;
    insert into trocas (venda_id, medida, descricao, estado, valor, abatido, observacoes)
    values (v_id, tr->>'medida', tr->>'descricao', tr->>'estado', jnum(tr,'valor'),
            coalesce((tr->>'abatido')::boolean, true), tr->>'observacoes');
    if coalesce((tr->>'abatido')::boolean, true) then v_troca := v_troca + jnum(tr,'valor'); end if;
  end loop;

  v_total := v_pneus + v_extras - v_descontos - v_troca;
  if v_total < 0 then raise exception 'total_negativo'; end if;

  -- pagamento
  select coalesce(sum(jnum(x,'valor')), 0) into v_pago    from jsonb_array_elements(v_pags) x;
  select coalesce(sum(jnum(x,'valor')), 0) into v_boletos from jsonb_array_elements(v_bols) x;

  if jsonb_array_length(v_bols) > 0 then
    if v_cliente is null then raise exception 'cliente_obrigatorio'; end if;
    if jsonb_array_length(v_bols) > 12 then raise exception 'item_invalido'; end if;
    if abs(v_pago + v_boletos - v_total) > 0.01 then raise exception 'pagamento_inconsistente'; end if;
    v_status := case when v_pago > 0 then 'parcial' else 'pendente' end;
    v_prazo := true;
  elsif v_status = 'pago' then
    if abs(v_pago - v_total) > 0.01 then raise exception 'pagamento_incompleto'; end if;
  else
    if v_cliente is null then raise exception 'cliente_obrigatorio'; end if;
    if v_status = 'pendente' and v_pago > 0 then v_status := 'parcial'; end if;
    if v_status = 'parcial' and (v_pago <= 0 or v_pago >= v_total) then raise exception 'pagamento_inconsistente'; end if;
    v_prazo := true;
  end if;

  if v_prazo then
    if jsonb_array_length(v_bols) > 0 then
      select min((x->>'vencimento')::date) into v_venc from jsonb_array_elements(v_bols) x;
    else
      select (valor #>> '{}')::int into v_dias from configuracoes where chave = 'dias_vencimento_padrao';
      v_venc := coalesce(nullif(p->>'vencimento', '')::date, current_date + coalesce(v_dias, 30));
    end if;
    insert into contas_receber (venda_id, cliente_id, valor_total, valor_pago, status, vencimento)
    values (v_id, v_cliente, v_total, v_pago, (case when v_pago > 0 then 'parcial' else 'aberta' end)::status_conta, v_venc)
    returning id into v_conta;
  end if;

  for pg in select value from jsonb_array_elements(v_pags) loop
    v_forma := (pg->>'forma')::forma_pgto;
    if v_forma not in ('dinheiro','pix','cartao_debito','cartao_credito') then raise exception 'forma_invalida'; end if;
    if jnum(pg,'valor') <= 0 then raise exception 'item_invalido'; end if;
    v_parc := greatest(1, jint(pg,'parcelas'));
    if v_forma <> 'cartao_credito' then v_parc := 1; end if;
    insert into venda_pagamentos (venda_id, forma, valor, parcelas) values (v_id, v_forma, jnum(pg,'valor'), v_parc);
    if v_conta is not null then
      insert into pagamentos (conta_id, cliente_id, valor, forma, observacao, registrado_por)
      values (v_conta, v_cliente, jnum(pg,'valor'), v_forma, 'Pago na venda', auth.uid());
    end if;
    v_n := v_n + 1;
    if v_n = 1 then
      v_forma_venda := v_forma;
      v_resumo := case v_forma when 'dinheiro' then 'Dinheiro' when 'pix' then 'PIX' when 'cartao_debito' then 'Débito'
                  else 'Crédito' || case when v_parc > 1 then ' ' || v_parc::text || 'x' else '' end end;
    end if;
  end loop;
  if v_n > 1 then v_resumo := 'Múltiplo'; end if;

  if jsonb_array_length(v_bols) > 0 then
    v_resumo := 'Boletos ' || jsonb_array_length(v_bols)::text || 'x' || case when v_n > 0 then ' + entrada' else '' end;
    v_forma_venda := 'boleto';
    v_n := 0;
    for bl in select value from jsonb_array_elements(v_bols) loop
      v_n := v_n + 1;
      if jnum(bl,'valor') <= 0 then raise exception 'item_invalido'; end if;
      insert into venda_boletos (venda_id, conta_id, parcela, vencimento, valor)
      values (v_id, v_conta, v_n, (bl->>'vencimento')::date, jnum(bl,'valor'));
    end loop;
  elsif v_n = 0 then
    v_resumo := 'A receber';
  end if;

  update vendas set
    total = v_total, subtotal_pneus = v_pneus,
    alinhamento_qtd = jint(ex,'alinhamento_qtd'), alinhamento_valor = jnum(ex,'alinhamento_valor'),
    bicos_qtd = jint(ex,'bicos_qtd'),             bicos_valor = jnum(ex,'bicos_valor'),
    cambagem_qtd = jint(ex,'cambagem_qtd'),       cambagem_valor = jnum(ex,'cambagem_valor'),
    rodas_qtd = jint(ex,'rodas_qtd'),             rodas_valor = jnum(ex,'rodas_valor'),
    pecas_valor = jnum(ex,'pecas_valor'),         servicos_valor = jnum(ex,'servicos_valor'),
    desconto_total = v_descontos, descontos = coalesce(p->'descontos', '[]'::jsonb), troca_total = v_troca,
    a_prazo = v_prazo, status_pagamento = v_status, forma_resumo = v_resumo, forma_pgto = v_forma_venda
  where id = v_id;
  return v_id;
end $$;

-- Associar (ou trocar/remover) o cliente de uma venda já feita. Vendas a prazo já têm cliente e conta: não mudam.
create or replace function vincular_cliente(p_venda uuid, p_cliente uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v vendas%rowtype;
begin
  if not is_ativo() then raise exception 'sem_permissao'; end if;
  select * into v from vendas where id = p_venda for update;
  if not found then raise exception 'venda_inexistente'; end if;
  if v.a_prazo then raise exception 'venda_a_prazo'; end if;
  if v.tipo = 'atacado' and p_cliente is null then raise exception 'cliente_obrigatorio'; end if;
  update vendas set cliente_id = p_cliente where id = p_venda;
end $$;

-- Dar baixa em um boleto (administrador)
create or replace function baixar_boleto(p_boleto uuid, p_forma forma_pgto, p_chave uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare b venda_boletos%rowtype; c contas_receber%rowtype; v_id uuid; v_pend date;
begin
  if not is_admin() then raise exception 'sem_permissao'; end if;
  select id into v_id from pagamentos where chave_idempotencia = p_chave;
  if found then return v_id; end if;

  select * into b from venda_boletos where id = p_boleto for update;
  if not found then raise exception 'conta_inexistente'; end if;
  if b.status = 'pago' then raise exception 'conta_encerrada'; end if;
  select * into c from contas_receber where id = b.conta_id for update;
  if c.status in ('quitada','cancelada') then raise exception 'conta_encerrada'; end if;

  insert into pagamentos (conta_id, cliente_id, valor, forma, observacao, chave_idempotencia, registrado_por)
  values (c.id, c.cliente_id, b.valor, p_forma, 'Boleto parcela ' || b.parcela::text, p_chave, auth.uid())
  returning id into v_id;

  update venda_boletos set status = 'pago', pago_em = now(), forma_baixa = p_forma where id = b.id;
  select min(vencimento) into v_pend from venda_boletos where conta_id = c.id and status = 'pendente';
  update contas_receber
     set valor_pago = valor_pago + b.valor,
         status = (case when valor_pago + b.valor >= valor_total then 'quitada' else 'parcial' end)::status_conta,
         vencimento = coalesce(v_pend, vencimento)
   where id = c.id;
  update vendas set status_pagamento = case when v_pend is null then 'pago' else 'parcial' end where id = c.venda_id;
  return v_id;
end $$;

-- Receber pagamento de conta passa a ser só do administrador (financeiro)
create or replace function registrar_pagamento(
  p_conta uuid, p_valor numeric, p_forma forma_pgto, p_chave uuid, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_c contas_receber%rowtype; v_id uuid;
begin
  if not is_admin() then raise exception 'sem_permissao'; end if;
  select id into v_id from pagamentos where chave_idempotencia = p_chave;
  if found then return v_id; end if;

  select * into v_c from contas_receber where id = p_conta for update;
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

revoke execute on function registrar_venda_loja(jsonb), vincular_cliente(uuid, uuid), baixar_boleto(uuid, forma_pgto, uuid), estoque_cliente() from public, anon;
grant  execute on function registrar_venda_loja(jsonb), vincular_cliente(uuid, uuid), baixar_boleto(uuid, forma_pgto, uuid), estoque_cliente() to authenticated;
