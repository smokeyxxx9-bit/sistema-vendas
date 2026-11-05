import { sb, chamar } from '../supabase.js';
import { state } from '../state.js';
import { $, esc, dataHora, num, toast, baixar } from '../ui.js';

let logo = '';   // logotipo (data URL já reduzido) em edição

// Reduz a imagem escolhida para no máximo 400 px e devolve um data URL pequeno.
function lerLogo(arquivo) {
  return new Promise((ok, err) => {
    const img = new Image(), url = URL.createObjectURL(arquivo);
    img.onload = () => {
      const k = Math.min(1, 400 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      ok(cv.toDataURL('image/png'));
    };
    img.onerror = () => err(new Error('Não foi possível ler esta imagem.'));
    img.src = url;
  });
}

export async function render(root) {
  const [cfg, medidas, perfis, backups, logs, clientes] = await Promise.all([
    chamar(sb.from('configuracoes').select('*')),
    chamar(sb.from('medidas').select('id, descricao, estoque_minimo').eq('ativo', true).order('descricao')),
    chamar(sb.from('perfis').select('*').order('nome')),
    chamar(sb.from('backup_log').select('*').order('criado_em', { ascending: false }).limit(10)),
    chamar(sb.from('log_alteracoes').select('*').order('id', { ascending: false }).limit(100)),
    chamar(sb.from('clientes').select('id, nome').eq('ativo', true).order('nome')),
  ]);
  const c = Object.fromEntries(cfg.map((x) => [x.chave, x.valor]));
  const emp = c.empresa || {};
  logo = typeof emp.logo === 'string' ? emp.logo : '';
  const nomes = Object.fromEntries(perfis.map((p) => [p.id, p.nome]));
  const ultimoOk = backups.find((b) => b.ok);
  const atrasado = !ultimoOk || Date.now() - new Date(ultimoOk.criado_em) > 30 * 60e3;

  root.innerHTML = `
    <section class="bloco"><h2>Estoque, fiado e preços</h2>
      <form id="f-cfg" class="grade"><label>Limite padrão (unidades por medida)<input name="min" type="number" min="0" value="${c.estoque_minimo_padrao ?? 10}"></label>
        <label>Prazo padrão do fiado (dias)<input name="dias" type="number" min="1" value="${c.dias_vencimento_padrao ?? 30}"></label>
        <label>Margem de lucro padrão (% sobre o custo)<input name="margem" inputmode="decimal" value="${String(c.margem_padrao ?? 50).replace('.', ',')}"></label><button class="btn primario">Salvar</button></form>
      <details><summary>Limite diferente para uma medida</summary><div class="rolagem"><table><tbody>${medidas.map((m) =>
        `<tr><td>${esc(m.descricao)}</td><td><input type="number" min="0" data-min="${m.id}" value="${m.estoque_minimo ?? ''}" placeholder="padrão" aria-label="Mínimo de ${esc(m.descricao)}"></td></tr>`).join('')}</tbody></table></div></details></section>

    <section class="bloco"><h2>Dados da empresa (nota impressa)</h2>
      <form id="f-emp" class="grade"><label>Nome da empresa<input name="nome" value="${esc(emp.nome)}"></label>
        <label>Telefone<input name="telefone" value="${esc(emp.telefone)}"></label>
        <label>CNPJ<input name="cnpj" value="${esc(emp.cnpj)}"></label>
        <label>Endereço<input name="endereco" value="${esc(emp.endereco)}"></label>
        <label>Informações adicionais<textarea name="info" rows="2">${esc(emp.info)}</textarea></label>
        <label>Logotipo<input type="file" id="emp-logo" accept="image/*"></label>
        <div id="emp-prev">${logo ? `<img src="${esc(logo)}" alt="Logotipo" style="max-height:60px;max-width:180px"> <button type="button" class="btn mini" id="emp-rm">Remover logo</button>` : '<small>Sem logotipo.</small>'}</div>
        <button class="btn primario">Salvar dados da empresa</button></form></section>

    <section class="bloco"><h2>Usuários</h2>
      <p><small>Para criar um usuário: Supabase > Authentication > Users > Add user. Depois defina o papel aqui.</small></p>
      <div class="rolagem"><table><thead><tr><th>Nome</th><th>Perfil</th><th>Cliente vinculado</th><th>Ativo</th></tr></thead><tbody>${perfis.map((p) => `<tr>
        <td>${esc(p.nome)}</td><td><select data-papel="${p.id}"><option value="vendedor"${p.papel === 'vendedor' ? ' selected' : ''}>Vendedor</option><option value="admin"${p.papel === 'admin' ? ' selected' : ''}>Administrador</option><option value="cliente"${p.papel === 'cliente' ? ' selected' : ''}>Cliente (só estoque)</option></select></td>
        <td>${p.papel === 'cliente' ? `<select data-cli="${p.id}"><option value="">Sem vínculo (preço padrão)</option>${clientes.map((x) => `<option value="${x.id}"${x.id === p.cliente_id ? ' selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>` : ''}</td>
        <td><input type="checkbox" data-ativo="${p.id}" ${p.ativo ? 'checked' : ''} style="width:auto" aria-label="Ativo"></td></tr>`).join('')}</tbody></table></div></section>

    <section class="bloco ${atrasado ? 'alerta' : ''}"><h2>Backup</h2>
      <p>${atrasado ? '<strong>Atenção:</strong> nenhum backup automático foi concluído nos últimos 30 minutos. Confira o agendamento e a função "backup".' : `Último backup automático: <strong>${dataHora(ultimoOk.criado_em)}</strong>.`}</p>
      <p><button class="btn" id="bk">Baixar backup completo agora (JSON)</button></p>
      <div class="rolagem"><table><thead><tr><th>Quando</th><th>Arquivo</th><th class="n">Tamanho</th><th>Resultado</th></tr></thead><tbody>${backups.map((b) =>
        `<tr><td>${dataHora(b.criado_em)}</td><td>${esc(b.arquivo)}</td><td class="n">${b.bytes ? (b.bytes / 1024).toFixed(0) + ' KB' : ''}</td><td>${b.ok ? 'Ok' : '<span class="neg">' + esc(b.erro) + '</span>'}</td></tr>`).join('') || '<tr><td colspan="4">Nenhum backup registrado ainda.</td></tr>'}</tbody></table></div></section>

    <section class="bloco"><h2>Histórico de alterações</h2><div class="rolagem"><table><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead><tbody>${logs.map((l) => {
      const mudou = l.acao === 'UPDATE' ? Object.keys(l.depois || {}).filter((k) => !['versao', 'atualizado_em'].includes(k) && JSON.stringify(l.antes[k]) !== JSON.stringify(l.depois[k])).join(', ') : '';
      return `<tr><td>${dataHora(l.criado_em)}</td><td>${esc(nomes[l.usuario_id] || '—')}</td><td>${esc(l.acao === 'INSERT' ? 'Criou' : l.acao === 'UPDATE' ? 'Alterou' : 'Removeu')} ${esc(l.tabela)}</td><td>${esc(mudou || (l.depois?.nome || l.depois?.descricao || l.antes?.nome || ''))}</td></tr>`;
    }).join('')}</tbody></table></div></section>`;

  $('#f-cfg').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    try {
      await chamar(sb.from('configuracoes').update({ valor: parseInt(f.get('min'), 10), atualizado_em: new Date().toISOString() }).eq('chave', 'estoque_minimo_padrao'));
      await chamar(sb.from('configuracoes').update({ valor: parseInt(f.get('dias'), 10), atualizado_em: new Date().toISOString() }).eq('chave', 'dias_vencimento_padrao'));
      const margem = num(f.get('margem'));
      if (!(margem >= 0)) throw new Error('Informe uma margem válida.');
      await chamar(sb.from('configuracoes').upsert({ chave: 'margem_padrao', valor: margem, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' }));
      toast('Configurações salvas');
    } catch (err) { toast(err.message, 'erro'); }
  };
  root.querySelectorAll('[data-min]').forEach((i) => (i.onchange = async () => {
    try { await chamar(sb.from('medidas').update({ estoque_minimo: i.value === '' ? null : parseInt(i.value, 10) }).eq('id', i.dataset.min)); toast('Limite salvo'); }
    catch (err) { toast(err.message, 'erro'); }
  }));
  root.querySelectorAll('[data-papel],[data-ativo]').forEach((el) => (el.onchange = async () => {
    const id = el.dataset.papel || el.dataset.ativo, mudanca = el.dataset.papel ? { papel: el.value } : { ativo: el.checked };
    if (id === state.perfil.id && (mudanca.papel && mudanca.papel !== 'admin' || mudanca.ativo === false)) { toast('Você não pode remover seu próprio acesso de administrador.', 'erro'); return render(root); }
    try { await chamar(sb.from('perfis').update(mudanca).eq('id', id)); toast('Usuário atualizado'); if (mudanca.papel) await render(root); } catch (err) { toast(err.message, 'erro'); }
  }));
  $('#emp-logo').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { logo = await lerLogo(f); $('#emp-prev').innerHTML = `<img src="${logo}" alt="Logotipo" style="max-height:60px;max-width:180px"> <small>Clique em Salvar para guardar.</small>`; }
    catch (err) { toast(err.message, 'erro'); }
  };
  $('#emp-prev').onclick = (e) => { if (e.target.id === 'emp-rm') { logo = ''; $('#emp-prev').innerHTML = '<small>Sem logotipo. Clique em Salvar para confirmar.</small>'; } };
  $('#f-emp').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const valor = { logo }; for (const k of ['nome', 'telefone', 'cnpj', 'endereco', 'info']) valor[k] = f.get(k).trim();
    try { await chamar(sb.from('configuracoes').upsert({ chave: 'empresa', valor, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' })); toast('Dados da empresa salvos'); }
    catch (err) { toast(err.message, 'erro'); }
  };
  root.querySelectorAll('[data-cli]').forEach((el) => (el.onchange = async () => {
    try { await chamar(sb.from('perfis').update({ cliente_id: el.value || null }).eq('id', el.dataset.cli)); toast('Cliente vinculado'); } catch (err) { toast(err.message, 'erro'); }
  }));
  $('#bk').onclick = async () => {
    try { const d = await chamar(sb.rpc('exportar_backup')); baixar(`backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(d), 'application/json'); }
    catch (err) { toast(err.message, 'erro'); }
  };
}
