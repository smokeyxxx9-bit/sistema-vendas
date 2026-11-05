import { sb, todos } from '../supabase.js';
import { $, esc, brl, dataHora, dataBR, nomeForma, toast } from '../ui.js';

// Tipos de coluna: t texto · q quantidade (soma) · m dinheiro (soma) · p preço unitário · d data/hora
const vw = (nome, ordem) => todos((a, b) => sb.from(nome).select('*').order(ordem).range(a, b));
const vwPeriodo = (nome, campo, ini, fim, extra = (q) => q) =>
  todos((a, b) => extra(sb.from(nome).select('*').gte(campo, ini).lte(campo, fim)).order(campo).range(a, b));
const soma = (xs) => xs.reduce((s, x) => s + Number(x), 0);
const dia = (iso) => new Date(iso).toLocaleDateString('pt-BR');
const dl = (iso) => new Date(iso).toLocaleDateString('sv-SE');   // ISO do período -> data local (para colunas do tipo date)
const fmtQ = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const STATUS_PAG = { pago: 'Pago', pendente: 'Pendente', parcial: 'Parcialmente pago' };
// Usa o total gravado na venda (inclui serviços, peças, descontos e troca).
const vendasPeriodo = (i, f) => todos((a, b) => sb.from('vendas')
  .select('numero, criado_em, tipo, total, forma_resumo, status_pagamento, vendedor_nome, clientes(nome)')
  .eq('status', 'concluida').gte('criado_em', i).lte('criado_em', f).order('criado_em').range(a, b));
const agrupar = (vendas, chave) => {
  const m = new Map();
  for (const v of vendas) { const k = chave(v), a = m.get(k) || [k, 0, 0]; a[1]++; a[2] += Number(v.total); m.set(k, a); }
  return [...m.values()].sort((a, b) => b[2] - a[2]);
};

const REL = {
  estoque: { t: 'Estoque geral', cols: [['Medida'], ['Marca'], ['Produto'], ['Qtd.', 'q'], ['Custo un.', 'p', 'c'], ['Venda un.', 'p'], ['Valor a custo', 'm', 'c']],
    async dados() { return (await vw('v_estoque_produtos', 'medida')).map((x) => [x.medida, x.marca, x.produto, x.quantidade, x.preco_custo, x.preco_venda, x.quantidade * x.preco_custo]); } },
  estoque_medida: { t: 'Estoque por medida', cols: [['Medida'], ['Qtd. total', 'q'], ['Mínimo', 'q'], ['Situação']],
    async dados() { return (await vw('v_estoque_medida', 'medida')).map((x) => [x.medida, x.total, x.minimo, x.baixo ? 'Estoque baixo' : 'Ok']); } },
  estoque_marca: { t: 'Estoque por marca', cols: [['Marca'], ['Qtd.', 'q'], ['Valor a custo', 'm', 'c']],
    async dados() {
      const m = new Map();
      for (const x of await vw('v_estoque_produtos', 'marca')) { const a = m.get(x.marca) || [0, 0]; a[0] += x.quantidade; a[1] += x.quantidade * x.preco_custo; m.set(x.marca, a); }
      return [...m].map(([k, v]) => [k, ...v]);
    } },
  estoque_baixo: { t: 'Estoque baixo (por medida)', cols: [['Medida'], ['Qtd. total', 'q'], ['Mínimo', 'q'], ['Faltam p/ o mínimo', 'q']],
    async dados() { return (await vw('v_estoque_medida', 'medida')).filter((x) => x.baixo).map((x) => [x.medida, x.total, x.minimo, Math.max(0, x.minimo - x.total)]); } },
  vendas: { t: 'Vendas por período', periodo: true, cols: [['Venda'], ['Data', 'd'], ['Cliente'], ['Tipo'], ['Forma'], ['Pagamento'], ['Vendedor'], ['Total', 'm']],
    async dados(i, f) { return (await vendasPeriodo(i, f)).map((v) => [`#${v.numero}`, v.criado_em, v.clientes?.nome || 'Balcão', v.tipo === 'atacado' ? 'Atacado' : 'Loja', v.forma_resumo || '', STATUS_PAG[v.status_pagamento] || '', v.vendedor_nome || '', v.total]); } },
  vendas_cliente: { t: 'Vendas por cliente', periodo: true, cols: [['Cliente'], ['Nº de vendas', 'q'], ['Total', 'm']],
    async dados(i, f) { return agrupar(await vendasPeriodo(i, f), (v) => v.clientes?.nome || 'Balcão'); } },
  vendas_vendedor: { t: 'Vendas por vendedor', periodo: true, cols: [['Vendedor'], ['Nº de vendas', 'q'], ['Total', 'm']],
    async dados(i, f) { return agrupar(await vendasPeriodo(i, f), (v) => v.vendedor_nome || '—'); } },
  vendas_produto: { t: 'Vendas por produto', periodo: true, cols: [['Medida'], ['Marca'], ['Qtd.', 'q'], ['Total', 'm']],
    async dados(i, f) {
      const m = new Map();
      for (const x of await vwPeriodo('v_vendas_detalhe', 'criado_em', i, f, (q) => q.eq('status', 'concluida'))) {
        const k = x.medida + '|' + x.marca, a = m.get(k) || [x.medida, x.marca, 0, 0]; a[2] += x.quantidade; a[3] += Number(x.subtotal); m.set(k, a);
      }
      return [...m.values()].sort((a, b) => b[2] - a[2]);
    } },
  entradas: { t: 'Entrada de mercadorias', periodo: true, interno: true, cols: [['Entrada'], ['Data'], ['Fornecedor'], ['Documento'], ['Pagamento'], ['Total', 'm']],
    async dados(i, f) {
      const l = await todos((a, b) => sb.from('entradas_mercadoria').select('numero, data, fornecedor, documento, a_prazo, forma, total').gte('data', dl(i)).lte('data', dl(f)).order('data').range(a, b));
      return l.map((x) => [`#${x.numero}`, dataBR(x.data), x.fornecedor || '', x.documento || '', x.a_prazo ? 'A prazo' : nomeForma(x.forma), x.total]);
    } },
  pagar: { t: 'Contas a pagar (por vencimento)', periodo: true, interno: true, cols: [['Vencimento'], ['Descrição'], ['Fornecedor'], ['Categoria'], ['Situação'], ['Valor', 'm']],
    async dados(i, f) {
      const l = await todos((a, b) => sb.from('contas_pagar').select('*').gte('vencimento', dl(i)).lte('vencimento', dl(f)).order('vencimento').range(a, b));
      const h = new Date().toLocaleDateString('sv-SE');
      return l.map((x) => [dataBR(x.vencimento), x.descricao, x.fornecedor || '', x.categoria || '', x.status === 'pago' ? 'Paga em ' + dataBR(x.pago_em) : x.vencimento < h ? 'Vencida' : 'A vencer', x.valor]);
    } },
  insumos: { t: 'Insumos e serviços (estoque)', interno: true, cols: [['Item'], ['Categoria'], ['Em estoque'], ['Mínimo'], ['Situação'], ['Custo un.', 'p']],
    async dados() {
      return (await vw('itens_complementares', 'categoria')).filter((x) => x.ativo).map((x) => [x.nome, x.categoria, `${fmtQ(x.quantidade)} ${x.unidade}`, `${fmtQ(x.estoque_minimo)} ${x.unidade}`,
        Number(x.estoque_minimo) > 0 && Number(x.quantidade) <= Number(x.estoque_minimo) ? 'Repor' : 'Ok', x.custo_unitario]);
    } },
  comissoes: { t: 'Comissões pagas', periodo: true, interno: true, cols: [['Mês das vendas'], ['Funcionário'], ['Vendido', 'm'], ['%'], ['Comissão', 'm'], ['Pago em', 'd']],
    async dados(i, f) {
      const l = await todos((a, b) => sb.from('comissoes_pagas').select('competencia, total_vendido, pct, valor, pago_em, funcionarios(nome)').gte('pago_em', i).lte('pago_em', f).order('pago_em').range(a, b));
      return l.map((x) => [new Date(x.competencia + 'T12:00:00').toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }), x.funcionarios?.nome || '', x.total_vendido, `${fmtQ(x.pct)}%`, x.valor, x.pago_em]);
    } },
  boletos: { t: 'Boletos a receber', cols: [['Cliente'], ['Venda'], ['Parcela'], ['Vencimento'], ['Valor', 'm']],
    async dados() {
      const l = await todos((a, b) => sb.from('venda_boletos').select('parcela, vencimento, valor, vendas(numero, clientes(nome))').eq('status', 'pendente').order('vencimento').range(a, b));
      return l.map((x) => [x.vendas?.clientes?.nome || '—', `#${x.vendas?.numero}`, x.parcela, dataBR(x.vencimento), x.valor]);
    } },
  lucro: { t: 'Lucro dos pneus por período (sem serviços e peças)', periodo: true, interno: true, cols: [['Dia'], ['Faturamento', 'm'], ['Custo', 'm'], ['Lucro', 'm']],
    async dados(i, f) {
      const m = new Map();
      for (const x of await vwPeriodo('v_vendas_detalhe', 'criado_em', i, f, (q) => q.eq('status', 'concluida'))) {
        const k = dia(x.criado_em), a = m.get(k) || [k, 0, 0, 0];
        a[1] += Number(x.subtotal); a[2] += x.quantidade * x.custo_unitario; a[3] += Number(x.lucro); m.set(k, a);
      }
      return [...m.values()];
    } },
  receber: { t: 'Contas a receber', cols: [['Cliente'], ['Venda'], ['Vencimento'], ['Total', 'm'], ['Pago', 'm'], ['Saldo', 'm']],
    async dados() { return (await vw('v_contas', 'vencimento')).filter((x) => ['aberta', 'parcial'].includes(x.status)).map((x) => [x.cliente_nome, `#${x.venda_numero}`, dataBR(x.vencimento), x.valor_total, x.valor_pago, x.saldo]); } },
  inadimplentes: { t: 'Clientes inadimplentes', cols: [['Cliente'], ['Telefone'], ['Contas vencidas', 'q'], ['Mais antiga'], ['Saldo vencido', 'm']],
    async dados() {
      const m = new Map();
      for (const x of (await vw('v_contas', 'vencimento')).filter((c) => c.vencida)) {
        const a = m.get(x.cliente_id) || [x.cliente_nome, x.telefone || '', 0, dataBR(x.vencimento), 0]; a[2]++; a[4] += Number(x.saldo); m.set(x.cliente_id, a);
      }
      return [...m.values()].sort((a, b) => b[4] - a[4]);
    } },
  pagamentos: { t: 'Pagamentos recebidos', periodo: true, cols: [['Data', 'd'], ['Cliente'], ['Venda'], ['Forma'], ['Valor', 'm']],
    async dados(i, f) { return (await vwPeriodo('v_pagamentos_detalhe', 'recebido_em', i, f)).map((x) => [x.recebido_em, x.cliente, `#${x.venda_numero}`, nomeForma(x.forma), x.valor]); } },
};

let atual = null; // { chave, cols, linhas }
const fmt = (v, k) => (k === 'm' || k === 'p' ? brl(v) : k === 'd' ? dataHora(v) : k === 'q' ? Number(v).toLocaleString('pt-BR') : v ?? '');

export async function render(root) {
  if (!$('#r-tipo', root)) {
    const hoje = new Date(), ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1), iso = (d) => d.toLocaleDateString('sv-SE');
    root.innerHTML = `<div class="barra-ferramentas">
      <label>Relatório<select id="r-tipo">${Object.entries(REL).map(([k, r]) => `<option value="${k}">${esc(r.t)}</option>`).join('')}</select></label>
      <label data-per>De<input type="date" id="r-ini" value="${iso(ini)}"></label>
      <label data-per>Até<input type="date" id="r-fim" value="${iso(hoje)}"></label>
      <label class="check"><input type="checkbox" id="r-cli"> Relatório para cliente (sem preço de compra e lucro)</label>
      <button class="btn primario" id="r-gerar">Gerar</button>
      <button class="btn" id="r-xlsx" disabled>Excel</button><button class="btn" id="r-pdf" disabled>PDF</button></div><div id="r-saida"></div>`;
    $('#r-tipo').onchange = () => { root.querySelectorAll('[data-per]').forEach((l) => (l.hidden = !REL[$('#r-tipo').value].periodo)); };
    $('#r-tipo').onchange();
    $('#r-cli').onchange = () => {
      const cli = $('#r-cli').checked;
      root.querySelectorAll('#r-tipo option').forEach((o) => { o.disabled = cli && REL[o.value].interno; });
      if (REL[$('#r-tipo').value].interno && cli) { $('#r-tipo').value = Object.keys(REL).find((k) => !REL[k].interno); $('#r-tipo').onchange(); }
      atual = null; $('#r-saida').innerHTML = ''; $('#r-xlsx').disabled = $('#r-pdf').disabled = true;   // não deixa um relatório antigo (com custo) na tela
    };
    $('#r-gerar').onclick = gerar;
    $('#r-xlsx').onclick = () => exportar('xlsx');
    $('#r-pdf').onclick = () => exportar('pdf');
  }
}

async function gerar() {
  const chave = $('#r-tipo').value, r = REL[chave], bt = $('#r-gerar'), saida = $('#r-saida');
  const ini = new Date($('#r-ini').value + 'T00:00:00').toISOString(), fim = new Date($('#r-fim').value + 'T23:59:59').toISOString();
  bt.disabled = true; saida.innerHTML = '<p class="carregando">Gerando…</p>';
  try {
    const paraCliente = $('#r-cli').checked;
    if (paraCliente && r.interno) throw new Error('Este relatório mostra lucro e só pode ser gerado para uso interno.');
    let linhas = await r.dados(ini, fim), cols = r.cols;
    if (paraCliente) {   // remove as colunas de custo
      const manter = cols.map((c, i) => (c[2] === 'c' ? -1 : i)).filter((i) => i >= 0);
      cols = manter.map((i) => cols[i]); linhas = linhas.map((l) => manter.map((i) => l[i]));
    }
    atual = { chave, cols, linhas, titulo: r.t + (r.periodo ? ` (${dataBR($('#r-ini').value)} a ${dataBR($('#r-fim').value)})` : '') };
    const tot = cols.map(([, k], i) => (k === 'q' || k === 'm' ? soma(linhas.map((l) => l[i])) : null));
    saida.innerHTML = linhas.length ? `<div class="bloco"><h2>${esc(atual.titulo)}</h2><div class="rolagem"><table><thead><tr>${cols.map(([t, k]) => `<th class="${['q', 'm', 'p'].includes(k) ? 'n' : ''}">${t}</th>`).join('')}</tr></thead>
      <tbody>${linhas.map((l) => `<tr>${l.map((v, i) => `<td class="${['q', 'm', 'p'].includes(cols[i][1]) ? 'n' : ''}">${esc(fmt(v, cols[i][1]))}</td>`).join('')}</tr>`).join('')}</tbody>
      ${tot.some((t) => t !== null) ? `<tfoot><tr>${tot.map((t, i) => `<td class="${t !== null ? 'n' : ''}">${i === 0 ? 'Total' : t !== null ? esc(fmt(t, cols[i][1])) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div></div>`
      : '<p class="vazio">Nenhum dado para este relatório e período.</p>';
    $('#r-xlsx').disabled = $('#r-pdf').disabled = !linhas.length;
  } catch (e) { saida.innerHTML = `<div class="erro">${esc(e.message)}</div>`; }
  finally { bt.disabled = false; }
}

const carregarScript = (src) => new Promise((ok, err) => {
  if (document.querySelector(`script[src="${src}"]`)) return ok();
  const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => err(new Error('Não foi possível carregar a biblioteca de exportação.')); document.head.append(s);
});

async function exportar(tipo) {
  if (!atual) return;
  const nome = `${atual.chave}-${new Date().toLocaleDateString('sv-SE')}`;
  try {
    if (tipo === 'xlsx') {
      await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const ws = XLSX.utils.aoa_to_sheet([atual.cols.map((c) => c[0]), ...atual.linhas.map((l) => l.map((v, i) => (atual.cols[i][1] === 'd' ? dataHora(v) : v)))]);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Relatório'); XLSX.writeFile(wb, nome + '.xlsx');
    } else {
      await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
      const doc = new window.jspdf.jsPDF({ orientation: 'landscape' });
      doc.setFontSize(14); doc.text(atual.titulo, 14, 14);
      doc.autoTable({ head: [atual.cols.map((c) => c[0])], body: atual.linhas.map((l) => l.map((v, i) => String(fmt(v, atual.cols[i][1])))), startY: 20, styles: { fontSize: 9 }, headStyles: { fillColor: [12, 90, 75] } });
      doc.save(nome + '.pdf');
    }
  } catch (e) { toast(e.message, 'erro'); }
}
