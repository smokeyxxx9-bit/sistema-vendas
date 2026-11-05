import { $, esc, brl, hoje, toast, baixar } from '../ui.js';
import { ehAdmin } from '../state.js';
import { abrirVenda } from './venda_form.js';
import { imprimirNota } from './nota.js';
import { imprimirGarantia } from './garantia.js';
import { carregarVendas, vincularCliente, cancelarVenda } from './painel_vendas.js';

// Vendas da loja no mesmo estilo da tabela do sistema antigo (index.html):
// cabeçalho com setas de dia, cards de totais, grade de colunas com rolagem lateral e ícones por linha.
const dia = (iso, d) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toLocaleDateString('sv-SE'); };
const soma = (xs) => xs.reduce((s, x) => s + Number(x || 0), 0);

// [rótulo, largura] na ordem da tabela do index.html
const COLUNAS = [
  ['Nota', '88px'], ['Quantidade', '96px'], ['Medida', '160px'], ['Qtd. alinh.', '74px'], ['Alinhamento', '110px'],
  ['Qtd. bicos', '74px'], ['Valor dos bicos', '110px'], ['Qtd. cambagens', '94px'], ['Valor da cambagem', '120px'],
  ['Qtd. rodas', '74px'], ['Valor das rodas', '110px'], ['Valor das peças', '115px'], ['Serviço', '105px'],
  ['Valor dos pneus', '115px'], ['Valor', '132px'], ['Forma de pagamento', '150px'], ['Pago', '60px'], ['Vendedor', '110px'],
];
const ACOES = '150px';
const TEMPLATE = [...COLUNAS.map((c) => c[1]), ACOES].join(' ');
const LARGURA = `${COLUNAS.reduce((s, c) => s + parseInt(c[1], 10), 0) + parseInt(ACOES, 10)}px`;

export function criar() {
  let raiz, ini = hoje(), fim = hoje(), soPend = false, vend = '', ocultar = false, dados = [], emForm = false;
  const abertos = new Set();

  const carregar = async () => { dados = await carregarVendas('balcao', ini, fim); };
  const recarregar = async () => { await carregar(); pintar(); };

  async function render(root) {
    raiz = root;
    if (emForm && root.querySelector('#vf')) return;       // formulário aberto: não derruba
    emForm = false;
    await carregar(); esqueleto(); pintar();
  }
  async function aoMudar() { if (emForm) return; await carregar(); pintar(); }

  function esqueleto() {
    raiz.innerHTML = `<div class="lj">
      <div class="lj-head"><div class="lj-head-left"><div class="day-nav"><button id="lj-ant" aria-label="Dia anterior" title="Dia anterior">‹</button><button id="lj-prox" aria-label="Próximo dia" title="Próximo dia">›</button></div>
        <h2 id="lj-titulo"></h2></div><button class="lbtn primary" id="lj-nova">+ Nova venda</button></div>
      <div class="lj-toolbar">
        <label>De<input type="date" id="lj-ini" value="${ini}"></label><label>Até<input type="date" id="lj-fim" value="${fim}"></label>
        <button class="lbtn" id="lj-hoje">Hoje</button><button class="lbtn" id="lj-mes">Este mês</button>
        <label>Vendedor<select id="lj-vend"></select></label>
        <label class="lck"><input type="checkbox" id="lj-pend"> Só pendentes</label>
        <label class="lck"><input type="checkbox" id="lj-ocultar"> Ocultar totais</label>
        <button class="lbtn" id="lj-csv">CSV</button></div>
      <div class="parts-visor" id="lj-cards"></div>
      <div class="lj-scroll"><div class="lj-grid" id="lj-grid" style="min-width:${LARGURA}"></div></div>
      <div class="lj-grupos" id="lj-grupos"></div></div>`;
    const marcar = () => { $('#lj-ini').value = ini; $('#lj-fim').value = fim; recarregar(); };
    $('#lj-ini').onchange = (e) => { ini = e.target.value || ini; if (fim < ini) fim = ini; marcar(); };
    $('#lj-fim').onchange = (e) => { fim = e.target.value || fim; if (fim < ini) ini = fim; marcar(); };
    const mover = (n) => { if (ini === fim) { ini = fim = dia(ini, n); marcar(); } };
    $('#lj-ant').onclick = () => mover(-1); $('#lj-prox').onclick = () => mover(1);
    $('#lj-hoje').onclick = () => { ini = fim = hoje(); marcar(); };
    $('#lj-mes').onclick = () => { ini = hoje().slice(0, 8) + '01'; fim = hoje(); marcar(); };
    $('#lj-vend').onchange = (e) => { vend = e.target.value; pintar(); };
    $('#lj-pend').checked = soPend; $('#lj-pend').onchange = (e) => { soPend = e.target.checked; pintar(); };
    $('#lj-ocultar').checked = ocultar; $('#lj-ocultar').onchange = (e) => { ocultar = e.target.checked; pintar(); };
    $('#lj-csv').onclick = csv;
    $('#lj-nova').onclick = () => { emForm = true; abrirVenda(raiz, 'balcao', { aoSair: () => { emForm = false; render(raiz); } }).catch((e) => { emForm = false; toast(e.message, 'erro'); render(raiz); }); };
    $('#lj-grid').onclick = acao;
  }

  const filtradas = () => dados.filter((v) => (!soPend || (v.status === 'concluida' && v.status_pagamento !== 'pago')) && (!vend || v.vendedor_nome === vend));

  // card de total, igual ao pcard() do index.html
  const pcard = (rotulo, cor, direita, valor, dica = '') => `<div class="parts-card pc-${cor}"${dica ? ` title="${esc(dica)}"` : ''}><div class="pc-top"><span class="pc-label">${rotulo}</span><span class="pc-qty">${direita}</span></div><div class="pc-value">${valor}</div></div>`;

  function pintar() {
    if (!$('#lj-grid', raiz)) return;
    const vendedores = [...new Set(dados.map((v) => v.vendedor_nome).filter(Boolean))].sort();
    $('#lj-vend').innerHTML = '<option value="">Todos os vendedores</option>' + vendedores.map((n) => `<option${n === vend ? ' selected' : ''}>${esc(n)}</option>`).join('');
    const rotulo = ini === fim ? new Date(ini + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : `${new Date(ini + 'T12:00:00').toLocaleDateString('pt-BR')} a ${new Date(fim + 'T12:00:00').toLocaleDateString('pt-BR')}`;
    $('#lj-titulo').textContent = rotulo.charAt(0).toUpperCase() + rotulo.slice(1);

    const lista = filtradas(), ok = lista.filter((v) => v.status === 'concluida');
    const por = (f) => soma(ok.flatMap((v) => v.venda_pagamentos.filter((p) => p.forma === f)).map((p) => p.valor));
    const total = soma(ok.map((v) => v.total));
    const entrou = soma(ok.flatMap((v) => v.venda_pagamentos).map((p) => p.valor));
    const pendente = soma(ok.filter((v) => v.status_pagamento !== 'pago').map((v) => Number(v.total) - soma(v.venda_pagamentos.map((p) => p.valor))));
    const V = (x) => (ocultar ? '••••' : brl(x));
    const un = (f) => `${soma(ok.map((v) => v[f]))} un.`;
    $('#lj-cards').innerHTML = [
      pcard(ini === fim ? 'Valor total do dia' : 'Valor total', 'yellow', ocultar ? '' : `${ok.length} vendas`, V(total)),
      pcard('Ticket médio', 'yellow', '', V(ok.length ? total / ok.length : 0)),
      pcard('Pneus', 'teal', ocultar ? '' : `${soma(ok.flatMap((v) => v.itens_venda).map((i) => i.quantidade))} un.`, V(soma(ok.map((v) => v.subtotal_pneus)))),
      pcard('Alinhamento', 'teal', ocultar ? '' : un('alinhamento_qtd'), V(soma(ok.map((v) => v.alinhamento_valor)))),
      pcard('Bicos', 'teal', ocultar ? '' : un('bicos_qtd'), V(soma(ok.map((v) => v.bicos_valor)))),
      pcard('Cambagem', 'teal', ocultar ? '' : un('cambagem_qtd'), V(soma(ok.map((v) => v.cambagem_valor)))),
      pcard('Rodas', 'teal', ocultar ? '' : un('rodas_qtd'), V(soma(ok.map((v) => v.rodas_valor)))),
      pcard('Valor das peças', 'teal', '', V(soma(ok.map((v) => v.pecas_valor)))),
      pcard('Serviço', 'teal', '', V(soma(ok.map((v) => v.servicos_valor)))),
      pcard('💰 Total que entrou', 'green', '', V(entrou), 'Soma das formas de pagamento recebidas nas vendas do período'),
      pcard('💵 Dinheiro', 'yellow', '', V(por('dinheiro'))), pcard('📲 Pix', 'yellow', '', V(por('pix'))),
      pcard('💳 Débito', 'yellow', '', V(por('cartao_debito'))), pcard('💳 Crédito', 'yellow', '', V(por('cartao_credito'))),
      pcard('A receber', 'red', '', V(pendente)), pcard('Descontos', 'red', '', V(soma(ok.map((v) => v.desconto_total)))),
      pcard('Trocas abatidas', 'red', '', V(soma(ok.map((v) => v.troca_total)))),
    ].join('');

    const cab = `<div class="lj-row head" style="grid-template-columns:${TEMPLATE}">${COLUNAS.map((c) => `<div class="cell">${c[0]}</div>`).join('')}<div class="cell">Ações</div></div>`;
    $('#lj-grid').innerHTML = cab + (lista.length ? lista.map(linha).join('')
      : '<div class="lj-vazio"><p>Nenhuma venda neste período.</p><button class="lbtn primary" data-a="nova">+ Adicionar primeira venda</button></div>');

    const agrupar = (chave) => { const m = new Map(); for (const v of ok) { const k = chave(v) || '—'; const a = m.get(k) || [0, 0]; a[0]++; a[1] += Number(v.total); m.set(k, a); } return [...m].sort((a, b) => b[1] - a[1]); };
    const quadro = (titulo, rows) => `<div class="bloco"><h2>${titulo}</h2>${rows.length ? `<div class="rolagem"><table class="denso"><thead><tr><th></th><th class="n">Vendas</th><th class="n">Total</th></tr></thead><tbody>${rows.map(([k, [q, t]]) => `<tr><td>${esc(k)}</td><td class="n">${ocultar ? '••' : q}</td><td class="n">${V(t)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vazio">Sem vendas.</p>'}</div>`;
    $('#lj-grupos').innerHTML = `<div class="grade">${quadro('Por vendedor', agrupar((v) => v.vendedor_nome))}${quadro('Por forma de pagamento', agrupar((v) => v.forma_resumo))}</div>`;
  }

  const num = (n) => (Number(n) > 0 ? n : '<span class="nada">—</span>');
  const din = (n) => (Number(n) > 0 ? brl(n) : '<span class="nada">—</span>');
  const qtd = (v) => soma(v.itens_venda.map((i) => i.quantidade));
  const med = (v) => [...new Set(v.itens_venda.map((i) => i.produtos?.medidas?.descricao).filter(Boolean))].join(', ');
  const PAGO = { pago: ['✅', 'Pago'], pendente: ['❌', 'Pendente'], parcial: ['🟠', 'Parcialmente pago'] };

  function linha(v) {
    const cancelada = v.status === 'cancelada';
    const hora = new Date(v.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const [emoji, titulo] = cancelada ? ['🚫', 'Cancelada'] : PAGO[v.status_pagamento];
    const c = (conteudo, cls = '') => `<div class="cell ${cls}">${conteudo}</div>`;
    const notas = (Number(v.desconto_total) > 0 ? `<small class="amarelo">-${brl(v.desconto_total)} desc.</small>` : '') + (Number(v.troca_total) > 0 ? `<small class="amarelo">-${brl(v.troca_total)} troca</small>` : '');
    const nome = v.clientes?.nome;
    const aberto = abertos.has(v.id);
    const acoes = `<div class="cell rowactions">
      ${cancelada && !nome ? '' : `<button class="icon-btn cli-btn${nome ? ' has' : ''}" data-a="cli"${cancelada || v.a_prazo ? ' disabled' : ''} title="${nome ? `Cliente: ${esc(nome)}${cancelada || v.a_prazo ? '' : ' — clique para alterar'}` : 'Vincular cliente a esta venda'}">👤</button>`}
      <button class="icon-btn print-btn" data-a="nota" title="Imprimir nota">🖨</button>
      <button class="icon-btn print-btn" data-a="garantia" title="Imprimir folha de garantia">🛡️</button>
      ${ehAdmin() && !cancelada ? '<button class="icon-btn" data-a="cancelar" title="Cancelar venda">✕</button>' : ''}</div>`;
    const principal = `<div class="lj-row data${cancelada ? ' cancelada' : ''}" style="grid-template-columns:${TEMPLATE}">
      ${c(`<span class="cv"><b>#${v.numero}</b> <small>${hora}</small></span>`)}${c(`<span class="cv">${qtd(v) || '<span class="nada">—</span>'}</span>`)}${c(`<span class="cv txt" title="${esc(med(v))}">${esc(med(v)) || '<span class="nada">—</span>'}</span>`)}
      ${c(`<span class="cv">${num(v.alinhamento_qtd)}</span>`)}${c(`<span class="cv m">${din(v.alinhamento_valor)}</span>`)}
      ${c(`<span class="cv">${num(v.bicos_qtd)}</span>`)}${c(`<span class="cv m">${din(v.bicos_valor)}</span>`)}
      ${c(`<span class="cv">${num(v.cambagem_qtd)}</span>`)}${c(`<span class="cv m">${din(v.cambagem_valor)}</span>`)}
      ${c(`<span class="cv">${num(v.rodas_qtd)}</span>`)}${c(`<span class="cv m">${din(v.rodas_valor)}</span>`)}
      ${c(`<span class="cv m">${din(v.pecas_valor)}</span>`)}${c(`<span class="cv m">${din(v.servicos_valor)}</span>`)}
      ${c(`<span class="cv m">${din(v.subtotal_pneus)}</span>`)}
      ${c(`<div class="valor"><span class="cv m total">${brl(v.total)}</span>${notas}</div>`)}
      ${c(`<span class="cv txt" title="${esc(v.forma_resumo || '')}">${esc(v.forma_resumo || '')}</span>`)}
      ${c(`<span class="cv" title="${titulo}">${emoji}</span>`)}${c(`<span class="cv txt">${esc(v.vendedor_nome || '')}</span>`)}${acoes}</div>`;
    const toggle = `<div class="lj-row" style="grid-template-columns:1fr"><button class="detail-toggle${aberto ? ' open' : ''}" data-a="detalhe"><span class="car">▸</span> detalhes da venda${v.editada_em ? ' · editada' : ''}</button></div>`;
    const descontos = (Array.isArray(v.descontos) ? v.descontos : []).map((d) => `${esc(d.origem)}: -${brl(d.valor)}`).join(' · ');
    const detalhe = aberto ? `<div class="lj-row" style="grid-template-columns:1fr"><div class="detail-box">
      <p><b>Cliente:</b> ${esc(nome || 'Balcão (sem cliente)')} · <b>Status:</b> ${esc(titulo)}${v.a_prazo ? ' · a prazo' : ''}</p>
      ${descontos ? `<p><b>Descontos:</b> ${descontos}</p>` : ''}${Number(v.troca_total) > 0 ? `<p><b>Base de troca abatida:</b> ${brl(v.troca_total)}</p>` : ''}
      <p><b>Observações:</b> ${esc(v.observacoes || '—')}</p>${v.editada_em ? `<p><b>Editada</b> em ${new Date(v.editada_em).toLocaleString('pt-BR')}${v.editada_por ? ' por ' + esc(v.editada_por) : ''}</p>` : ''}</div></div>` : '';
    return `<div class="row-group" data-id="${v.id}" data-n="${v.numero}"${cancelada ? ' style="opacity:.55"' : ''}>${principal}${toggle}${detalhe}</div>`;
  }

  async function acao(e) {
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    if (b.dataset.a === 'nova') return $('#lj-nova').click();
    const g = b.closest('.row-group'), id = g.dataset.id, n = g.dataset.n, v = dados.find((x) => x.id === id);
    try {
      if (b.dataset.a === 'nota') await imprimirNota(id);          // a janela abre antes de qualquer espera
      if (b.dataset.a === 'garantia') imprimirGarantia(id);
      if (b.dataset.a === 'cli') await vincularCliente(v, recarregar);
      if (b.dataset.a === 'cancelar') cancelarVenda(id, n, recarregar);
      if (b.dataset.a === 'detalhe') { abertos.has(id) ? abertos.delete(id) : abertos.add(id); pintar(); }
    } catch (err) { toast(err.message, 'erro'); }
  }

  function csv() {
    const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const cab = ['Nota', 'Data', 'Cliente', 'Vendedor', 'Qtd pneus', 'Medida', 'Pneus', 'Alinh qtd', 'Alinh valor', 'Bicos qtd', 'Bicos valor', 'Cambagem qtd', 'Cambagem valor', 'Rodas qtd', 'Rodas valor', 'Peças', 'Serviço', 'Desconto', 'Troca', 'Total', 'Forma', 'Status'];
    const rows = filtradas().map((v) => [v.numero, new Date(v.criado_em).toLocaleString('pt-BR'), v.clientes?.nome || 'Balcão', v.vendedor_nome, qtd(v), med(v), v.subtotal_pneus, v.alinhamento_qtd, v.alinhamento_valor, v.bicos_qtd, v.bicos_valor,
      v.cambagem_qtd, v.cambagem_valor, v.rodas_qtd, v.rodas_valor, v.pecas_valor, v.servicos_valor, v.desconto_total, v.troca_total, v.total, v.forma_resumo, v.status === 'cancelada' ? 'Cancelada' : PAGO[v.status_pagamento][1]]);
    baixar(`vendas-loja-${ini}-a-${fim}.csv`, '\ufeff' + [cab, ...rows].map((r) => r.map(q).join(';')).join('\n'), 'text/csv;charset=utf-8');
  }

  return { render, aoMudar };
}
