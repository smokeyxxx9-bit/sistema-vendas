-- Rode isso no SQL Editor do seu projeto Supabase (Supabase → SQL Editor → New query)

create table if not exists kv_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table kv_store enable row level security;

-- Como o sistema não usa login de usuário do Supabase (usa a senha própria
-- dele), liberamos leitura/escrita pra "anon" (chave pública). Só quem tem
-- o link do site consegue mexer nos dados — igual já era com o localStorage.
create policy "allow all for anon" on kv_store
  for all
  using (true)
  with check (true);

-- ativa o realtime (sincronização instantânea entre telas abertas)
alter publication supabase_realtime add table kv_store;
