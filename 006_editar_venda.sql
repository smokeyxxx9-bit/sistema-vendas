-- =====================================================================
-- 006: editar venda (atacado) + base para reimpressão de garantia
-- Rode UMA vez no SQL Editor, depois do 005_fase2.sql.
-- =====================================================================

alter table vendas
  add column if not exists editada_em  timestamptz,
  add column if not exists editada_por text;

-- Gravação da venda (nova ou editada) numa única transação.
-- É o mesmo corpo de registrar_venda_loja; com p_editando preenchido, regrava a venda existente
-- (mesmo id, mesmo número de nota) em vez de criar outra.
create or replace function _gravar_venda_loja(p jsonb, p_editando uuid default null) returns uuid
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
  if p_editando is null then
    if v_chave is null then raise exception 'item_invalido'; end if;
    select id into v_id from vendas where chave_idempotencia = v_chave;   -- reenvio: devolve a venda já gravada
    if found then return v_id; end if;
  end if;

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

  if p_editando is null then
    insert into vendas (tipo, cliente_id, vendedor_id, vendedor_nome, observacoes, chave_idempotencia)
    values (v_tipo, v_cliente, auth.uid(), v_nome, p->>'obs', v_chave)
    returning id into v_id;
  else   -- edição: mantém id, número, data e vendedor originais
    v_id := p_editando;
    update vendas set cliente_id = v_cliente, observacoes = p->>'obs' where id = v_id;
  end if;

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

-- Venda nova: comportamento idêntico ao de antes.
create or replace function registrar_venda_loja(p jsonb) returns uuid
language sql security definer set search_path = public as
$$ select _gravar_venda_loja(p, null) $$;

-- Editar venda já concluída: devolve ao estoque o que foi vendido, apaga itens/pagamentos/boletos/trocas
-- e grava de novo com os dados novos, tudo na mesma transação (se algo falhar, nada muda).
-- Não edita: venda cancelada, venda com recebimento já registrado (pagamento em conta a receber ou boleto pago).
-- Quem pode: administrador (qualquer venda) e vendedor (só as vendas que ele mesmo lançou).
create or replace function editar_venda_loja(p_venda uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v vendas%rowtype; r record; v_saldo int; v_papel text; v_nome text;
begin
  select papel::text, nome into v_papel, v_nome from perfis where id = auth.uid() and ativo;
  if v_papel is null or v_papel not in ('admin','vendedor') then raise exception 'sem_permissao'; end if;

  select * into v from vendas where id = p_venda for update;
  if not found then raise exception 'venda_inexistente'; end if;
  if v.status = 'cancelada' then raise exception 'venda_ja_cancelada'; end if;
  if v_papel <> 'admin' and v.vendedor_id is distinct from auth.uid() then raise exception 'sem_permissao'; end if;
  if exists (select 1 from pagamentos pg join contas_receber c on c.id = pg.conta_id where c.venda_id = p_venda)
     or exists (select 1 from venda_boletos where venda_id = p_venda and status = 'pago') then
    raise exception 'edicao_com_pagamentos';
  end if;

  perform 1 from produtos where id in (select produto_id from itens_venda where venda_id = p_venda) order by id for update;
  perform set_config('app.sistema', '1', true);

  for r in select produto_id, sum(quantidade)::int as q from itens_venda where venda_id = p_venda group by produto_id loop
    update produtos set quantidade = quantidade + r.q where id = r.produto_id returning quantidade into v_saldo;
    insert into movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, venda_id, motivo, usuario_id)
    values (r.produto_id, 'ajuste', r.q, v_saldo, p_venda, 'Edição da venda #' || v.numero::text, auth.uid());
  end loop;

  delete from venda_boletos    where venda_id = p_venda;
  delete from contas_receber   where venda_id = p_venda;
  delete from venda_pagamentos where venda_id = p_venda;
  delete from trocas           where venda_id = p_venda;
  delete from itens_venda      where venda_id = p_venda;

  perform _gravar_venda_loja(p, p_venda);
  update vendas set editada_em = now(), editada_por = v_nome where id = p_venda;
  return p_venda;
end $$;

-- A função interna só é chamada pelas duas de cima; o app não a chama direto.
revoke execute on function _gravar_venda_loja(jsonb, uuid) from public, anon, authenticated;
revoke execute on function registrar_venda_loja(jsonb), editar_venda_loja(uuid, jsonb) from public, anon;
grant  execute on function registrar_venda_loja(jsonb), editar_venda_loja(uuid, jsonb) to authenticated;
