// Edge Function "backup": grava um arquivo .json.gz no bucket privado "backups".
// Retenção: tudo das últimas 48 h; depois, 1 arquivo por dia até 90 dias.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.headers.get("x-backup-secret") !== Deno.env.get("BACKUP_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let arquivo = "";
  try {
    const { data, error } = await sb.rpc("exportar_backup");
    if (error) throw new Error(error.message);

    const iso = new Date().toISOString().replace(/[:.]/g, "-");
    arquivo = `${iso.slice(0, 10)}/${iso}.json.gz`;
    const gz = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(gz).arrayBuffer());

    const up = await sb.storage.from("backups").upload(arquivo, bytes, { contentType: "application/gzip" });
    if (up.error) throw new Error(up.error.message);
    await sb.from("backup_log").insert({ arquivo, bytes: bytes.length, ok: true });

    // retenção
    const { data: dias } = await sb.storage.from("backups").list("", { limit: 1000 });
    for (const d of dias ?? []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.name)) continue;
      const idade = (Date.now() - new Date(d.name).getTime()) / 864e5;
      if (idade < 2) continue;
      const { data: arqs } = await sb.storage.from("backups").list(d.name, { limit: 1000 });
      const nomes = (arqs ?? []).map((a) => a.name).sort();
      const apagar = idade > 90 ? nomes : nomes.slice(1);
      if (apagar.length) await sb.storage.from("backups").remove(apagar.map((n) => `${d.name}/${n}`));
    }
    return new Response(JSON.stringify({ ok: true, arquivo, bytes: bytes.length }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    await sb.from("backup_log").insert({ arquivo, ok: false, erro: String(e).slice(0, 500) });
    return new Response(String(e), { status: 500 });
  }
});
