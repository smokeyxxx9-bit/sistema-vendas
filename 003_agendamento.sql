-- =====================================================================
-- 003_agendamento.sql  |  Backup automático a cada 15 minutos
-- ANTES DE RODAR: faça o deploy da função "backup" (veja o README) e
-- troque SEU-PROJETO e TROQUE_O_SEGREDO abaixo.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('backup-15min', '*/15 * * * *', $$
  select net.http_post(
    url     := 'https://aqqabtnlmosisbppdweh.supabase.co/functions/v1/backup',
    headers := jsonb_build_object('Content-Type','application/json','x-backup-secret','TROQUE_O_SEGREDO'),
    body    := '{}'::jsonb)
$$);
-- Para mudar o intervalo (ex.: 5 min):
-- select cron.alter_job((select jobid from cron.job where jobname='backup-15min'), schedule := '*/5 * * * *');
