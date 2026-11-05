import { sb, chamar } from '../supabase.js';
import { state } from '../state.js';
import { $, esc, brl, num, fmtNum, dataBR, FORMAS, opcoes, toast, abrirForm, debounce } from '../ui.js';

let contas = [], boletos = [], soVencidas = false, busca = '', raiz;

export async function render(root) {
  raiz = root;
  contas = await chamar(sb.from('v_contas').select('*').in('status', ['aberta', 'parcial']).order('vencimento'));
  boletos = await chamar(sb.from('venda_boletos').select('id, parcela, vencimento, valor, conta_id, vendas(numero, clientes(nome))').eq('status', 'pendente').order('vencimento'));
  if (!$('#lista-fiado', root)) {
    root.innerHTML = `<div class="barra-ferramentas"><label>Buscar cliente<input id="f-busca" type="search" value="${esc(busca)}"></label>
      <label class="check"><input type="checkbox" id="f-venc" ${soVencidas ? 'checked' : ''}> Só vencidas (inadimplentes)</label></div><div id="lista-fiado"></div><div id="lista-boletos"></div>`;
    $('#f-busca').oninput = debounce((e) => { busca = e.target.value; lista(); }, 150);
    $('#f-venc').onchange = (e) => { soVencidas = e.target.checked; lista(); };
  }
  lista();
}
export const aoMudar = render;

function lista() {
  const q = busca.toLowerCase();
  const l = contas.filter((c) => (!soVencidas || c.vencida) && (!q || c.cliente_nome.toLowerCase().includes(q)));
  const total = l.reduce((s, c) => s + Number(c.saldo), 0), comBoleto = new Set(boletos.map((b) => b.conta_id));
  $('#lista-fiado').innerHTML = l.length ? `<div class="bloco"><div class="rolagem"><table><thead><tr><th>Cliente</th><th>Venda</th><th>Vencimento</th><th class="n">Total</th><th class="n">Pago</th><th class="n">Saldo</th><th></th></tr></thead><tbody>
    ${l.map((c) => `<tr><td>${esc(c.cliente_nome)}</td><td>#${c.venda_numero}</td><td>${dataBR(c.vencimento)} ${c.vencida ? '<span class="chip atraso">Em atraso</span>' : ''}</td>
      <td class="n">${brl(c.valor_total)}</td><td class="n">${brl(c.valor_pago)}</td><td class="n"><strong>${brl(c.saldo)}</strong></td>
      <td class="acoes">${comBoleto.has(c.id) ? '<span class="chip">Boletos abaixo</span>' : `<button class="btn mini primario" data-conta="${c.id}">Receber</button>`}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="5">Total a receber</td><td class="n">${brl(total)}</td><td></td></tr></tfoot></table></div></div>`
    : '<p class="vazio">Nenhuma conta em aberto.</p>';
  $('#lista-fiado').querySelectorAll('[data-conta]').forEach((b) => (b.onclick = () => receber(contas.find((c) => c.id === b.dataset.conta))));
  pintarBoletos();
}

// Também usada pelo extrato do cliente.
export function receber(c) {
  const chave = crypto.randomUUID();     // mesma chave se o botão for tocado duas vezes: o banco ignora a repetição
  abrirForm({
    titulo: `Receber de ${c.cliente_nome} — venda #${c.venda_numero}`, ok: 'Registrar pagamento',
    corpo: `<p>Saldo em aberto: <strong>${brl(c.saldo)}</strong></p>
      <label>Valor recebido (R$)<input name="valor" inputmode="decimal" required value="${fmtNum(c.saldo)}"></label>
      <label>Forma de pagamento<select name="forma">${opcoes(FORMAS)}</select></label>
      <label>Observação<input name="obs"></label>`,
    async onSubmit(fd) {
      const valor = num(fd.get('valor'));
      if (!(valor > 0)) throw new Error('Informe um valor válido.');
      await chamar(sb.rpc('registrar_pagamento', { p_conta: c.id, p_valor: valor, p_forma: fd.get('forma'), p_chave: chave, p_obs: fd.get('obs') || null }));
      toast('Pagamento registrado'); state.recarregar?.();
    },
  });
}

function pintarBoletos() {
  const hojeISO = new Date().toLocaleDateString('sv-SE');
  $('#lista-boletos').innerHTML = boletos.length ? `<div class="bloco"><h2>Boletos a receber</h2><div class="rolagem"><table><thead><tr><th>Cliente</th><th>Venda</th><th>Parcela</th><th>Vencimento</th><th class="n">Valor</th><th></th></tr></thead><tbody>
    ${boletos.map((b) => `<tr><td>${esc(b.vendas?.clientes?.nome || '—')}</td><td>#${b.vendas?.numero}</td><td>${b.parcela}</td>
      <td>${dataBR(b.vencimento)} ${b.vencimento < hojeISO ? '<span class="chip atraso">Vencido</span>' : ''}</td><td class="n">${brl(b.valor)}</td>
      <td class="acoes"><button class="btn mini primario" data-bol="${b.id}">Dar baixa</button></td></tr>`).join('')}</tbody></table></div></div>` : '';
  $('#lista-boletos').querySelectorAll('[data-bol]').forEach((x) => (x.onclick = () => baixarBoleto(boletos.find((b) => b.id === x.dataset.bol))));
}

function baixarBoleto(b) {
  const chave = crypto.randomUUID();
  abrirForm({
    titulo: `Baixar boleto ${b.parcela} — venda #${b.vendas?.numero}`, ok: 'Confirmar pagamento',
    corpo: `<p>${esc(b.vendas?.clientes?.nome || '')} · vencimento ${dataBR(b.vencimento)} · <strong>${brl(b.valor)}</strong></p>
      <label>Recebido por<select name="forma">${opcoes(FORMAS, 'boleto')}</select></label>`,
    async onSubmit(fd) {
      await chamar(sb.rpc('baixar_boleto', { p_boleto: b.id, p_forma: fd.get('forma'), p_chave: chave }));
      toast('Boleto baixado'); state.recarregar?.();
    },
  });
}
