import { sb, chamar } from '../supabase.js';
import { $, esc, brl, num, fmtNum, hoje, toast, abrirModal, abrirForm, confirmar, ICONES, FORMAS_VENDA } from '../ui.js';
import { imprimirNota, abrirJanelaNota, carregarVenda } from './nota.js';

const ESTADOS = ['Bom', 'Regular', 'Ruim', 'Sucata'];
const ORIGENS = [['pneus', 'Valor dos pneus'], ['alinhamento', 'Alinhamento'], ['bicos', 'Bicos'], ['cambagem', 'Cambagem'], ['rodas', 'Rodas'], ['pecas', 'Valor das peças'], ['servicos', 'Serviço']];
const MODOS = [['dinheiro', 'Dinheiro'], ['pix', 'PIX'], ['cartao_debito', 'Débito'], ['cartao_credito', 'Crédito'], ['multiplo', 'Múltiplo (até 4 formas)'], ['boleto', 'Boletos a prazo']];
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const money = (v) => { const n = typeof v === 'number' ? v : num(v); return Number.isFinite(n) && n > 0 ? r2(n) : 0; };
const inteiro = (v) => Math.max(0, parseInt(v, 10) || 0);
const somaDias = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toLocaleDateString('sv-SE'); };
const difDias = (iso) => Math.round((new Date(iso + 'T12:00:00') - new Date(hoje() + 'T12:00:00')) / 864e5);
const optSel = (lista, sel) => lista.map(([v, t]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');
const parcelasOpts = (sel) => Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${i + 1 === Number(sel) ? ' selected' : ''}>${i + 1}x</option>`).join('');
let S;

/* ---------------- seletor de cliente (também usado pelo painel) ---------------- */
export function escolherCliente({ titulo = 'Selecionar cliente', texto = 'Escolha quem comprou. Se ainda não estiver cadastrado, use o botão abaixo.' } = {}) {
  return new Promise(async (resolve) => {
    let clientes;
    try { clientes = await chamar(sb.from('clientes').select('id, nome, telefone, cpf_cnpj, tipo').eq('ativo', true).order('nome')); }
    catch (e) { toast(e.message, 'erro'); return resolve(null); }
    let resultado = null;
    const m = abrirModal({ titulo, largura: 'min(560px, calc(100vw - 1.5rem))', corpo: `<p>${esc(texto)}</p>
      <input id="pq" type="search" placeholder="Buscar por nome, CPF ou telefone…" autocomplete="off"><div class="lista-sel" id="pl"></div>
      <div class="dlg-acoes"><button class="btn" id="pc" type="button">Cancelar</button><button class="btn primario" id="pn" type="button">+ Cadastrar cliente</button></div>` });
    const pintar = () => {
      const q = $('#pq', m.dlg).value.toLowerCase();
      const l = clientes.filter((c) => !q || `${c.nome} ${c.cpf_cnpj || ''} ${c.telefone || ''}`.toLowerCase().includes(q)).slice(0, 80);
      $('#pl', m.dlg).innerHTML = l.length ? l.map((c) => `<button type="button" class="item-sel" data-id="${c.id}"><strong>${esc(c.nome)}</strong>
        <small>${[c.cpf_cnpj && 'CPF/CNPJ: ' + c.cpf_cnpj, c.telefone].filter(Boolean).map(esc).join(' · ')}</small></button>`).join('') : '<p class="vazio">Nenhum cliente encontrado.</p>';
    };
    pintar();
    $('#pq', m.dlg).oninput = pintar; $('#pq', m.dlg).focus();
    $('#pl', m.dlg).onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) { resultado = clientes.find((c) => c.id === b.dataset.id); m.fechar(); } };
    $('#pc', m.dlg).onclick = m.fechar;
    $('#pn', m.dlg).onclick = () => { resultado = 'NOVO'; m.fechar(); };
    m.dlg.addEventListener('close', async () => resolve(resultado === 'NOVO' ? await cadastrarRapido() : resultado), { once: true });
  });
}

function cadastrarRapido() {
  return new Promise((resolve) => {
    let novo = null;
    abrirForm({
      titulo: 'Cadastrar cliente',
      corpo: '<label>Nome<input name="nome" required></label><label>Telefone<input name="telefone" inputmode="tel"></label><label>CPF/CNPJ<input name="cpf_cnpj"></label>',
      async onSubmit(fd) {
        novo = await chamar(sb.from('clientes').insert({ nome: fd.get('nome').trim(), telefone: fd.get('telefone').trim() || null, cpf_cnpj: fd.get('cpf_cnpj').trim() || null })
          .select('id, nome, telefone, cpf_cnpj, tipo').single());
        toast('Cliente cadastrado');
      },
    });
    $('#dlg').addEventListener('close', () => resolve(novo), { once: true });
  });
}

/* ---------------- tela de nova venda / edição de venda ---------------- */
// abrirVenda(root, tipo, { aoSair })               -> venda nova
// abrirVenda(root, tipo, { aoSair, editar: id })   -> edita a venda já gravada (mesmo número de nota)
export async function abrirVenda(root, tipo, { aoSair, editar = null }) {
  root.innerHTML = '<p class="carregando">Carregando…</p>';
  const v = editar ? await carregarVenda(editar) : null;
  if (v && v.status === 'cancelada') throw new Error('Esta venda está cancelada e não pode ser editada.');
  const ids = v ? [...new Set(v.itens_venda.map((i) => i.produto_id))] : [];
  let q = sb.from('produtos').select('id, nome, quantidade, preco_venda, medidas(descricao), marcas(nome)').eq('ativo', true);
  q = ids.length ? q.or(`quantidade.gt.0,id.in.(${ids.join(',')})`) : q.gt('quantidade', 0);
  const produtos = await chamar(q);
  S = { tipo, loja: tipo === 'balcao', produtos, cliente: null, precos: {}, linhas: [], ex: {}, descontos: [], trocas: [], modo: 'dinheiro', parcelas: 1,
    multi: [{ forma: 'dinheiro', valor: '', parcelas: 1 }], boletos: [], entrada: { forma: 'dinheiro', valor: '' }, status: 'pago', statusManual: false, valorPago: '', obs: '', chave: crypto.randomUUID(), aoSair,
    editId: editar, editNumero: v?.numero ?? null, snap: '' };
  if (v) await preencherDaVenda(v);
  desenhar(root);
  if (v) S.snap = foto();
}

// estado do formulário em texto: serve para saber se algo mudou antes de sair da edição
const foto = () => JSON.stringify([S.cliente?.id, S.linhas, S.ex, S.descontos, S.trocas, S.modo, S.parcelas, S.multi, S.boletos, S.entrada, S.status, S.valorPago, S.obs]);

async function preencherDaVenda(v) {
  // o estoque da própria venda volta na gravação: já conta como disponível aqui
  for (const i of v.itens_venda) {
    const p = S.produtos.find((x) => x.id === i.produto_id);
    if (!p) throw new Error('Um dos pneus desta venda está desativado no estoque. Reative-o em Estoque para poder editar a venda.');
    p.quantidade += i.quantidade;
  }
  if (v.cliente_id) {
    S.cliente = { id: v.cliente_id, ...(v.clientes || {}) };
    try { (await chamar(sb.from('precos_cliente').select('produto_id, preco').eq('cliente_id', v.cliente_id))).forEach((x) => (S.precos[x.produto_id] = Number(x.preco))); } catch { /* sem preços personalizados */ }
  }
  S.obs = v.observacoes || '';
  S.linhas = v.itens_venda.map((i) => ({ produto_id: i.produto_id, qtd: i.quantidade, preco: Number(i.preco_unitario), manual: true }));   // mantém o preço vendido
  for (const k of ['alinhamento', 'bicos', 'cambagem', 'rodas']) {
    S.ex[k + '_qtd'] = Number(v[k + '_qtd']) > 0 ? String(v[k + '_qtd']) : '';
    S.ex[k + '_valor'] = Number(v[k + '_valor']) > 0 ? fmtNum(v[k + '_valor']) : '';
  }
  S.ex.pecas_valor = Number(v.pecas_valor) > 0 ? fmtNum(v.pecas_valor) : '';
  S.ex.servicos_valor = Number(v.servicos_valor) > 0 ? fmtNum(v.servicos_valor) : '';
  S.descontos = (Array.isArray(v.descontos) ? v.descontos : []).map((d) => ({ origem: d.origem, tipo: d.tipo, entrada: Number(d.entrada) }));
  S.trocas = (v.trocas || []).map((t) => ({ medida: t.medida || '', descricao: t.descricao || '', estado: t.estado || 'Bom', valor: Number(t.valor), abatido: t.abatido, obs: t.observacoes || '' }));

  const pags = v.venda_pagamentos || [], bols = [...(v.venda_boletos || [])].filter((b) => b.status !== 'cancelado').sort((a, b) => a.parcela - b.parcela);
  if (bols.length) {
    S.modo = 'boleto';
    if (pags.length) S.entrada = { forma: pags[0].forma, valor: fmtNum(pags.reduce((t, p) => t + Number(p.valor), 0)) };
    S.boletos = bols.map((b) => ({ dias: difDias(b.vencimento), venc: b.vencimento, valor: fmtNum(b.valor) }));
  } else if (pags.length > 1) {
    S.modo = 'multiplo';
    S.multi = pags.map((p) => ({ forma: p.forma, valor: fmtNum(p.valor), parcelas: p.parcelas }));
  } else if (pags.length === 1) {
    S.modo = pags[0].forma; S.parcelas = pags[0].parcelas;
    S.status = v.status_pagamento; S.statusManual = true;
    if (S.status === 'parcial') S.valorPago = fmtNum(pags[0].valor);
  } else { S.status = v.status_pagamento; S.statusManual = true; }   // a receber: nada pago ainda
}

const precoPara = (id) => S.precos[id] ?? Number(S.produtos.find((p) => p.id === id)?.preco_venda || 0);

function baseOrigem(o) {
  if (o === 'pneus') return r2(S.linhas.reduce((s, l) => s + l.qtd * l.preco, 0));
  if (o === 'pecas') return money(S.ex.pecas_valor);
  if (o === 'servicos') return money(S.ex.servicos_valor);
  return money(S.ex[o + '_valor']);
}
const valorDesc = (d) => (d.tipo === 'percentual' ? r2(baseOrigem(d.origem) * Math.min(100, money(d.entrada)) / 100) : money(d.entrada));

function calc() {
  const pneus = baseOrigem('pneus');
  const ex = S.loja ? r2(['alinhamento', 'bicos', 'cambagem', 'rodas'].reduce((s, k) => s + money(S.ex[k + '_valor']), 0) + money(S.ex.pecas_valor) + money(S.ex.servicos_valor)) : 0;
  const descontos = S.descontos.map((d) => ({ ...d, valor: valorDesc(d) }));
  const desc = r2(descontos.reduce((s, d) => s + d.valor, 0));
  const troca = r2(S.trocas.filter((t) => t.abatido).reduce((s, t) => s + t.valor, 0));
  const bruto = r2(pneus + ex);
  return { pneus, ex, bruto, descontos, desc, troca, total: Math.max(0, r2(bruto - desc - troca)) };
}

function desenhar(root) {
  const par = (k, rot) => `<div class="par"><strong>${rot}</strong><label>Qtd.<input data-ex="${k}_qtd" type="number" min="0" step="1" inputmode="numeric" placeholder="0"></label>
    <label>Valor (R$)<input data-ex="${k}_valor" inputmode="decimal" placeholder="0,00"></label></div>`;
  root.innerHTML = `<div id="vf">
    <div class="cabeca"><div><button class="btn" id="vf-voltar" type="button">‹ Voltar ao painel</button></div><h2>${S.editId ? `Editar venda #${S.editNumero}` : 'Nova venda'} — ${S.loja ? 'Loja' : 'Atacado'}</h2></div>
    <section class="secao"><h3>Cliente</h3><div class="cliente-chip" id="vf-cliente"></div></section>
    <section class="secao"><h3>Pneus</h3>
      <div class="add-item"><input id="vf-q" type="search" placeholder="Filtrar medida ou marca" aria-label="Filtrar pneus">
        <select id="vf-sel" aria-label="Medida, marca e modelo"></select>
        <input id="vf-qtd" type="number" min="1" step="1" value="1" aria-label="Quantidade">
        <input id="vf-preco" inputmode="decimal" placeholder="Valor un." aria-label="Valor unitário (R$)">
        <button class="btn" id="vf-add" type="button">Adicionar</button></div>
      <div id="vf-linhas"></div></section>
    ${S.loja ? `<section class="secao"><h3>Serviços e produtos</h3><div class="grade-extra">
      ${par('alinhamento', 'Alinhamentos')}${par('bicos', 'Bicos')}${par('cambagem', 'Cambagens')}${par('rodas', 'Rodas')}
      <label>Valor das peças (R$)<input data-ex="pecas_valor" inputmode="decimal" placeholder="0,00"></label>
      <label>Valor dos serviços (R$)<input data-ex="servicos_valor" inputmode="decimal" placeholder="0,00"></label></div>
      <p class="resumo-pag">Informe o valor total de cada item (ex.: 4 bicos = R$ 60,00).</p></section>` : ''}
    <section class="secao"><h3>Pagamento</h3><div id="vf-pag"></div></section>
    <section class="secao"><div class="total-final" id="vf-total"></div>
      <label style="margin-top:.8rem">Observações<input id="vf-obs" autocomplete="off"></label>
      <div class="acoes-rapidas">
        <button class="ar-btn" data-ar="cliente" type="button" id="ar-cliente">${ICONES.cliente}Associar cliente</button>
        <button class="ar-btn" data-ar="desconto" type="button" id="ar-desconto">${ICONES.desconto}Aplicar desconto</button>
        <button class="ar-btn" data-ar="imprimir" type="button">${ICONES.nota}${S.editId ? 'Salvar e imprimir nota' : 'Concluir e imprimir nota'}</button>
        <button class="ar-btn" data-ar="troca" type="button" id="ar-troca">${ICONES.troca}Base de troca</button>
        <button class="btn primario" id="vf-concluir" type="button" style="margin-left:auto;min-height:48px;padding:0 1.6rem">${S.editId ? 'Salvar alterações' : 'Concluir venda'}</button></div></section></div>`;

  $('#vf-voltar').onclick = async () => {
    const mexeu = S.editId ? foto() !== S.snap : S.linhas.length || Object.values(S.ex).some(Boolean);
    if (mexeu && !(await confirmar(S.editId ? 'Descartar as alterações desta venda?' : 'Descartar esta venda sem salvar?', { ok: 'Descartar', titulo: S.editId ? 'Sair da edição' : 'Sair da venda' }))) return;
    S.aoSair();
  };
  $('#vf-q').oninput = opcoesPneu; $('#vf-sel').onchange = sugerirPreco; $('#vf-add').onclick = adicionar;
  $('#vf-obs').oninput = (e) => { S.obs = e.target.value; };
  const vf = $('#vf');   // ouvintes no #vf (recriado a cada venda), não no root, para não acumular
  vf.addEventListener('input', (e) => { const k = e.target.dataset?.ex; if (k) { S.ex[k] = e.target.value; pintarTotais(); } });
  vf.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ar]'); if (!b) return;
    ({ cliente: escolher, desconto: abrirDesconto, troca: abrirTroca, imprimir: () => concluir(true), 'sem-cliente': () => definirCliente(null) })[b.dataset.ar]?.();
  });
  $('#vf-concluir').onclick = () => concluir(false);
  vf.querySelectorAll('[data-ex]').forEach((el) => { if (S.ex[el.dataset.ex] != null) el.value = S.ex[el.dataset.ex]; });   // edição: campos já preenchidos
  $('#vf-obs').value = S.obs;
  pintarCliente(); opcoesPneu(); pintarLinhas(); pintarPag(); pintarTotais();
}

/* ---- cliente ---- */
function pintarCliente() {
  const c = S.cliente;
  $('#vf-cliente').innerHTML = c
    ? `<strong>${esc(c.nome)}</strong><span>${[c.cpf_cnpj, c.telefone].filter(Boolean).map(esc).join(' · ')}</span><button class="btn mini" data-ar="cliente" type="button">Trocar</button><button class="btn mini" data-ar="sem-cliente" type="button">Remover</button>`
    : `<span>${S.loja ? 'Venda sem cliente cadastrado (balcão).' : 'Escolha o cliente do atacado.'}</span><button class="btn mini" data-ar="cliente" type="button">Associar cliente</button>`;
  $('#ar-cliente')?.classList.toggle('on', !!c);
}
async function escolher() { const c = await escolherCliente(); if (c) await definirCliente(c); }
async function definirCliente(c) {
  S.cliente = c; S.precos = {};
  if (c) { try { (await chamar(sb.from('precos_cliente').select('produto_id, preco').eq('cliente_id', c.id))).forEach((x) => (S.precos[x.produto_id] = Number(x.preco))); } catch { /* sem preços personalizados */ } }
  S.linhas.forEach((l) => { if (!l.manual) l.preco = precoPara(l.produto_id); });
  pintarCliente(); sugerirPreco(); pintarLinhas(); pintarTotais();
  if (c && Object.keys(S.precos).length) toast('Preços personalizados do cliente aplicados');
}

/* ---- pneus ---- */
function opcoesPneu() {
  const sel = $('#vf-sel'); if (!sel) return;
  const q = ($('#vf-q').value || '').toLowerCase(), anterior = sel.value, g = {};
  for (const p of S.produtos) {
    const m = p.medidas.descricao, rot = `${p.marcas.nome} — ${p.nome} (${p.quantidade} un.)`;
    if (q && !`${m} ${rot}`.toLowerCase().includes(q)) continue;
    (g[m] ||= []).push({ id: p.id, rot });
  }
  sel.innerHTML = Object.keys(g).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    .map((m) => `<optgroup label="${esc(m)}">${g[m].map((p) => `<option value="${p.id}">${esc(p.rot)}</option>`).join('')}</optgroup>`).join('');
  if ([...sel.options].some((o) => o.value === anterior)) sel.value = anterior;
  sugerirPreco();
}
function sugerirPreco() { const s = $('#vf-sel'); if (s?.value) $('#vf-preco').value = fmtNum(precoPara(s.value)); }
function adicionar() {
  const id = $('#vf-sel').value, qtd = parseInt($('#vf-qtd').value, 10), preco = num($('#vf-preco').value);
  const p = S.produtos.find((x) => x.id === id);
  if (!p) return toast('Escolha a medida e a marca.', 'erro');
  if (!(qtd > 0)) return toast('Informe a quantidade.', 'erro');
  if (!(preco >= 0)) return toast('Informe o valor do pneu.', 'erro');
  const ja = S.linhas.find((l) => l.produto_id === id);
  if ((ja?.qtd || 0) + qtd > p.quantidade) return toast(`Só há ${p.quantidade} un. de ${p.medidas.descricao} ${p.marcas.nome}.`, 'erro');
  const manual = Math.abs(preco - precoPara(id)) > 0.004;
  if (ja) { ja.qtd += qtd; ja.preco = preco; ja.manual = manual; } else S.linhas.push({ produto_id: id, qtd, preco, manual });
  $('#vf-qtd').value = 1; pintarLinhas(); pintarTotais();
}
function pintarLinhas() {
  const el = $('#vf-linhas'); if (!el) return;
  el.innerHTML = S.linhas.length ? S.linhas.map((l, i) => {
    const p = S.produtos.find((x) => x.id === l.produto_id);
    return `<div class="linha-item"><span>${esc(p.medidas.descricao)} · ${esc(p.marcas.nome)} · ${esc(p.nome)}<br><small>${l.qtd} × ${brl(l.preco)}</small></span>
      <strong>${brl(l.qtd * l.preco)}</strong><button type="button" class="btn mini" data-rm="${i}">Remover</button></div>`;
  }).join('') : '<p class="vazio">Nenhum pneu adicionado.</p>';
  el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { S.linhas.splice(+b.dataset.rm, 1); pintarLinhas(); pintarTotais(); }));
}

/* ---- totais ---- */
function pintarTotais() {
  const c = calc();
  $('#vf-total').innerHTML = `<div><small>Total da venda</small><br><strong>${brl(c.total)}</strong></div>
    <small>Pneus ${brl(c.pneus)}${S.loja ? ' · Serviços/peças ' + brl(c.ex) : ''}${c.desc ? ' · Descontos −' + brl(c.desc) : ''}${c.troca ? ' · Troca −' + brl(c.troca) : ''}</small>`;
  $('#ar-desconto')?.classList.toggle('on', S.descontos.length > 0);
  $('#ar-troca')?.classList.toggle('on', S.trocas.length > 0);
  if (!S.statusManual && $('#pg-status')) { S.status = statusAuto(c); $('#pg-status').value = S.status; }
  resumoPag();
}

/* ---- pagamento ---- */
const entradaValor = () => money(S.entrada.valor);
const somaMulti = () => r2(S.multi.reduce((s, m) => s + money(m.valor), 0));
const somaBol = () => r2(S.boletos.reduce((s, b) => s + money(b.valor), 0));
function statusAuto(c) {
  if (S.modo === 'boleto') return entradaValor() > 0 ? 'parcial' : 'pendente';
  if (S.modo === 'multiplo') { const s = somaMulti(); return s <= 0 ? 'pendente' : s >= c.total - 0.01 ? 'pago' : 'parcial'; }
  return 'pago';
}

function pintarPag() {
  const el = $('#vf-pag'); if (!el) return;
  const c = calc();
  if (!S.statusManual) S.status = statusAuto(c);
  const simples = !['multiplo', 'boleto'].includes(S.modo);
  el.innerHTML = `<div class="grade">
      <label>Forma de pagamento<select id="pg-modo">${optSel(MODOS, S.modo)}</select></label>
      ${S.modo === 'cartao_credito' ? `<label>Parcelas<select id="pg-parc">${parcelasOpts(S.parcelas)}</select></label>` : ''}
      ${S.modo !== 'boleto' ? `<label>Status do pagamento<select id="pg-status">${optSel([['pago', 'Pago'], ['pendente', 'Pendente'], ['parcial', 'Parcialmente pago']], S.status)}</select></label>` : ''}
      ${simples && S.status === 'parcial' ? `<label>Valor já pago (R$)<input id="pg-pago" inputmode="decimal" value="${esc(S.valorPago)}" placeholder="0,00"></label>` : ''}</div>
    <div id="pg-extra">${S.modo === 'multiplo' ? multiHtml() : S.modo === 'boleto' ? boletoHtml() : ''}</div><div class="resumo-pag" id="pg-resumo"></div>`;
  $('#pg-modo').onchange = (e) => {
    S.modo = e.target.value; S.statusManual = false;
    if (S.modo === 'boleto' && !S.boletos.length) gerarBoletos(1);
    pintarPag(); resumoPag();
  };
  $('#pg-parc') && ($('#pg-parc').onchange = (e) => { S.parcelas = Number(e.target.value); });
  $('#pg-status') && ($('#pg-status').onchange = (e) => { S.status = e.target.value; S.statusManual = true; pintarPag(); });
  $('#pg-pago') && ($('#pg-pago').oninput = (e) => { S.valorPago = e.target.value; resumoPag(); });
  ligarExtra(); resumoPag();
}

function multiHtml() {
  return S.multi.map((m, i) => `<div class="pag-linha" data-i="${i}">
      <label>Forma<select data-m="forma">${optSel(FORMAS_VENDA, m.forma)}</select></label>
      <label>Valor (R$)<input data-m="valor" inputmode="decimal" value="${esc(m.valor)}" placeholder="0,00"></label>
      ${m.forma === 'cartao_credito' ? `<label>Parcelas<select data-m="parcelas">${parcelasOpts(m.parcelas)}</select></label>` : '<span></span>'}
      ${S.multi.length > 1 ? '<button type="button" class="btn mini" data-m-rm aria-label="Remover forma">✕</button>' : '<span></span>'}</div>`).join('')
    + (S.multi.length < 4 ? '<button type="button" class="btn" id="pg-add">+ Adicionar forma de pagamento</button>' : '');
}

function boletoHtml() {
  return `<div class="grade"><label>Entrada (opcional) — R$<input id="bo-ent" inputmode="decimal" value="${esc(S.entrada.valor)}" placeholder="0,00"></label>
      <label>Forma da entrada<select id="bo-entf">${optSel(FORMAS_VENDA, S.entrada.forma)}</select></label>
      <label>Quantidade de boletos<input id="bo-qtd" type="number" min="1" max="12" value="${S.boletos.length || 1}"></label>
      <button class="btn" id="bo-gerar" type="button">Gerar parcelas</button></div>
    ${S.boletos.map((b, i) => `<div class="bol-linha" data-b="${i}"><strong>${i + 1}/${S.boletos.length}</strong>
      <label>Dias<input data-bf="dias" type="number" min="0" value="${b.dias}"></label>
      <label>Vencimento<input data-bf="venc" type="date" value="${b.venc}"></label>
      <label>Valor (R$)<input data-bf="valor" inputmode="decimal" value="${esc(b.valor)}"></label></div>`).join('')}
    <p class="resumo-pag">Cada boleto tem o próprio vencimento. Exemplo: 30, 45 e 60 dias.</p>`;
}
function gerarBoletos(n) {
  const c = calc(), restante = Math.max(0, r2(c.total - entradaValor()));
  n = Math.min(12, Math.max(1, n));
  const cada = r2(restante / n);
  S.boletos = Array.from({ length: n }, (_, i) => {
    const dias = 30 * (i + 1), valor = i === n - 1 ? r2(restante - cada * (n - 1)) : cada;
    return { dias, venc: somaDias(dias), valor: fmtNum(valor) };
  });
}

function ligarExtra() {
  const ex = $('#pg-extra'); if (!ex) return;
  ex.oninput = (e) => {
    const t = e.target, linha = t.closest('[data-i]'), bl = t.closest('[data-b]');
    if (linha && t.dataset.m === 'valor') { S.multi[+linha.dataset.i].valor = t.value; }
    if (t.id === 'bo-ent') S.entrada.valor = t.value;
    if (bl) {
      const b = S.boletos[+bl.dataset.b];
      if (t.dataset.bf === 'dias') { b.dias = inteiro(t.value); b.venc = somaDias(b.dias); bl.querySelector('[data-bf=venc]').value = b.venc; }
      if (t.dataset.bf === 'venc' && t.value) { b.venc = t.value; b.dias = difDias(t.value); bl.querySelector('[data-bf=dias]').value = b.dias; }
      if (t.dataset.bf === 'valor') b.valor = t.value;
    }
    if (!S.statusManual && $('#pg-status')) { S.status = statusAuto(calc()); $('#pg-status').value = S.status; }
    resumoPag();
  };
  ex.onchange = (e) => {
    const t = e.target, linha = t.closest('[data-i]');
    if (linha && (t.dataset.m === 'forma' || t.dataset.m === 'parcelas')) {
      const m = S.multi[+linha.dataset.i];
      if (t.dataset.m === 'forma') { m.forma = t.value; pintarPag(); } else m.parcelas = Number(t.value);
    }
    if (t.id === 'bo-entf') S.entrada.forma = t.value;
  };
  ex.onclick = (e) => {
    if (e.target.id === 'pg-add') {
      const falta = Math.max(0, r2(calc().total - somaMulti()));
      S.multi.push({ forma: 'dinheiro', valor: falta ? fmtNum(falta) : '', parcelas: 1 }); pintarPag();
    }
    if (e.target.closest('[data-m-rm]')) { S.multi.splice(+e.target.closest('[data-i]').dataset.i, 1); S.statusManual = false; pintarPag(); }
    if (e.target.id === 'bo-gerar') { gerarBoletos(inteiro($('#bo-qtd').value) || 1); pintarPag(); }
  };
}

function resumoPag() {
  const el = $('#pg-resumo'); if (!el) return;
  const c = calc(), dif = (x) => (Math.abs(x) < 0.01 ? '<span class="pos">fecha com o total</span>' : x > 0 ? `<span class="neg">faltam ${brl(x)}</span>` : `<span class="neg">passou ${brl(-x)}</span>`);
  if (S.modo === 'multiplo') el.innerHTML = `Soma das formas: ${brl(somaMulti())} · ${dif(r2(c.total - somaMulti()))}`;
  else if (S.modo === 'boleto') el.innerHTML = `Entrada ${brl(entradaValor())} + boletos ${brl(somaBol())} = ${brl(entradaValor() + somaBol())} · ${dif(r2(c.total - entradaValor() - somaBol()))}`;
  else if (S.status === 'parcial') el.innerHTML = `Pago agora ${brl(money(S.valorPago))} · restante a receber ${brl(Math.max(0, c.total - money(S.valorPago)))}`;
  else if (S.status === 'pendente') el.innerHTML = `Nada pago agora · ${brl(c.total)} a receber`;
  else el.innerHTML = `Recebido: ${brl(c.total)}`;
}

/* ---- desconto ---- */
function abrirDesconto() {
  const c0 = calc();
  let L = S.descontos.length ? S.descontos.map((d) => ({ ...d, entrada: fmtNum(d.entrada) })) : [{ origem: 'pneus', tipo: 'valor', entrada: '' }];
  const origens = S.loja ? ORIGENS : [ORIGENS[0]];
  const m = abrirModal({ titulo: 'Descontos nesta venda', largura: 'min(680px, calc(100vw - 1.5rem))', corpo: `
    <p>Subtotal da venda: <strong>${brl(c0.bruto)}</strong>. Dá para lançar mais de um desconto, cada um saindo de um campo.</p>
    <div id="dc-l"></div><button class="btn" id="dc-add" type="button">+ Adicionar outro desconto</button><div class="resumo-pag" id="dc-res"></div>
    <div class="dlg-acoes"><button class="btn" id="dc-x" type="button">Cancelar</button><button class="btn primario" id="dc-ok" type="button">Salvar</button></div>` });
  const total = () => r2(L.reduce((s, d) => s + valorDesc(d), 0));
  const res = () => { const t = total(); $('#dc-res', m.dlg).innerHTML = `Total de descontos: <span class="neg">−${brl(t)}</span><br>Total final da venda: <strong>${brl(Math.max(0, c0.bruto - t - c0.troca))}</strong>`; };
  const pintar = () => {
    $('#dc-l', m.dlg).innerHTML = L.map((d, i) => `<div class="desc-linha" data-i="${i}">
      <label>Valor<input data-f="entrada" inputmode="decimal" value="${esc(d.entrada)}" placeholder="0,00"></label>
      <label>Tipo<select data-f="tipo"><option value="valor"${d.tipo === 'valor' ? ' selected' : ''}>R$</option><option value="percentual"${d.tipo === 'percentual' ? ' selected' : ''}>%</option></select></label>
      <label>Sai de<select data-f="origem">${optSel(origens, d.origem)}</select></label>
      ${L.length > 1 ? '<button class="btn mini" data-rm type="button" aria-label="Remover">✕</button>' : '<span></span>'}</div>`).join('');
    res();
  };
  pintar();
  $('#dc-l', m.dlg).oninput = (e) => { const i = e.target.closest('[data-i]')?.dataset.i; if (i != null && e.target.dataset.f === 'entrada') { L[i].entrada = e.target.value; res(); } };
  $('#dc-l', m.dlg).onchange = (e) => { const i = e.target.closest('[data-i]')?.dataset.i; if (i != null && e.target.dataset.f && e.target.dataset.f !== 'entrada') { L[i][e.target.dataset.f] = e.target.value; res(); } };
  $('#dc-l', m.dlg).onclick = (e) => { if (e.target.closest('[data-rm]')) { L.splice(+e.target.closest('[data-i]').dataset.i, 1); pintar(); } };
  $('#dc-add', m.dlg).onclick = () => { L.push({ origem: 'pneus', tipo: 'valor', entrada: '' }); pintar(); };
  $('#dc-x', m.dlg).onclick = m.fechar;
  $('#dc-ok', m.dlg).onclick = () => {
    if (total() > c0.bruto) return toast('O desconto é maior que o valor da venda.', 'erro');
    S.descontos = L.filter((d) => valorDesc(d) > 0).map((d) => ({ origem: d.origem, tipo: d.tipo, entrada: money(d.entrada) }));
    m.fechar(); S.statusManual = false; pintarTotais(); pintarPag();
  };
}

/* ---- base de troca ---- */
function abrirTroca() {
  let L = S.trocas.length ? S.trocas.map((t) => ({ ...t, valor: fmtNum(t.valor) })) : [{ medida: '', descricao: '', estado: 'Bom', valor: '', abatido: true, obs: '' }];
  const m = abrirModal({ titulo: 'Base de troca', largura: 'min(620px, calc(100vw - 1.5rem))', corpo: `
    <p>Registre os pneus que o cliente deixou na troca. O valor pago abate do total da venda quando "Abater da venda" estiver marcado.</p>
    <div id="tr-l"></div><button class="btn" id="tr-add" type="button">+ Adicionar pneu recebido</button><div class="resumo-pag" id="tr-res"></div>
    <div class="dlg-acoes"><button class="btn" id="tr-x" type="button">Cancelar</button><button class="btn primario" id="tr-ok" type="button">Salvar</button></div>` });
  const abat = () => r2(L.filter((t) => t.abatido).reduce((s, t) => s + money(t.valor), 0));
  const res = () => { $('#tr-res', m.dlg).textContent = `Abatimento no total da venda: ${brl(abat())}`; };
  const pintar = () => {
    $('#tr-l', m.dlg).innerHTML = L.map((t, i) => `<div class="troca-bloco" data-i="${i}">
      <div class="grade" style="margin:0"><label>Pneu recebido (medida)<input data-f="medida" value="${esc(t.medida)}" placeholder="205/55R16"></label>
        <label>Estado de conservação<select data-f="estado">${ESTADOS.map((e) => `<option${e === t.estado ? ' selected' : ''}>${e}</option>`).join('')}</select></label>
        <label>Valor pago pelo pneu (R$)<input data-f="valor" inputmode="decimal" value="${esc(t.valor)}" placeholder="0,00"></label></div>
      <label>Descrição<input data-f="descricao" value="${esc(t.descricao)}" placeholder="Marca, modelo, desgaste…"></label>
      <label>Observações<input data-f="obs" value="${esc(t.obs)}"></label>
      <div style="display:flex;justify-content:space-between;align-items:center"><label class="check"><input type="checkbox" data-f="abatido" ${t.abatido ? 'checked' : ''}> Abater da venda</label>
        ${L.length > 1 ? '<button class="btn mini" data-rm type="button">Remover</button>' : ''}</div></div>`).join('');
    res();
  };
  pintar();
  const mudou = (e) => {
    const i = e.target.closest('[data-i]')?.dataset.i, f = e.target.dataset.f; if (i == null || !f) return;
    L[i][f] = f === 'abatido' ? e.target.checked : e.target.value; res();
  };
  $('#tr-l', m.dlg).oninput = mudou; $('#tr-l', m.dlg).onchange = mudou;
  $('#tr-l', m.dlg).onclick = (e) => { if (e.target.closest('[data-rm]')) { L.splice(+e.target.closest('[data-i]').dataset.i, 1); pintar(); } };
  $('#tr-add', m.dlg).onclick = () => { L.push({ medida: '', descricao: '', estado: 'Bom', valor: '', abatido: true, obs: '' }); pintar(); };
  $('#tr-x', m.dlg).onclick = m.fechar;
  $('#tr-ok', m.dlg).onclick = () => {
    const ok = L.filter((t) => t.medida.trim() || t.descricao.trim() || money(t.valor) > 0);
    if (ok.some((t) => !t.medida.trim() && !t.descricao.trim())) return toast('Informe a medida ou a descrição do pneu recebido.', 'erro');
    S.trocas = ok.map((t) => ({ medida: t.medida.trim(), descricao: t.descricao.trim(), estado: t.estado, valor: money(t.valor), abatido: t.abatido, obs: t.obs.trim() }));
    m.fechar(); S.statusManual = false; pintarTotais(); pintarPag();
  };
}

/* ---- concluir ---- */
function montarPagamento(c) {
  if (S.modo === 'boleto') {
    const ent = entradaValor();
    return { pagamentos: ent > 0 ? [{ forma: S.entrada.forma, valor: ent, parcelas: 1 }] : [], boletos: S.boletos.map((b) => ({ vencimento: b.venc, valor: money(b.valor) })), status_pagamento: 'pendente' };
  }
  if (S.modo === 'multiplo') {
    return { pagamentos: S.multi.filter((m) => money(m.valor) > 0).map((m) => ({ forma: m.forma, valor: money(m.valor), parcelas: m.forma === 'cartao_credito' ? Number(m.parcelas) : 1 })), boletos: [], status_pagamento: S.status };
  }
  const parc = S.modo === 'cartao_credito' ? S.parcelas : 1;
  const pagamentos = S.status === 'pago' ? (c.total > 0 ? [{ forma: S.modo, valor: c.total, parcelas: parc }] : [])
    : S.status === 'parcial' ? [{ forma: S.modo, valor: money(S.valorPago), parcelas: parc }] : [];
  return { pagamentos, boletos: [], status_pagamento: S.status };
}

async function concluir(imprimir) {
  const c = calc();
  const erro = (m) => { toast(m, 'erro'); return false; };
  if (!S.linhas.length && c.ex <= 0) return erro('Adicione pelo menos um pneu ou serviço.');
  if (S.tipo === 'atacado' && !S.cliente) return erro('Escolha o cliente do atacado.');
  const pag = montarPagamento(c);
  if (S.modo === 'boleto') {
    if (!S.cliente) return erro('Boletos a prazo exigem um cliente associado.');
    if (!S.boletos.length) return erro('Gere as parcelas dos boletos.');
    if (S.boletos.some((b) => !b.venc || money(b.valor) <= 0)) return erro('Confira o vencimento e o valor de cada boleto.');
    if (Math.abs(entradaValor() + somaBol() - c.total) > 0.01) return erro('Entrada + boletos precisam fechar com o total da venda.');
  } else {
    if (S.status !== 'pago' && !S.cliente) return erro('Para venda pendente ou parcial, associe um cliente.');
    if (S.status === 'pago' && S.modo === 'multiplo' && Math.abs(somaMulti() - c.total) > 0.01) return erro('A soma das formas de pagamento precisa fechar com o total.');
    if (S.status === 'parcial' && !(pag.pagamentos[0]?.valor > 0 && pag.pagamentos.reduce((s, p) => s + p.valor, 0) < c.total)) return erro('Informe o valor já pago (menor que o total).');
  }
  const ex = {};
  if (S.loja) {
    for (const k of ['alinhamento', 'bicos', 'cambagem', 'rodas']) { ex[k + '_qtd'] = inteiro(S.ex[k + '_qtd']); ex[k + '_valor'] = money(S.ex[k + '_valor']); }
    ex.pecas_valor = money(S.ex.pecas_valor); ex.servicos_valor = money(S.ex.servicos_valor);
  }
  let janela = null;
  if (imprimir) { try { janela = abrirJanelaNota(); } catch (e) { return erro(e.message); } }
  const botoes = [...document.querySelectorAll('#vf button')]; botoes.forEach((b) => (b.disabled = true));
  try {
    const corpo = {
      chave: S.chave, tipo: S.tipo, cliente_id: S.cliente?.id || null, obs: S.obs.trim() || null,
      itens: S.linhas.map((l) => ({ produto_id: l.produto_id, quantidade: l.qtd, preco_unitario: l.preco })), extras: ex,
      descontos: c.descontos.map((d) => ({ origem: d.origem, tipo: d.tipo, entrada: d.entrada, valor: d.valor })),
      trocas: S.trocas.map((t) => ({ medida: t.medida, descricao: t.descricao, estado: t.estado, valor: t.valor, abatido: t.abatido, observacoes: t.obs })), ...pag };
    const id = S.editId ? await chamar(sb.rpc('editar_venda_loja', { p_venda: S.editId, p: corpo })) : await chamar(sb.rpc('registrar_venda_loja', { p: corpo }));
    const { numero } = await chamar(sb.from('vendas').select('numero').eq('id', id).single());
    S.chave = crypto.randomUUID();
    if (imprimir) { await imprimirNota(id, janela).catch((e) => toast(e.message, 'erro')); toast(S.editId ? `Venda #${numero} atualizada` : `Venda #${numero} registrada`); S.aoSair(); return; }
    const m = abrirModal({ titulo: S.editId ? `Venda #${numero} atualizada` : `Venda #${numero} registrada`, corpo: `<p>O estoque foi atualizado.</p>
      <div class="dlg-acoes"><button class="btn" id="fim-f" type="button">Fechar</button><button class="btn primario" id="fim-n" type="button">Imprimir nota</button></div>` });
    $('#fim-f', m.dlg).onclick = m.fechar;
    $('#fim-n', m.dlg).onclick = () => imprimirNota(id).catch((e) => toast(e.message, 'erro'));
    m.dlg.addEventListener('close', () => S.aoSair(), { once: true });
  } catch (e) {
    janela?.close(); toast(e.message, 'erro');
    botoes.forEach((b) => (b.disabled = false));       // mantém a mesma chave: reenviar é seguro
  }
}
