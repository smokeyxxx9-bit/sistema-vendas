import { sb, chamar } from '../supabase.js';
import { $, esc, brl, num, fmtNum, hoje, dataBR, FORMAS, opcoes, toast } from '../ui.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const money = (v) => { const n = typeof v === 'number' ? v : num(v); return Number.isFinite(n) && n > 0 ? r2(n) : 0; };
const somaDias = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toLocaleDateString('sv-SE'); };
const difDias = (iso) => Math.round((new Date(iso + 'T12:00:00') - new Date(hoje() + 'T12:00:00')) / 864e5);
const fmtQ = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
let aba = 'nova', raiz, pneus = [], insumos = [], S = null;

const novo = () => ({ linhas: [], forn: '', doc: '', data: hoje(), atualizar: true, pag: 'avista', forma: 'pix', parcelas: [], chave: crypto.randomUUID() });
const total = () => r2(S.linhas.reduce((s, l) => s + l.qtd * l.custo, 0));

export async function render(root) {
  raiz = root; S ||= novo();
  [pneus, insumos] = await Promise.all([
    chamar(sb.from('produtos').select('id, nome, quantidade, preco_custo, medidas(descricao), marcas(nome)').eq('ativo', true)),
    chamar(sb.from('itens_complementares').select('id, nome, unidade, quantidade, custo_unitario').eq('ativo', true).order('nome')),
  ]);
  desenhar();
}
export async function aoMudar() { if (aba === 'hist') await historico(); }   // a entrada em digitação nunca é recarregada

function desenhar() {
  raiz.innerHTML = `<div class="abas"><button data-aba="nova" aria-pressed="${aba === 'nova'}">Nova entrada</button><button data-aba="hist" aria-pressed="${aba === 'hist'}">Histórico</button></div><div id="e-corpo"></div>`;
  raiz.querySelectorAll('[data-aba]').forEach((b) => (b.onclick = () => { aba = b.dataset.aba; desenhar(); }));
  aba === 'nova' ? formNova() : historico();
}

/* ---------- nova entrada ---------- */
function rotuloPneu(p) { return `${p.medidas.descricao} · ${p.marcas.nome} · ${p.nome} (estoque ${p.quantidade})`; }

function formNova() {
  $('#e-corpo').innerHTML = `
    <section class="secao"><h3>Dados da entrada</h3><div class="grade">
      <label>Fornecedor<input id="e-forn" value="${esc(S.forn)}"></label><label>Documento (nota fiscal)<input id="e-doc" value="${esc(S.doc)}"></label>
      <label>Data<input type="date" id="e-data" value="${S.data}"></label></div></section>
    <section class="secao"><h3>Mercadorias recebidas</h3>
      <div class="add-item"><input id="e-q" type="search" placeholder="Filtrar pneu ou insumo" aria-label="Filtrar"><select id="e-sel" aria-label="Mercadoria"></select>
        <input id="e-qtd" type="number" min="0" step="any" value="1" aria-label="Quantidade"><input id="e-custo" inputmode="decimal" placeholder="Custo un." aria-label="Custo unitário (R$)">
        <button class="btn" id="e-add" type="button">Adicionar</button></div>
      <div id="e-linhas"></div>
      <label class="check" style="margin-top:.6rem"><input type="checkbox" id="e-upd" ${S.atualizar ? 'checked' : ''}> Atualizar o custo cadastrado com o valor desta entrada</label></section>
    <section class="secao"><h3>Pagamento ao fornecedor</h3><div class="grade">
      <label>Condição<select id="e-pag"><option value="avista"${S.pag === 'avista' ? ' selected' : ''}>À vista (já pago)</option><option value="prazo"${S.pag === 'prazo' ? ' selected' : ''}>A prazo (gera contas a pagar)</option></select></label>
      ${S.pag === 'avista' ? `<label>Pago com<select id="e-forma">${opcoes(FORMAS, S.forma)}</select></label>`
        : `<label>Número de parcelas<input id="e-npar" type="number" min="1" max="12" value="${S.parcelas.length || 1}"></label><button class="btn" id="e-gerar" type="button">Gerar parcelas</button>`}</div>
      <div id="e-parcelas"></div><div class="resumo-pag" id="e-resumo"></div></section>
    <section class="secao"><div class="total-final" id="e-total"></div>
      <div class="acoes-rapidas"><button class="btn primario" id="e-concluir" type="button" style="margin-left:auto;min-height:48px;padding:0 1.6rem">Registrar entrada</button></div></section>`;
  opcoesSel(); pintarLinhas(); pintarParcelas(); pintarTotais();
  $('#e-forn').oninput = (e) => { S.forn = e.target.value; }; $('#e-doc').oninput = (e) => { S.doc = e.target.value; }; $('#e-data').onchange = (e) => { S.data = e.target.value; };
  $('#e-upd').onchange = (e) => { S.atualizar = e.target.checked; };
  $('#e-q').oninput = opcoesSel; $('#e-sel').onchange = sugerirCusto; $('#e-add').onclick = adicionar;
  $('#e-pag').onchange = (e) => { S.pag = e.target.value; if (S.pag === 'prazo' && !S.parcelas.length) gerar(1); formNova(); };
  $('#e-forma') && ($('#e-forma').onchange = (e) => { S.forma = e.target.value; });
  $('#e-gerar') && ($('#e-gerar').onclick = () => { gerar(parseInt($('#e-npar').value, 10) || 1); pintarParcelas(); pintarTotais(); });
  $('#e-concluir').onclick = concluir;
}

function opcoesSel() {
  const sel = $('#e-sel'), q = ($('#e-q').value || '').toLowerCase(), ant = sel.value;
  const p = pneus.filter((x) => !q || rotuloPneu(x).toLowerCase().includes(q)).sort((a, b) => a.medidas.descricao.localeCompare(b.medidas.descricao, 'pt-BR', { numeric: true }));
  const i = insumos.filter((x) => !q || x.nome.toLowerCase().includes(q));
  sel.innerHTML = (p.length ? `<optgroup label="Pneus">${p.map((x) => `<option value="p:${x.id}">${esc(rotuloPneu(x))}</option>`).join('')}</optgroup>` : '')
    + (i.length ? `<optgroup label="Insumos e serviços">${i.map((x) => `<option value="i:${x.id}">${esc(x.nome)} (estoque ${fmtQ(x.quantidade)} ${esc(x.unidade)})</option>`).join('')}</optgroup>` : '');
  if ([...sel.options].some((o) => o.value === ant)) sel.value = ant;
  sugerirCusto();
}
function achar(v) { const [t, id] = v.split(':'); return t === 'p' ? { tipo: 'pneu', id, ref: pneus.find((x) => x.id === id) } : { tipo: 'item', id, ref: insumos.find((x) => x.id === id) }; }
function sugerirCusto() { const v = $('#e-sel').value; if (!v) return; const { tipo, ref } = achar(v); $('#e-custo').value = fmtNum(tipo === 'pneu' ? ref.preco_custo : ref.custo_unitario); }

function adicionar() {
  const v = $('#e-sel').value; if (!v) return toast('Escolha a mercadoria.', 'erro');
  const { tipo, id, ref } = achar(v), qtd = num($('#e-qtd').value), custo = num($('#e-custo').value);
  if (!(qtd > 0)) return toast('Informe a quantidade.', 'erro');
  if (tipo === 'pneu' && qtd !== Math.trunc(qtd)) return toast('Pneus são contados em unidades inteiras.', 'erro');
  if (!(custo >= 0)) return toast('Informe o custo unitário.', 'erro');
  const rot = tipo === 'pneu' ? `${ref.medidas.descricao} · ${ref.marcas.nome} · ${ref.nome}` : ref.nome;
  const ja = S.linhas.find((l) => l.tipo === tipo && l.id === id);
  if (ja) { ja.qtd += qtd; ja.custo = custo; } else S.linhas.push({ tipo, id, rot, qtd, custo });
  $('#e-qtd').value = 1; pintarLinhas(); pintarTotais();
}
function pintarLinhas() {
  $('#e-linhas').innerHTML = S.linhas.length ? S.linhas.map((l, i) => `<div class="linha-item"><span>${esc(l.rot)} <span class="chip">${l.tipo === 'pneu' ? 'pneu' : 'insumo'}</span><br><small>${fmtQ(l.qtd)} × ${brl(l.custo)}</small></span>
    <strong>${brl(l.qtd * l.custo)}</strong><button type="button" class="btn mini" data-rm="${i}">Remover</button></div>`).join('') : '<p class="vazio">Nenhuma mercadoria adicionada.</p>';
  $('#e-linhas').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { S.linhas.splice(+b.dataset.rm, 1); pintarLinhas(); pintarTotais(); }));
}

/* parcelas a prazo */
function gerar(n) {
  n = Math.min(12, Math.max(1, n)); const t = total(), cada = r2(t / n);
  S.parcelas = Array.from({ length: n }, (_, i) => { const dias = 30 * (i + 1); return { dias, venc: somaDias(dias), valor: fmtNum(i === n - 1 ? r2(t - cada * (n - 1)) : cada) }; });
}
function pintarParcelas() {
  const el = $('#e-parcelas'); if (!el) return;
  el.innerHTML = S.pag === 'prazo' ? S.parcelas.map((b, i) => `<div class="bol-linha" data-b="${i}"><strong>${i + 1}/${S.parcelas.length}</strong>
    <label>Dias<input data-f="dias" type="number" min="0" value="${b.dias}"></label><label>Vencimento<input data-f="venc" type="date" value="${b.venc}"></label>
    <label>Valor (R$)<input data-f="valor" inputmode="decimal" value="${esc(b.valor)}"></label></div>`).join('') : '';
  el.oninput = (e) => {
    const bl = e.target.closest('[data-b]'); if (!bl) return; const b = S.parcelas[+bl.dataset.b], f = e.target.dataset.f;
    if (f === 'dias') { b.dias = Math.max(0, parseInt(e.target.value, 10) || 0); b.venc = somaDias(b.dias); bl.querySelector('[data-f=venc]').value = b.venc; }
    if (f === 'venc' && e.target.value) { b.venc = e.target.value; b.dias = difDias(e.target.value); bl.querySelector('[data-f=dias]').value = b.dias; }
    if (f === 'valor') b.valor = e.target.value;
    resumo();
  };
}
const somaParc = () => r2(S.parcelas.reduce((s, b) => s + money(b.valor), 0));
function resumo() {
  const el = $('#e-resumo'); if (!el) return;
  if (S.pag !== 'prazo') { el.textContent = ''; return; }
  const dif = r2(total() - somaParc());
  el.innerHTML = `Soma das parcelas: ${brl(somaParc())} · ${Math.abs(dif) < 0.01 ? '<span class="pos">fecha com o total</span>' : `<span class="neg">${dif > 0 ? 'faltam ' + brl(dif) : 'passou ' + brl(-dif)}</span>`}`;
}
function pintarTotais() { $('#e-total').innerHTML = `<div><small>Total da entrada</small><br><strong>${brl(total())}</strong></div><small>${S.linhas.length} item(ns)</small>`; resumo(); }

async function concluir() {
  const t = total(), bt = $('#e-concluir'), erro = (m) => toast(m, 'erro');
  if (!S.linhas.length) return erro('Adicione pelo menos uma mercadoria.');
  if (S.pag === 'prazo') {
    if (!S.parcelas.length) return erro('Gere as parcelas.');
    if (S.parcelas.some((b) => !b.venc || money(b.valor) <= 0)) return erro('Confira o vencimento e o valor de cada parcela.');
    if (Math.abs(somaParc() - t) > 0.01) return erro('A soma das parcelas precisa fechar com o total da entrada.');
  }
  bt.disabled = true;
  try {
    await chamar(sb.rpc('registrar_entrada', { p: {
      chave: S.chave, data: S.data, fornecedor: S.forn.trim(), documento: S.doc.trim(), atualizar_custo: S.atualizar,
      itens: S.linhas.map((l) => ({ tipo: l.tipo, id: l.id, quantidade: l.qtd, custo_unitario: l.custo })),
      ...(S.pag === 'prazo' ? { parcelas: S.parcelas.map((b) => ({ vencimento: b.venc, valor: money(b.valor) })) } : { forma: S.forma }) } }));
    toast('Entrada registrada e estoque atualizado');
    S = novo(); await render(raiz);
  } catch (e) { toast(e.message, 'erro'); bt.disabled = false; }   // mantém a mesma chave: reenviar é seguro
}

/* ---------- histórico ---------- */
async function historico() {
  const e = await chamar(sb.from('entradas_mercadoria').select(`id, numero, data, fornecedor, documento, total,
    entradas_itens(quantidade, custo_unitario, produtos(nome, medidas(descricao), marcas(nome)), itens_complementares(nome, unidade))`).order('criado_em', { ascending: false }).limit(60));
  const alvo = $('#e-corpo'); if (!alvo) return;
  alvo.innerHTML = e.length ? e.map((x) => `<details class="venda"><summary><strong>#${x.numero}</strong><span>${dataBR(x.data)}</span><span>${esc(x.fornecedor || 'Sem fornecedor')}</span>${x.documento ? `<span>NF ${esc(x.documento)}</span>` : ''}<b>${brl(x.total)}</b></summary>
    <div class="rolagem"><table><tbody>${x.entradas_itens.map((i) => `<tr><td>${i.produtos ? esc(`${i.produtos.medidas.descricao} · ${i.produtos.marcas.nome} · ${i.produtos.nome}`) : esc(i.itens_complementares?.nome)}</td>
      <td class="n">${fmtQ(i.quantidade)} × ${brl(i.custo_unitario)}</td></tr>`).join('')}</tbody></table></div></details>`).join('')
    : '<p class="vazio">Nenhuma entrada registrada.</p>';
}
