import { sb, chamar } from '../supabase.js';
import { $, esc, brl, num, fmtNum, dataBR, abrirForm, confirmar, toast } from '../ui.js';

let aba = 'func', raiz, lista = [], perfis = [], comp = '';
const mesPrimeiro = (delta) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + delta); return d.toLocaleDateString('sv-SE'); };
const nomeMes = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const pct = (n) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export async function render(root) {
  raiz = root; comp ||= mesPrimeiro(-1).slice(0, 7);
  raiz.innerHTML = `<div class="abas"><button data-aba="func" aria-pressed="${aba === 'func'}">Funcionários</button><button data-aba="com" aria-pressed="${aba === 'com'}">Comissões</button></div><div id="f-corpo"></div>`;
  raiz.querySelectorAll('[data-aba]').forEach((b) => (b.onclick = () => { aba = b.dataset.aba; render(raiz); }));
  aba === 'func' ? await funcionarios() : await comissoes();
}
export const aoMudar = render;

/* ---------- cadastro ---------- */
async function funcionarios() {
  [lista, perfis] = await Promise.all([
    chamar(sb.from('funcionarios').select('*').eq('ativo', true).order('nome')),
    chamar(sb.from('perfis').select('id, nome, papel').eq('ativo', true).in('papel', ['vendedor', 'admin']).order('nome')),
  ]);
  const nomePerfil = Object.fromEntries(perfis.map((p) => [p.id, p.nome]));
  $('#f-corpo').innerHTML = `<div class="barra-ferramentas"><button class="btn primario" id="f-novo">Novo funcionário</button></div>
    ${lista.length ? `<div class="bloco"><div class="rolagem"><table><thead><tr><th>Nome</th><th>Cargo</th><th class="n">Comissão</th><th class="n">Meta mensal</th><th class="n">Comissão ao bater a meta</th><th>Usuário</th><th></th></tr></thead><tbody>
      ${lista.map((f) => `<tr data-id="${f.id}"><td>${esc(f.nome)}</td><td>${esc(f.cargo)}</td><td class="n">${pct(f.comissao_pct)}</td><td class="n">${Number(f.meta_valor) ? brl(f.meta_valor) : '—'}</td>
        <td class="n">${Number(f.meta_valor) ? pct(f.comissao_meta_pct) : '—'}</td><td>${f.perfil_id ? esc(nomePerfil[f.perfil_id] || '—') : '<span class="chip atraso">sem usuário</span>'}</td>
        <td class="acoes"><button class="btn mini" data-a="editar">Editar</button><button class="btn mini" data-a="excluir">Desativar</button></td></tr>`).join('')}</tbody></table></div></div>
      <p class="resumo-pag">As vendas só entram na comissão quando o funcionário está ligado ao usuário (login) que fez a venda.</p>` : '<p class="vazio">Nenhum funcionário cadastrado.</p>'}`;
  $('#f-novo').onclick = () => form();
  $('#f-corpo').onclick = (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const f = lista.find((x) => x.id === b.closest('tr').dataset.id);
    b.dataset.a === 'editar' ? form(f) : desativar(f);
  };
}

function form(f) {
  const usados = new Set(lista.filter((x) => x.perfil_id && x.id !== f?.id).map((x) => x.perfil_id));
  abrirForm({
    titulo: f ? 'Editar funcionário' : 'Novo funcionário',
    corpo: `<label>Nome<input name="nome" required value="${esc(f?.nome)}"></label>
      <label>Cargo<input name="cargo" value="${esc(f?.cargo)}" placeholder="Ex.: Vendedor, Montador"></label>
      <label>Comissão (% sobre o vendido)<input name="pct" inputmode="decimal" required value="${f ? fmtNum(f.comissao_pct) : ''}" placeholder="Ex.: 2"></label>
      <label>Meta mensal de vendas (R$) — deixe 0 se não houver<input name="meta" inputmode="decimal" value="${f ? fmtNum(f.meta_valor) : '0'}"></label>
      <label>Comissão ao bater a meta (%) — vale para todas as vendas do mês<input name="pctmeta" inputmode="decimal" value="${f ? fmtNum(f.comissao_meta_pct) : '0'}"></label>
      <label>Usuário (login) deste funcionário<select name="perfil"><option value="">Sem usuário (não conta vendas)</option>
        ${perfis.filter((p) => !usados.has(p.id)).map((p) => `<option value="${p.id}"${p.id === f?.perfil_id ? ' selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>`,
    async onSubmit(fd) {
      const c = num(fd.get('pct')), meta = num(fd.get('meta') || '0'), cm = num(fd.get('pctmeta') || '0');
      if (![c, meta, cm].every((x) => Number.isFinite(x) && x >= 0) || c > 100 || cm > 100) throw new Error('Confira as porcentagens (0 a 100) e a meta.');
      const campos = { nome: fd.get('nome').trim(), cargo: fd.get('cargo').trim() || null, comissao_pct: c, meta_valor: meta, comissao_meta_pct: cm, perfil_id: fd.get('perfil') || null };
      await chamar(f ? sb.from('funcionarios').update(campos).eq('id', f.id) : sb.from('funcionarios').insert(campos));
      toast('Funcionário salvo'); await render(raiz);
    },
  });
}
async function desativar(f) {
  if (!(await confirmar(`Desativar ${f.nome}? As comissões já pagas continuam no histórico.`, { ok: 'Desativar' }))) return;
  try { await chamar(sb.from('funcionarios').update({ ativo: false }).eq('id', f.id)); toast('Funcionário desativado'); await render(raiz); }
  catch (e) { toast(e.message, 'erro'); }
}

/* ---------- comissões ---------- */
async function comissoes() {
  const [cfg, rows] = await Promise.all([
    chamar(sb.from('configuracoes').select('valor').eq('chave', 'comissao_dia_pagamento').maybeSingle()),
    chamar(sb.rpc('comissoes', { p_competencia: comp + '-01' })),
  ]);
  const dia = Number(cfg?.valor) || 5, fechado = comp + '-01' < mesPrimeiro(0), total = rows.reduce((s, c) => s + Number(c.valor), 0);
  $('#f-corpo').innerHTML = `<div class="barra-ferramentas"><label>Mês das vendas<input type="month" id="c-mes" value="${comp}"></label>
      <label>Dia de pagamento (todo mês)<input type="number" id="c-dia" min="1" max="28" value="${dia}"></label><button class="btn" id="c-salvar">Salvar dia</button></div>
    <p class="resumo-pag">As comissões de um mês são pagas no dia ${dia} do mês seguinte. O dashboard avisa quando a data chega.</p>
    ${rows.length ? `<div class="bloco"><h2>${esc(nomeMes(comp + '-01'))}${fechado ? '' : ' (mês em andamento)'}</h2><div class="rolagem"><table><thead><tr><th>Funcionário</th><th class="n">Vendas</th><th class="n">Total vendido</th><th class="n">Meta</th><th class="n">% aplicado</th><th class="n">Comissão</th><th>Situação</th><th></th></tr></thead><tbody>
      ${rows.map((c) => `<tr data-id="${c.funcionario_id}"><td>${esc(c.nome)}</td><td class="n">${c.vendas_qtd}</td><td class="n">${brl(c.total_vendido)}</td>
        <td class="n">${Number(c.meta) ? brl(c.meta) + (c.atingiu ? ' <span class="chip pago">batida</span>' : '') : '—'}</td><td class="n">${pct(c.pct)}</td><td class="n"><strong>${brl(c.valor)}</strong></td>
        <td>${c.pago ? `<span class="chip pago">Paga em ${dataBR(c.pago_em)}</span>` : fechado ? '<span class="chip pendente">A pagar</span>' : '<span class="chip">Em andamento</span>'}</td>
        <td class="acoes">${!c.pago && fechado && Number(c.valor) > 0 ? '<button class="btn mini primario" data-pagar>Marcar como paga</button>' : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="5">Total</td><td class="n">${brl(total)}</td><td colspan="2"></td></tr></tfoot></table></div></div>` : '<p class="vazio">Cadastre funcionários na aba Funcionários.</p>'}`;
  $('#c-mes').onchange = (e) => { if (e.target.value) { comp = e.target.value; comissoes(); } };
  $('#c-salvar').onclick = async () => {
    const d = parseInt($('#c-dia').value, 10);
    if (!(d >= 1 && d <= 28)) return toast('Escolha um dia entre 1 e 28.', 'erro');
    try { await chamar(sb.from('configuracoes').upsert({ chave: 'comissao_dia_pagamento', valor: d, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' })); toast('Dia de pagamento salvo'); comissoes(); }
    catch (e) { toast(e.message, 'erro'); }
  };
  $('#f-corpo').onclick = (e) => {
    const b = e.target.closest('[data-pagar]'); if (!b) return;
    const c = rows.find((x) => x.funcionario_id === b.closest('tr').dataset.id);
    abrirForm({
      titulo: `Pagar comissão — ${c.nome}`, ok: 'Confirmar pagamento',
      corpo: `<p>${esc(nomeMes(comp + '-01'))}: ${brl(c.total_vendido)} vendidos × ${pct(c.pct)}${c.atingiu ? ' (meta batida)' : ''} = <strong>${brl(c.valor)}</strong></p><label>Observação<input name="obs"></label>`,
      async onSubmit(fd) {
        await chamar(sb.rpc('pagar_comissao', { p_funcionario: c.funcionario_id, p_competencia: comp + '-01', p_obs: fd.get('obs').trim() || null }));
        toast('Comissão registrada como paga'); comissoes();
      },
    });
  };
}
