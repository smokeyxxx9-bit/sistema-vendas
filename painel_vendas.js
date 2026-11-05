import { sb, chamar } from '../supabase.js';
import { ehAdmin, state } from '../state.js';
import { $, esc, brl, hoje, toast, abrirForm, abrirModal, baixar, ICONES } from '../ui.js';
import { abrirVenda, escolherCliente } from './venda_form.js';
import { imprimirNota } from './nota.js';
import { imprimirGarantia } from './garantia.js';

const dia = (iso, d) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toLocaleDateString('sv-SE'); };
const soma = (xs) => xs.reduce((s, x) => s + Number(x || 0), 0);
const ROT_STATUS = { pago: 'Pago', pendente: 'Pendente', parcial: 'Parcial' };

const COLUNAS = `id, numero, criado_em, total, status, status_pagamento, a_prazo, forma_resumo, vendedor_nome, vendedor_id, observacoes, descontos,
  subtotal_pneus, alinhamento_qtd, alinhamento_valor, bicos_qtd, bicos_valor, cambagem_qtd, cambagem_valor, rodas_qtd, rodas_valor,
  pecas_valor, servicos_valor, desconto_total, troca_total, clientes(nome), itens_venda(quantidade, produtos(medidas(descricao))), venda_pagamentos(forma, valor)`;

// Vendas do período (compartilhada pelo painel do atacado e pela tabela da loja).
// editada_em/editada_por vêm do 006_editar_venda.sql; se ele ainda não foi rodado, busca sem esses campos.
export async function carregarVendas(tipo, ini, fim) {
  const a = new Date(ini + 'T00:00:00').toISOString(), b = new Date(fim + 'T23:59:59.999').toISOString();
  const consulta = (cols) => sb.from('vendas').select(cols).eq('tipo', tipo).gte('criado_em', a).lte('criado_em', b).order('criado_em', { ascending: false }).limit(1000);
  try { return await chamar(consulta(COLUNAS + ', editada_em, editada_por')); }
  catch (e) { if (!/editada_/.test(e.message)) throw e; return chamar(consulta(COLUNAS)); }
}

// Venda de atacado já gravada pode ser editada se ainda não recebeu nada (o banco confere de novo).
export const vendaEditavel = (v) => v.status !== 'cancelada' && (!v.a_prazo || v.status_pagamento === 'pendente');
export const podeEditarVenda = (v) => ehAdmin() || v.vendedor_id === state.perfil?.id;

// Vincular/trocar/remover o cliente de uma venda (usado pelos dois painéis).
export async function vincularCliente(v, depois) {
  const trocar = async () => {
    const c = await escolherCliente({ titulo: 'Vincular cliente à venda', texto: 'Escolha quem comprou. Isso fica salvo mesmo sem imprimir nota.' });
    if (!c) return;
    await chamar(sb.rpc('vincular_cliente', { p_venda: v.id, p_cliente: c.id }));
    toast('Cliente vinculado'); await depois();
  };
  if (!v.clientes) return trocar();
  const m = abrirModal({ titulo: 'Cliente vinculado a esta venda', corpo: `<p><strong>${esc(v.clientes.nome)}</strong></p>
    <div class="dlg-acoes" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn" id="vc-f">Fechar</button><button class="btn perigo" id="vc-r">Remover vínculo</button><button class="btn primario" id="vc-t">Trocar cliente</button></div>` });
  $('#vc-f', m.dlg).onclick = m.fechar;
  $('#vc-r', m.dlg).onclick = async () => { m.fechar(); try { await chamar(sb.rpc('vincular_cliente', { p_venda: v.id, p_cliente: null })); toast('Vínculo removido'); await depois(); } catch (err) { toast(err.message, 'erro'); } };
  $('#vc-t', m.dlg).onclick = () => { m.dlg.addEventListener('close', () => trocar().catch((err) => toast(err.message, 'erro')), { once: true }); m.fechar(); };
}

export function cancelarVenda(id, n, depois) {
  abrirForm({ titulo: `Cancelar venda #${n}`, ok: 'Cancelar venda', perigo: true,
    corpo: '<p>Os pneus voltam ao estoque. Vendas com recebimentos registrados não podem ser canceladas.</p><label>Motivo<input name="motivo" required></label>',
    async onSubmit(fd) { await chamar(sb.rpc('cancelar_venda', { p_venda: id, p_motivo: fd.get('motivo').trim() })); toast('Venda cancelada'); await depois(); } });
}

// Cria um painel de vendas independente: 'balcao' (loja) ou 'atacado'.
export function criar(tipo) {
  const loja = tipo === 'balcao';
  let raiz, ini = hoje(), fim = hoje(), soPend = false, vend = '', ocultar = false, dados = [], emForm = false;

  async function carregar() { dados = await carregarVendas(tipo, ini, fim); }

  async function render(root) {
    raiz = root;
    if (emForm && root.querySelector('#vf')) return;       // formulário aberto: não derruba
    emForm = false;
    await carregar(); esqueleto(); pintar();
  }
  async function aoMudar() { if (emForm) return; await carregar(); pintar(); }

  function esqueleto() {
    raiz.innerHTML = `
      <div class="dia-nav"><button class="btn mini" id="pv-ant" aria-label="Dia anterior">‹</button><button class="btn mini" id="pv-prox" aria-label="Próximo dia">›</button><h2 id="pv-titulo"></h2>
        <span style="flex:1"></span><button class="btn primario" id="pv-nova">+ Nova venda</button></div>
      <div class="barra-ferramentas">
        <label>De<input type="date" id="pv-ini" value="${ini}"></label><label>Até<input type="date" id="pv-fim" value="${fim}"></label>
        <button class="btn" id="pv-hoje">Hoje</button><button class="btn" id="pv-mes">Este mês</button>
        <label>Vendedor<select id="pv-vend"></select></label>
        <label class="check"><input type="checkbox" id="pv-pend"> Só pendentes</label>
        <label class="check"><input type="checkbox" id="pv-ocultar"> Ocultar totais</label>
        <button class="btn" id="pv-csv">CSV</button></div>
      <div id="pv-res"></div>`;
    const recarregar = async () => { await carregar(); pintar(); };
    $('#pv-ini').onchange = (e) => { ini = e.target.value || ini; if (fim < ini) fim = ini; $('#pv-fim').value = fim; recarregar(); };
    $('#pv-fim').onchange = (e) => { fim = e.target.value || fim; if (fim < ini) ini = fim; $('#pv-ini').value = ini; recarregar(); };
    const mover = (n) => { if (ini === fim) { ini = fim = dia(ini, n); $('#pv-ini').value = ini; $('#pv-fim').value = fim; recarregar(); } };
    $('#pv-ant').onclick = () => mover(-1); $('#pv-prox').onclick = () => mover(1);
    $('#pv-hoje').onclick = () => { ini = fim = hoje(); $('#pv-ini').value = ini; $('#pv-fim').value = fim; recarregar(); };
    $('#pv-mes').onclick = () => { ini = hoje().slice(0, 8) + '01'; fim = hoje(); $('#pv-ini').value = ini; $('#pv-fim').value = fim; recarregar(); };
    $('#pv-vend').onchange = (e) => { vend = e.target.value; pintar(); };
    $('#pv-pend').checked = soPend; $('#pv-pend').onchange = (e) => { soPend = e.target.checked; pintar(); };
    $('#pv-ocultar').checked = ocultar; $('#pv-ocultar').onchange = (e) => { ocultar = e.target.checked; pintar(); };
    $('#pv-csv').onclick = csv;
    $('#pv-nova').onclick = () => { emForm = true; abrirVenda(raiz, tipo, { aoSair: () => { emForm = false; render(raiz); } }).catch((e) => { emForm = false; toast(e.message, 'erro'); render(raiz); }); };
    $('#pv-res').onclick = acao;
  }

  const filtradas = () => dados.filter((v) => (!soPend || (v.status === 'concluida' && v.status_pagamento !== 'pago')) && (!vend || v.vendedor_nome === vend));

  function pintar() {
    if (!$('#pv-res', raiz)) return;
    const vendedores = [...new Set(dados.map((v) => v.vendedor_nome).filter(Boolean))].sort();
    $('#pv-vend').innerHTML = '<option value="">Todos os vendedores</option>' + vendedores.map((n) => `<option${n === vend ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const rotulo = ini === fim ? new Date(ini + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : `${new Date(ini + 'T12:00:00').toLocaleDateString('pt-BR')} a ${new Date(fim + 'T12:00:00').toLocaleDateString('pt-BR')}`;
    $('#pv-titulo').textContent = rotulo.charAt(0).toUpperCase() + rotulo.slice(1);

    const lista = filtradas(), ok = lista.filter((v) => v.status === 'concluida');
    const por = (f) => soma(ok.flatMap((v) => v.venda_pagamentos.filter((p) => p.forma === f)).map((p) => p.valor));
    const pneusQtd = soma(ok.flatMap((v) => v.itens_venda).map((i) => i.quantidade));
    const total = soma(ok.map((v) => v.total));
    const pendente = soma(ok.filter((v) => v.status_pagamento !== 'pago').map((v) => Number(v.total) - soma(v.venda_pagamentos.map((p) => p.valor))));
    const V = (x) => (ocultar ? '••••' : brl(x));
    const card = (r, val, cor = '', sub = '') => `<div class="card ${cor}"><span>${r}<em style="font-style:normal">${sub}</em></span><b>${val}</b></div>`;
    const cartoes = loja ? [
      card('Total vendido', V(total)), card('Vendas', ocultar ? '••' : ok.length, 'k-ciano'), card('Ticket médio', V(ok.length ? total / ok.length : 0)),
      card('Pneus', V(soma(ok.map((v) => v.subtotal_pneus))), 'k-ciano', ocultar ? '' : pneusQtd + ' un.'),
      card('Alinhamento', V(soma(ok.map((v) => v.alinhamento_valor))), 'k-ciano', ocultar ? '' : soma(ok.map((v) => v.alinhamento_qtd)) + ' un.'),
      card('Bicos', V(soma(ok.map((v) => v.bicos_valor))), 'k-ciano', ocultar ? '' : soma(ok.map((v) => v.bicos_qtd)) + ' un.'),
      card('Cambagem', V(soma(ok.map((v) => v.cambagem_valor))), 'k-ciano', ocultar ? '' : soma(ok.map((v) => v.cambagem_qtd)) + ' un.'),
      card('Rodas', V(soma(ok.map((v) => v.rodas_valor))), 'k-ciano', ocultar ? '' : soma(ok.map((v) => v.rodas_qtd)) + ' un.'),
      card('Valor das peças', V(soma(ok.map((v) => v.pecas_valor))), 'k-verde'), card('Serviço', V(soma(ok.map((v) => v.servicos_valor))), 'k-verde'),
      card('Dinheiro', V(por('dinheiro'))), card('PIX', V(por('pix'))), card('Débito', V(por('cartao_debito'))), card('Crédito', V(por('cartao_credito'))),
      card('A receber', V(pendente), 'k-alerta'), card('Descontos', V(soma(ok.map((v) => v.desconto_total))), 'k-alerta'), card('Trocas abatidas', V(soma(ok.map((v) => v.troca_total))), 'k-alerta'),
    ] : [
      card('Total vendido', V(total)), card('Vendas', ocultar ? '••' : ok.length, 'k-ciano'), card('Ticket médio', V(ok.length ? total / ok.length : 0)),
      card('Pneus', V(soma(ok.map((v) => v.subtotal_pneus))), 'k-ciano', ocultar ? '' : pneusQtd + ' un.'),
      card('Dinheiro', V(por('dinheiro'))), card('PIX', V(por('pix'))), card('Débito', V(por('cartao_debito'))), card('Crédito', V(por('cartao_credito'))),
      card('A receber / boletos', V(pendente), 'k-alerta'), card('Descontos', V(soma(ok.map((v) => v.desconto_total))), 'k-alerta'), card('Trocas abatidas', V(soma(ok.map((v) => v.troca_total))), 'k-alerta'),
    ];

    const agrupar = (chave) => { const m = new Map(); for (const v of ok) { const k = chave(v) || '—'; const a = m.get(k) || [0, 0]; a[0]++; a[1] += Number(v.total); m.set(k, a); } return [...m].sort((a, b) => b[1] - a[1]); };
    const quadro = (titulo, rows) => `<div class="bloco"><h2>${titulo}</h2>${rows.length ? `<div class="rolagem"><table class="denso"><thead><tr><th></th><th class="n">Vendas</th><th class="n">Total</th></tr></thead><tbody>${rows.map(([k, [q, t]]) => `<tr><td>${esc(k)}</td><td class="n">${ocultar ? '••' : q}</td><td class="n">${V(t)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vazio">Sem vendas.</p>'}</div>`;

    const med = (v) => [...new Set(v.itens_venda.map((i) => i.produtos?.medidas?.descricao).filter(Boolean))].join(', ');
    const qtd = (v) => soma(v.itens_venda.map((i) => i.quantidade));
    const par = (q, val) => (Number(val) > 0 || q > 0 ? `${q} · ${brl(val)}` : '—');
    const cab = loja ? ['Nota', 'Hora', 'Cliente', 'Qtd.', 'Medida', 'Alinh.', 'Bicos', 'Cambagem', 'Rodas', 'Peças', 'Serviço', 'Pneus', 'Total', 'Forma', 'Status', 'Vendedor', '']
                     : ['Nota', 'Hora', 'Cliente', 'Qtd.', 'Medida', 'Pneus', 'Desc.', 'Total', 'Forma', 'Status', 'Vendedor', ''];
    const linha = (v) => {
      const cancelada = v.status === 'cancelada';
      const hora = new Date(v.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const st = cancelada ? '<span class="chip cancelada">Cancelada</span>' : `<span class="chip ${v.status_pagamento}">${ROT_STATUS[v.status_pagamento]}</span>`;
      const acoes = `<td class="acoes"><button class="btn icone" data-a="nota" title="Imprimir nota" aria-label="Imprimir nota">${ICONES.nota}</button>
        <button class="btn icone" data-a="garantia" title="Imprimir folha de garantia" aria-label="Imprimir folha de garantia">${ICONES.garantia}</button>
        ${!cancelada && !v.a_prazo ? `<button class="btn icone" data-a="cli" title="Cliente da venda" aria-label="Cliente da venda">${ICONES.cliente}</button>` : ''}
        ${!loja && !cancelada && podeEditarVenda(v) ? `<button class="btn icone" data-a="editar"${vendaEditavel(v) ? '' : ' disabled'} title="${vendaEditavel(v) ? 'Editar venda' : 'Venda com recebimento registrado não pode ser editada'}" aria-label="Editar venda">${ICONES.editar}</button>` : ''}
        ${ehAdmin() && !cancelada ? '<button class="btn mini" data-a="cancelar">Cancelar</button>' : ''}</td>`;
      const base = `<td>#${v.numero}</td><td>${hora}</td><td>${esc(v.clientes?.nome || 'Balcão')}</td><td class="m">${qtd(v)}</td><td>${esc(med(v))}</td>`;
      return `<tr data-id="${v.id}" data-n="${v.numero}"${cancelada ? ' style="opacity:.55"' : ''}>${base}${loja
        ? `<td class="m">${par(v.alinhamento_qtd, v.alinhamento_valor)}</td><td class="m">${par(v.bicos_qtd, v.bicos_valor)}</td><td class="m">${par(v.cambagem_qtd, v.cambagem_valor)}</td><td class="m">${par(v.rodas_qtd, v.rodas_valor)}</td><td class="m">${brl(v.pecas_valor)}</td><td class="m">${brl(v.servicos_valor)}</td><td class="m">${brl(v.subtotal_pneus)}</td>`
        : `<td class="m">${brl(v.subtotal_pneus)}</td><td class="m">${brl(v.desconto_total)}</td>`}
        <td class="m"><strong>${brl(v.total)}</strong></td><td>${esc(v.forma_resumo || '')}</td><td>${st}</td><td>${esc(v.vendedor_nome || '')}</td>${acoes}</tr>`;
    };

    $('#pv-res').innerHTML = `<div class="cards-dia">${cartoes.join('')}</div>
      <div class="bloco"><div class="rolagem">${lista.length ? `<table class="denso"><thead><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${lista.map(linha).join('')}</tbody></table>`
        : '<p class="vazio">Nenhuma venda neste período.</p>'}</div></div>
      <div class="grade">${quadro('Por vendedor', agrupar((v) => v.vendedor_nome))}${loja ? '' : quadro('Por cliente', agrupar((v) => v.clientes?.nome))}${quadro('Por forma de pagamento', agrupar((v) => v.forma_resumo))}</div>`;
  }

  async function acao(e) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const tr = b.closest('tr'), id = tr.dataset.id, n = tr.dataset.n, v = dados.find((x) => x.id === id);
    try {
      if (b.dataset.a === 'nota') await imprimirNota(id);          // a janela abre antes de qualquer espera
      if (b.dataset.a === 'garantia') imprimirGarantia(id);
      if (b.dataset.a === 'editar') editar(id);
      if (b.dataset.a === 'cli') await vincularCliente(v, recarregarPintar);
      if (b.dataset.a === 'cancelar') cancelarVenda(id, n, recarregarPintar);
    } catch (err) { toast(err.message, 'erro'); }
  }

  const recarregarPintar = async () => { await carregar(); pintar(); };

  function editar(id) {
    emForm = true;
    abrirVenda(raiz, tipo, { editar: id, aoSair: () => { emForm = false; render(raiz); } }).catch((e) => { emForm = false; toast(e.message, 'erro'); render(raiz); });
  }

  function csv() {
    const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const cab = ['Nota', 'Data', 'Cliente', 'Vendedor', 'Qtd pneus', 'Medida', 'Pneus', 'Alinh qtd', 'Alinh valor', 'Bicos qtd', 'Bicos valor', 'Cambagem qtd', 'Cambagem valor', 'Rodas qtd', 'Rodas valor', 'Peças', 'Serviço', 'Desconto', 'Troca', 'Total', 'Forma', 'Status'];
    const rows = filtradas().map((v) => [v.numero, new Date(v.criado_em).toLocaleString('pt-BR'), v.clientes?.nome || 'Balcão', v.vendedor_nome, soma(v.itens_venda.map((i) => i.quantidade)),
      [...new Set(v.itens_venda.map((i) => i.produtos?.medidas?.descricao))].join(' / '), v.subtotal_pneus, v.alinhamento_qtd, v.alinhamento_valor, v.bicos_qtd, v.bicos_valor, v.cambagem_qtd, v.cambagem_valor,
      v.rodas_qtd, v.rodas_valor, v.pecas_valor, v.servicos_valor, v.desconto_total, v.troca_total, v.total, v.forma_resumo, v.status === 'cancelada' ? 'Cancelada' : ROT_STATUS[v.status_pagamento]]);
    baixar(`vendas-${tipo}-${ini}-a-${fim}.csv`, '\ufeff' + [cab, ...rows].map((r) => r.map(q).join(';')).join('\n'), 'text/csv;charset=utf-8');
  }

  return { render, aoMudar };
}
