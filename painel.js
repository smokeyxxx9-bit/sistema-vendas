import { sb, chamar } from '../supabase.js';
import { $, esc, brl, hoje, dataBR, barra } from '../ui.js';

let ini = hoje().slice(0, 8) + '01', fim = hoje(), raiz;
const soma = (xs) => xs.reduce((s, x) => s + Number(x || 0), 0);
const mesPrimeiro = (delta) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + delta); return d.toLocaleDateString('sv-SE'); };
const nomeMes = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const fmtQ = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export async function render(root) {
  raiz = root;
  if (!$('#d-res', root)) {
    root.innerHTML = `<div class="barra-ferramentas">
      <label>De<input type="date" id="d-ini" value="${ini}"></label><label>Até<input type="date" id="d-fim" value="${fim}"></label>
      <button class="btn" data-p="hoje">Hoje</button><button class="btn" data-p="7">7 dias</button><button class="btn" data-p="mes">Este mês</button><button class="btn" data-p="ant">Mês passado</button></div>
      <div id="d-res"></div>`;
    $('#d-ini').onchange = (e) => { ini = e.target.value || ini; if (fim < ini) fim = ini; pintar(); };
    $('#d-fim').onchange = (e) => { fim = e.target.value || fim; if (fim < ini) ini = fim; pintar(); };
    root.querySelector('.barra-ferramentas').onclick = (e) => {
      const p = e.target.closest('[data-p]')?.dataset.p; if (!p) return;
      const h = hoje();
      if (p === 'hoje') { ini = fim = h; }
      if (p === '7') { const d = new Date(); d.setDate(d.getDate() - 6); ini = d.toLocaleDateString('sv-SE'); fim = h; }
      if (p === 'mes') { ini = h.slice(0, 8) + '01'; fim = h; }
      if (p === 'ant') { ini = mesPrimeiro(-1); fim = new Date(new Date(mesPrimeiro(0) + 'T12:00:00').getTime() - 864e5).toLocaleDateString('sv-SE'); }
      pintar();
    };
  }
  await pintar();
}
export async function aoMudar(root) { raiz = root; if ($('#d-res', root)) await pintar(); }

async function pintar() {
  $('#d-ini').value = ini; $('#d-fim').value = fim;
  const [d, comPrev, comAtual] = await Promise.all([
    chamar(sb.rpc('dashboard_adm', { p_ini: ini, p_fim: fim })),
    chamar(sb.rpc('comissoes', { p_competencia: mesPrimeiro(-1) })),
    chamar(sb.rpc('comissoes', { p_competencia: mesPrimeiro(0) })),
  ]);
  const ticket = d.qtd_vendas ? d.total_vendido / d.qtd_vendas : 0;
  const lucro = d.total_vendido - d.custo_pneus_vendidos;
  const pend = comPrev.filter((c) => !c.pago && Number(c.valor) > 0);
  const pendTotal = soma(pend.map((c) => c.valor));
  const acumulado = soma(comAtual.map((c) => c.valor));

  // aviso da data de pagamento das comissões
  const dia = Math.min(28, Math.max(1, d.dia_pagamento_comissao || 5)), h = new Date();
  const pagamento = new Date(h.getFullYear(), h.getMonth(), dia), dias = Math.round((pagamento - new Date(h.getFullYear(), h.getMonth(), h.getDate())) / 864e5);
  let avisoCom = '';
  if (pend.length && dias <= 3) {
    const msg = dias > 0 ? `Faltam ${dias} dia${dias > 1 ? 's' : ''} para pagar as comissões de ${nomeMes(mesPrimeiro(-1))} (dia ${dia}).`
      : dias === 0 ? `Hoje é dia de pagar as comissões de ${nomeMes(mesPrimeiro(-1))}.` : `As comissões de ${nomeMes(mesPrimeiro(-1))} estão atrasadas (vencem todo dia ${dia}).`;
    avisoCom = `<section class="bloco alerta"><div class="aviso"><h2>${esc(msg)}</h2><a class="btn" href="#/funcionarios">Abrir comissões</a></div>
      <div class="rolagem"><table class="denso"><thead><tr><th>Funcionário</th><th class="n">Vendido</th><th class="n">%</th><th class="n">A pagar</th></tr></thead><tbody>
      ${pend.map((c) => `<tr><td>${esc(c.nome)}${c.atingiu ? ' <span class="chip pago">meta batida</span>' : ''}</td><td class="n">${brl(c.total_vendido)}</td><td class="n">${Number(c.pct)}%</td><td class="n"><strong>${brl(c.valor)}</strong></td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3">Total</td><td class="n">${brl(pendTotal)}</td></tr></tfoot></table></div></section>`;
  }
  const avisoPagar = d.pagar_vencidas_qtd > 0 ? `<section class="bloco alerta"><div class="aviso"><h2>${d.pagar_vencidas_qtd} conta${d.pagar_vencidas_qtd > 1 ? 's' : ''} a pagar vencida${d.pagar_vencidas_qtd > 1 ? 's' : ''}: ${brl(d.pagar_vencido)}</h2><a class="btn" href="#/pagar">Ver contas</a></div></section>` : '';
  const avisoItens = d.itens_baixos.length ? `<section class="bloco alerta"><div class="aviso"><h2>Insumos para repor</h2><a class="btn" href="#/insumos">Abrir insumos</a></div>
    <ul class="lista-medidas">${d.itens_baixos.map((i) => `<li><span><strong>${esc(i.nome)}</strong> (${esc(i.categoria)}): ${fmtQ(i.quantidade)} ${esc(i.unidade)} em estoque, mínimo ${fmtQ(i.estoque_minimo)}. Recomenda-se realizar reposição.</span></li>`).join('')}</ul></section>` : '';
  const avisoPneus = d.estoque_baixo.length ? `<section class="bloco alerta"><h2>Pneus: reposição recomendada</h2><ul class="lista-medidas">${d.estoque_baixo.map((b) => `
    <li><span>Medida <strong>${esc(b.medida)}</strong> possui apenas ${b.total} unidade${b.total === 1 ? '' : 's'} no total (mínimo ${b.minimo}).</span>${barra(b.total, b.minimo)}</li>`).join('')}</ul></section>` : '';

  const card = (r, v, cor = '', sub = '') => `<div class="card ${cor}"><span>${r}<em style="font-style:normal">${sub}</em></span><b>${v}</b></div>`;
  const maxSerie = Math.max(1, ...d.serie.map((s) => Number(s.total)));
  const periodo = ini === fim ? dataBR(ini) : `${dataBR(ini)} a ${dataBR(fim)}`;
  const tabela = (cab, linhas, vazio) => linhas.length ? `<div class="rolagem"><table class="denso"><thead><tr>${cab.map((c) => `<th${c[1] ? ' class="n"' : ''}>${c[0]}</th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table></div>` : `<p class="vazio">${vazio}</p>`;

  $('#d-res').innerHTML = `${avisoCom}${avisoPagar}${avisoItens}${avisoPneus}
    <div class="cards-dia">
      ${card('Total vendido', brl(d.total_vendido), '', d.qtd_vendas + ' vendas')}
      ${card('Faturamento loja', brl(d.faturamento_loja), 'k-ciano', d.qtd_loja + ' vendas')}
      ${card('Faturamento atacado', brl(d.faturamento_atacado), 'k-ciano', d.qtd_atacado + ' vendas')}
      ${card('Ticket médio', brl(ticket))}
      ${card('Lucro estimado', brl(lucro), 'k-verde', 'vendas − custo dos pneus')}
      ${card('Entrada de mercadorias', brl(d.entradas_valor), '', d.entradas_qtd + ' entradas')}
      ${card('A pagar (pendente)', brl(d.pagar_pendente), 'k-alerta', d.pagar_vencidas_qtd ? d.pagar_vencidas_qtd + ' vencidas' : '')}
      ${card('Clientes devedores', brl(d.devedores_total), 'k-alerta', d.devedores_qtd + ' clientes')}
      ${card('Comissões pendentes', brl(pendTotal), 'k-alerta', 'mês atual: ' + brl(acumulado))}
      ${card('Pneus em estoque', Number(d.unidades_pneus).toLocaleString('pt-BR'), 'k-ciano', 'un.')}
      ${card('Valor do estoque de pneus', brl(d.valor_estoque_pneus), 'k-ciano', 'a custo')}
      ${card('Valor dos insumos', brl(d.valor_estoque_itens), 'k-ciano', 'fora do custo dos pneus')}
    </div>
    <p class="resumo-pag">Período: ${periodo}. O lucro estimado não desconta serviços, peças, comissões nem despesas, pois o custo deles não é cadastrado.</p>
    <section class="bloco"><h2>Total vendido por dia</h2>${d.serie.length ? `<div class="barras-caixa"><div class="barras">${d.serie.map((s) =>
      `<div class="b" style="height:${Math.max(2, Number(s.total) / maxSerie * 100).toFixed(1)}%" title="${dataBR(s.dia)}: ${brl(s.total)}"><span>${s.dia.slice(8)}</span></div>`).join('')}</div></div>` : '<p class="vazio">Sem vendas no período.</p>'}</section>
    <div class="grade">
      <div class="bloco"><h2>Vendas por vendedor</h2>${tabela([['Vendedor'], ['Vendas', 1], ['Total', 1]], d.por_vendedor.map((v) => `<tr><td>${esc(v.nome)}</td><td class="n">${v.qtd}</td><td class="n">${brl(v.total)}</td></tr>`), 'Sem vendas no período.')}</div>
      <div class="bloco"><h2>Produtos mais vendidos</h2>${tabela([['Medida'], ['Marca'], ['Un.', 1]], d.mais_vendidos.map((m) => `<tr><td>${esc(m.medida)}</td><td>${esc(m.marca)}</td><td class="n">${m.qtd}</td></tr>`), 'Sem vendas no período.')}</div>
      <div class="bloco"><h2>Próximas contas a pagar</h2>${tabela([['Vencimento'], ['Conta'], ['Valor', 1]], d.proximas_pagar.map((c) => `<tr><td>${dataBR(c.vencimento)}</td><td>${esc(c.descricao)}</td><td class="n">${brl(c.valor)}</td></tr>`), 'Nenhuma conta pendente.')}</div>
      <div class="bloco"><h2>Maiores devedores</h2>${tabela([['Cliente'], ['Saldo', 1]], d.top_devedores.map((c) => `<tr><td>${esc(c.nome)} ${c.vencida ? '<span class="chip atraso">em atraso</span>' : ''}</td><td class="n">${brl(c.saldo)}</td></tr>`), 'Nenhum cliente devendo.')}</div>
    </div>`;
}
