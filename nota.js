import { sb, chamar } from '../supabase.js';
import { esc, brl, dataHora, dataBR } from '../ui.js';

const STATUS = { pago: 'Pago', pendente: 'Pendente', parcial: 'Parcialmente pago' };
const FORMA = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_debito: 'Débito', cartao_credito: 'Crédito', boleto: 'Boleto' };

export function carregarVenda(id) {
  return chamar(sb.from('vendas').select(`*, clientes(nome, cpf_cnpj, telefone, endereco),
    itens_venda(produto_id, quantidade, preco_unitario, produtos(nome, medidas(descricao), marcas(nome))),
    venda_pagamentos(forma, valor, parcelas), venda_boletos(parcela, vencimento, valor), trocas(medida, descricao, estado, valor, abatido, observacoes)`).eq('id', id).single());
}

// Abre a janela na hora do clique (senão o navegador bloqueia) e preenche depois.
export function abrirJanelaNota() {
  const w = window.open('', '_blank');
  if (!w) throw new Error('O navegador bloqueou a janela da nota. Permita pop-ups para este site e tente de novo.');
  w.document.write('<p style="font-family:sans-serif;padding:1rem">Gerando nota…</p>');
  return w;
}

export async function imprimirNota(id, janela) {
  const w = janela || abrirJanelaNota();
  try {
    const [v, cfg] = await Promise.all([carregarVenda(id), chamar(sb.from('configuracoes').select('valor').eq('chave', 'empresa').maybeSingle())]);
    w.document.open(); w.document.write(html(v, cfg?.valor || {})); w.document.close();
    w.focus(); setTimeout(() => w.print(), 500);
  } catch (e) { w.close(); throw e; }
}

function linhas(v) {
  const L = [];
  for (const i of v.itens_venda) {
    const p = i.produtos;
    L.push([`Pneu ${p.medidas.descricao} — ${p.marcas.nome}${p.nome ? ' ' + p.nome : ''}`, i.quantidade, Number(i.preco_unitario), i.quantidade * i.preco_unitario]);
  }
  const extra = (nome, q, val) => { val = Number(val); if (val > 0) { const n = Number(q) > 0 ? Number(q) : 1; L.push([nome, n, val / n, val]); } };
  extra('Alinhamento', v.alinhamento_qtd, v.alinhamento_valor);
  extra('Bico/Válvulas', v.bicos_qtd, v.bicos_valor);
  extra('Cambagem', v.cambagem_qtd, v.cambagem_valor);
  extra('Rodas', v.rodas_qtd, v.rodas_valor);
  extra('Peças', 0, v.pecas_valor);
  extra('Serviços', 0, v.servicos_valor);
  return L;
}

function html(v, e) {
  const L = linhas(v), bruto = L.reduce((s, l) => s + l[3], 0), c = v.clientes;
  const totalPneus = v.itens_venda.reduce((s, i) => s + Number(i.quantidade || 0), 0);   // só pneus (sem serviços)
  const confere = v.tipo === 'atacado';                                                 // pedido do atacado: total para conferência
  const pags = v.venda_pagamentos.map((p) => `${FORMA[p.forma] || p.forma}${p.parcelas > 1 ? ' ' + p.parcelas + 'x' : ''}: ${brl(p.valor)}`).join(' · ');
  const bols = [...v.venda_boletos].sort((a, b) => a.parcela - b.parcela)
    .map((b) => `Boleto ${b.parcela}/${v.venda_boletos.length} — vence em ${dataBR(b.vencimento)} — ${brl(b.valor)}`);
  const logo = typeof e.logo === 'string' && e.logo.startsWith('data:image/') ? `<img src="${esc(e.logo)}" alt="" class="logo">` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Nota de venda #${v.numero}</title><style>
    *{box-sizing:border-box}body{font:13px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:0;padding:28px}
    .topo{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #111;padding-bottom:14px}
    .logo{max-height:64px;max-width:180px;display:block;margin-bottom:6px}
    h1{font-size:18px;margin:0 0 4px}.sm{font-size:12px;color:#333}
    .nota{text-align:right}.nota b{font-size:20px;display:block}
    .cli{border:1px solid #ccc;border-radius:6px;padding:10px 14px;margin:16px 0}.cli small{color:#555;text-transform:uppercase;font-size:11px}
    table{width:100%;border-collapse:collapse}th{background:#1b1b1b;color:#fff;text-align:left;font-size:11px;text-transform:uppercase;padding:8px}
    td{padding:8px;border-bottom:1px solid #ddd}.n{text-align:right}
    .tot{margin:14px 0 0 auto;width:300px}.tot div{display:flex;justify-content:space-between;padding:3px 0}
    .tot .g{border-top:2px solid #111;margin-top:6px;padding-top:8px;font-size:15px;font-weight:bold}
    .conf{margin:14px 0 0;border:2px solid #111;border-radius:6px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;font-size:15px;font-weight:bold}
    .conf b{font-size:24px}.conf small{display:block;font-weight:normal;font-size:11px;color:#444}
    .pg{margin-top:18px}.pg small{display:block;color:#444;margin-top:3px}
    @media print{body{padding:0}}
  </style></head><body>
  <div class="topo"><div>${logo}<h1>${esc(e.nome || 'Minha empresa')}</h1>
    <div class="sm">${[e.telefone, e.cnpj && 'CNPJ: ' + e.cnpj].filter(Boolean).map(esc).join(' · ')}</div>
    <div class="sm">${esc(e.endereco || '')}</div><div class="sm">${esc(e.info || '')}</div></div>
    <div class="nota"><b>NOTA #${v.numero}</b><span class="sm">EMITIDO EM: ${esc(dataHora(v.criado_em))}</span></div></div>
  ${c ? `<div class="cli"><small>Cliente</small><br><b>${esc(c.nome)}</b>${c.cpf_cnpj ? '<br>CPF/CNPJ: ' + esc(c.cpf_cnpj) : ''}${c.telefone ? '<br>' + esc(c.telefone) : ''}${c.endereco ? '<br>' + esc(c.endereco) : ''}</div>` : '<div style="height:16px"></div>'}
  <table><thead><tr><th>Descrição</th><th class="n">Quantidade</th><th class="n">Valor unitário</th><th class="n">Total</th></tr></thead><tbody>
    ${L.map((l) => `<tr><td>${esc(l[0])}</td><td class="n">${l[1]}</td><td class="n">${brl(l[2])}</td><td class="n">${brl(l[3])}</td></tr>`).join('')}</tbody></table>
  ${confere ? `<div class="conf"><span>TOTAL DE PNEUS DO PEDIDO<small>Quantidade para conferência na entrega</small></span><b>${totalPneus} un.</b></div>` : ''}
  <div class="tot"><div><span>Total produtos e serviços</span><span>${brl(bruto)}</span></div>
    <div><span>Desconto</span><span>${brl(v.desconto_total)}</span></div>
    ${Number(v.troca_total) > 0 ? `<div><span>Abatimento (base de troca)</span><span>${brl(v.troca_total)}</span></div>` : ''}
    <div class="g"><span>TOTAL VENDA</span><span>${brl(v.total)}</span></div></div>
  <div class="pg">Forma de pagamento: <b>${esc(v.forma_resumo || '')}</b> · ${esc(STATUS[v.status_pagamento] || '')}
    ${pags ? `<small>${esc(pags)}</small>` : ''}${bols.map((b) => `<small>${esc(b)}</small>`).join('')}</div>
  </body></html>`;
}
