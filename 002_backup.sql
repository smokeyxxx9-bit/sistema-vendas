-- =====================================================================
-- 002_backup.sql  |  Exportação completa + bucket privado de backups
-- =====================================================================
create or replace function exportar_backup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := jsonb_build_object('gerado_em', now(), 'versao_schema', 1); t text; v jsonb;
begin
  if not (is_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then raise exception 'sem_permissao'; end if;
  foreach t in array array['perfis','configuracoes','medidas','marcas','produtos','movimentacoes_estoque','clientes',
                           'precos_cliente','vendas','itens_venda','contas_receber','pagamentos','log_alteracoes'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v;
    r := r || jsonb_build_object(t, v);
  end loop;
  return r;
end $$;

insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;
