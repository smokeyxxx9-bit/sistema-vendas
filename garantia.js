import { sb, chamar } from '../supabase.js';
import { esc, dataHora, abrirModal, toast, $ } from '../ui.js';
import { carregarVenda, abrirJanelaNota } from './nota.js';

// Texto do termo igual ao do sistema antigo (index.html): seminovos = 3 anos, novos = 5 anos.
const EXCLUSOES = `<p><b>Exclusões da Garantia (Avarias Acidentais):</b> A garantia cobre exclusivamente defeitos de estrutura/fabricação e no conserto. <b>*GARANTIA NÃO É SEGURO*</b>.<br>Não possuem cobertura danos decorrentes de uso, acidentes ou fatores externos, tais como:</p>
  <ul><li>Pneus cortados, furados ou rasgados;</li><li>Bolhas ou deformações causadas por impacto em buracos, meio-fio ou obstáculos;</li><li>Danos causados por rodar sem pressão de ar, suspensão danificada ou falta de alinhamento.</li></ul>`;
const DEVOLUCAO = `<p><b>Políticas de devolução:</b> quaisquer produtos comprados <i>PRESENCIALMENTE EM LOJA FÍSICA</i> com a opção de escolha e análise por conta própria, não se aplica o direto de devolução por insatisfação. Conforme o código de direito do consumidor art.18 nossa empresa tem o dever de resolver o problema em até 30 dias corridos, após esse período, aí sim o cliente tem o seu direito de ter os valores ressarcidos integralmente.</p>`;

function termo(novos, cobertura, obs) {
  const corpo = novos
    ? `<h3>TERMO DE GARANTIA - PNEUS NOVOS</h3>${cobertura}
       <p><b>Cobertura:</b> A garantia para pneus novos é de <b>5 anos</b> a partir da data da compra ou até o desgaste total da banda de rodagem (atingir o indicador TWI/pneu alisar), o que ocorrer primeiro.</p>
       ${EXCLUSOES}<p class="alerta">GARANTIA DE 5 ANOS PARA PNEUS NOVOS.</p>
       <p>A lei nos obriga a dar garantia legal de 90 dias corridos, mas por consideração ao nosso cliente e confiança dos nossos produtos fornecemos garantia de 5 anos depois da data de compra.</p>${DEVOLUCAO}${obs}`
    : `<h3>TERMO DE GARANTIA - PNEUS SEMINOVOS</h3>${cobertura}
       <p><b>Cobertura:</b> A garantia para pneus seminovos é de 3 anos a partir da data da compra ou até o desgaste total da banda de rodagem (atingir o indicador TWI/pneu alisar), o que ocorrer primeiro.</p>
       ${EXCLUSOES}<p class="alerta">VOCÊ COMPROU PNEU USADO, TENHA CONSCIÊNCIA.</p>
       <p>A lei nos obriga a dar garantia em relação a qualquer produto usado de 90 dias corridos, mas por consideração ao nosso cliente e confiança dos nossos produtos fornecemos garantia de 3 anos depois da data de compra.</p>${DEVOLUCAO}${obs}`;
  return `<div class="garantia-box">${corpo}<div class="assinatura">Assinatura do cliente:</div></div>`;
}

function html(v, e, novos) {
  const c = v.clientes;
  const linhas = v.itens_venda.map((i) => `${i.quantidade}x ${esc(i.produtos.medidas.descricao)} — ${esc(i.produtos.marcas.nome)}${i.produtos.nome ? ' ' + esc(i.produtos.nome) : ''}`);
  const cobertura = linhas.length ? `<p style="text-align:center;font-size:12.5px"><b>Pneu(s) coberto(s) por esta garantia:</b><br>${linhas.join('<br>')}</p>` : '';
  const obs = v.observacoes ? `<p><b>Observações desta venda:</b> ${esc(v.observacoes).replace(/\n/g, '<br>')}</p>` : '';
  const logo = typeof e.logo === 'string' && e.logo.startsWith('data:image/') ? `<img src="${esc(e.logo)}" alt="" class="logo">` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Garantia — nota #${v.numero}</title><style>
    *{box-sizing:border-box}body{font:13px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:0;padding:28px}
    .topo{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #111;padding-bottom:14px}
    .logo{max-height:64px;max-width:180px;display:block;margin-bottom:6px}
    h1{font-size:18px;margin:0 0 4px}.sm{font-size:12px;color:#333}
    .nota{text-align:right}.nota b{font-size:20px;display:block}
    .cli{border:1px solid #ccc;border-radius:6px;padding:10px 14px;margin:16px 0}.cli small{color:#555;text-transform:uppercase;font-size:11px}
    .garantia-box{margin-top:18px;border:1px solid #1a1a1a;padding:12px 14px;border-radius:4px;font-size:11px;line-height:1.45;color:#222}
    .garantia-box h3{margin:0 0 8px;font-size:12px;text-align:center;text-transform:uppercase;border-bottom:1px solid #ccc;padding-bottom:4px}
    .garantia-box ul{margin:4px 0 8px;padding-left:18px}.garantia-box li{margin-bottom:2px}
    .garantia-box .alerta{font-weight:bold;margin:8px 0;text-align:center}
    .garantia-box .assinatura{margin-top:34px;border-top:1px solid #1a1a1a;width:60%;margin-left:auto;margin-right:auto;text-align:center;padding-top:4px}
    @media print{body{padding:0 12px}}
  </style></head><body>
  <div class="topo"><div>${logo}<h1>${esc(e.nome || 'Minha empresa')}</h1>
    <div class="sm">${[e.telefone, e.cnpj && 'CNPJ: ' + e.cnpj].filter(Boolean).map(esc).join(' · ')}</div>
    <div class="sm">${esc(e.endereco || '')}</div></div>
    <div class="nota"><b>GARANTIA · NOTA #${v.numero}</b><span class="sm">DATA DA COMPRA: ${esc(dataHora(v.criado_em))}</span></div></div>
  ${c ? `<div class="cli"><small>Cliente</small><br><b>${esc(c.nome)}</b>${c.cpf_cnpj ? '<br>CPF/CNPJ: ' + esc(c.cpf_cnpj) : ''}${c.telefone ? '<br>' + esc(c.telefone) : ''}${c.endereco ? '<br>' + esc(c.endereco) : ''}</div>` : '<div style="height:16px"></div>'}
  ${termo(novos, cobertura, obs)}
  </body></html>`;
}

async function gerar(id, novos, janela) {
  try {
    const [v, cfg] = await Promise.all([carregarVenda(id), chamar(sb.from('configuracoes').select('valor').eq('chave', 'empresa').maybeSingle())]);
    janela.document.open(); janela.document.write(html(v, cfg?.valor || {}, novos)); janela.document.close();
    janela.focus(); setTimeout(() => janela.print(), 500);
  } catch (e) { janela.close(); throw e; }
}

// Pergunta se os pneus são novos (5 anos) ou seminovos (3 anos) e imprime a folha de garantia da venda.
// A janela é aberta no clique do botão (senão o navegador bloqueia o pop-up).
export function imprimirGarantia(id) {
  const ultimo = localStorage.getItem('garantia_tipo') || 'seminovos';
  const m = abrirModal({
    titulo: 'Imprimir folha de garantia', corpo: `<p>Escolha o tipo de pneu desta venda. O prazo do termo muda conforme a escolha.</p>
      <div class="dlg-acoes" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn" id="ga-x" type="button">Cancelar</button>
      <button class="btn${ultimo === 'seminovos' ? ' primario' : ''}" id="ga-s" type="button">Seminovos · 3 anos</button>
      <button class="btn${ultimo === 'novos' ? ' primario' : ''}" id="ga-n" type="button">Novos · 5 anos</button></div>` });
  $('#ga-x', m.dlg).onclick = m.fechar;
  const escolher = (novos) => () => {
    let w;
    try { w = abrirJanelaNota(); } catch (e) { toast(e.message, 'erro'); return; }
    localStorage.setItem('garantia_tipo', novos ? 'novos' : 'seminovos');
    m.fechar();
    gerar(id, novos, w).catch((e) => toast(e.message, 'erro'));
  };
  $('#ga-s', m.dlg).onclick = escolher(false);
  $('#ga-n', m.dlg).onclick = escolher(true);
}
