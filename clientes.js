import { sb, chamar } from '../supabase.js';
import { ehAdmin, state } from '../state.js';
import { $, esc, brl, num, fmtNum, dataBR, dataHora, nomeForma, abrirForm, confirmar, toast, debounce } from '../ui.js';
import { receber } from './fiado.js';

let lista = [], saldos = {}, busca = '', detalheId = null, raiz;

export async function render(root) {
  raiz = root;
  if (detalheId) return detalhe();
  const [c, s] = await Promise.all([
    chamar(sb.from('clientes').select('*').eq('ativo', true).order('nome')),
    chamar(sb.from('v_saldo_clientes').select('*')),
  ]);
  lista = c; saldos = Object.fromEntries(s.map((x) => [x.cliente_id, x]));
  if (!$('#tab-clientes', root)) {
    root.innerHTML = `<div class="barra-ferramentas"><label>Buscar<input id="f-busca" type="search" placeholder="Nome, telefone ou CPF/CNPJ" value="${esc(busca)}"></label>
      <button class="btn primario" id="novo">Novo cliente</button></div><div id="tab-clientes"></div>`;
    $('#f-busca').oninput = debounce((e) => { busca = e.target.value; tabela(); }, 150);
    $('#novo').onclick = () => formCliente();
  }
  tabela();
}
export const aoMudar = render;

function tabela() {
  const q = busca.toLowerCase();
  const l = lista.filter((c) => !q || `${c.nome} ${c.telefone || ''} ${c.cpf_cnpj || ''}`.toLowerCase().includes(q));
  $('#tab-clientes').innerHTML = l.length ? `<div class="bloco"><div class="rolagem"><table><thead><tr><th>Nome</th><th>Telefone</th><th>CPF/CNPJ</th><th>Tipo</th>${ehAdmin() ? '<th class="n">Saldo devedor</th>' : ''}</tr></thead><tbody>
    ${l.map((c) => { const s = saldos[c.id]; return `<tr data-ir="${c.id}"><td>${esc(c.nome)}</td><td>${esc(c.telefone)}</td><td>${esc(c.cpf_cnpj)}</td><td>${c.tipo === 'atacado' ? 'Atacado' : 'Varejo'}</td>
      ${ehAdmin() ? `<td class="n">${s ? `<strong class="neg">${brl(s.saldo)}</strong>` : '—'}</td>` : ''}</tr>`; }).join('')}</tbody></table></div></div>`
    : '<p class="vazio">Nenhum cliente encontrado.</p>';
  $('#tab-clientes').querySelectorAll('[data-ir]').forEach((tr) => (tr.onclick = () => { detalheId = tr.dataset.ir; detalhe(); }));
}

function formCliente(c) {
  abrirForm({
    titulo: c ? 'Editar cliente' : 'Novo cliente',
    corpo: `<label>Nome<input name="nome" required value="${esc(c?.nome)}"></label>
      <label>Telefone<input name="telefone" inputmode="tel" value="${esc(c?.telefone)}"></label>
      <label>CPF/CNPJ<input name="cpf_cnpj" value="${esc(c?.cpf_cnpj)}"></label>
      <label>Endereço<input name="endereco" value="${esc(c?.endereco)}"></label>
      <label>Tipo<select name="tipo"><option value="varejo">Varejo</option><option value="atacado"${c?.tipo === 'atacado' ? ' selected' : ''}>Atacado</option></select></label>
      <label>Observações<textarea name="observacoes" rows="3">${esc(c?.observacoes)}</textarea></label>`,
    async onSubmit(fd) {
      const campos = Object.fromEntries(['nome', 'telefone', 'cpf_cnpj', 'endereco', 'tipo', 'observacoes'].map((k) => [k, fd.get(k).trim() || null]));
      campos.tipo = fd.get('tipo');
      if (c) {
        const r = await chamar(sb.from('clientes').update(campos).eq('id', c.id).eq('versao', c.versao).select('id'));
        if (!r.length) throw new Error('Este cliente foi alterado em outro aparelho. Feche e abra de novo para ver os dados atuais.');
      } else await chamar(sb.from('clientes').insert(campos));
      toast('Cliente salvo'); state.recarregar?.();
    },
  });
}

async function detalhe() {
  const adm = ehAdmin();
  const [c, contas, pags, vendas, precos, produtos] = await Promise.all([
    chamar(sb.from('clientes').select('*').eq('id', detalheId).single()),
    chamar(sb.from('v_contas').select('*').eq('cliente_id', detalheId).order('criado_em')),
    chamar(sb.from('v_pagamentos_detalhe').select('*').eq('cliente_id', detalheId).order('recebido_em')),
    chamar(sb.from('vendas').select('numero, criado_em, total, status, a_prazo, tipo').eq('cliente_id', detalheId).order('criado_em', { ascending: false })),
    chamar(sb.from('precos_cliente').select('produto_id, preco, produtos(nome, preco_venda, medidas(descricao), marcas(nome))').eq('cliente_id', detalheId)),
    adm ? chamar(sb.from('produtos').select('id, nome, medidas(descricao), marcas(nome)').eq('ativo', true)) : [],
  ]);
  const mov = [
    ...contas.filter((x) => x.status !== 'cancelada').map((x) => ({ d: x.criado_em, t: `Compra a prazo — venda #${x.venda_numero}`, deb: Number(x.valor_total) })),
    ...pags.map((p) => ({ d: p.recebido_em, t: `Pagamento (${nomeForma(p.forma)}) — venda #${p.venda_numero}`, cred: Number(p.valor) })),
  ].sort((a, b) => new Date(a.d) - new Date(b.d));
  let saldo = 0;
  const abertas = contas.filter((x) => x.status === 'aberta' || x.status === 'parcial');
  const devido = abertas.reduce((s, x) => s + Number(x.saldo), 0);

  raiz.innerHTML = `
    <div class="cabeca"><div><button class="btn" id="voltar">Voltar</button><button class="btn" id="editar">Editar dados</button></div></div>
    <section class="bloco"><h2>${esc(c.nome)}</h2>
      <p>${[c.telefone, c.cpf_cnpj, c.endereco].filter(Boolean).map(esc).join(' · ') || 'Sem dados de contato'}</p>
      ${c.observacoes ? `<p>${esc(c.observacoes)}</p>` : ''}
      ${adm ? `<p>Saldo devedor atual: <strong class="${devido ? 'neg' : 'pos'}">${brl(devido)}</strong></p>` : ''}
      ${!adm ? '' : abertas.map((x) => `<button class="btn mini primario" data-rec="${x.id}">Receber venda #${x.venda_numero} (${brl(x.saldo)})</button> `).join('')}</section>
    <section class="bloco"><div class="cabeca"><h2>Preços personalizados</h2>${adm ? '<button class="btn mini" id="novo-preco">Definir preço</button>' : ''}</div>
      ${precos.length ? `<div class="rolagem"><table><thead><tr><th>Produto</th><th class="n">Preço padrão</th><th class="n">Preço do cliente</th><th></th></tr></thead><tbody>
        ${precos.map((p) => `<tr><td>${esc(p.produtos.medidas.descricao)} · ${esc(p.produtos.marcas.nome)} · ${esc(p.produtos.nome)}</td><td class="n">${brl(p.produtos.preco_venda)}</td><td class="n"><strong>${brl(p.preco)}</strong></td>
          <td class="acoes">${adm ? `<button class="btn mini" data-rmp="${p.produto_id}">Remover</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="vazio">Este cliente usa os preços padrão.</p>'}</section>
    ${adm ? `<section class="bloco"><h2>Extrato de fiado</h2>
      ${mov.length ? `<div class="rolagem"><table><thead><tr><th>Data</th><th>Descrição</th><th class="n">Compra</th><th class="n">Pagamento</th><th class="n">Saldo</th></tr></thead><tbody>
        ${mov.map((m) => { saldo += (m.deb || 0) - (m.cred || 0); return `<tr><td>${dataHora(m.d)}</td><td>${esc(m.t)}</td><td class="n">${m.deb ? brl(m.deb) : ''}</td><td class="n">${m.cred ? brl(m.cred) : ''}</td><td class="n">${brl(saldo)}</td></tr>`; }).join('')}</tbody></table></div>`
        : '<p class="vazio">Sem movimentações de fiado.</p>'}</section>` : ''}
    <section class="bloco"><h2>Histórico de compras</h2>
      ${vendas.length ? `<div class="rolagem"><table><thead><tr><th>Venda</th><th>Data</th><th>Condição</th><th class="n">Total</th></tr></thead><tbody>
        ${vendas.map((v) => `<tr><td>#${v.numero}</td><td>${dataHora(v.criado_em)}</td><td>${v.status === 'cancelada' ? '<span class="chip cancelada">Cancelada</span>' : v.a_prazo ? 'A prazo' : 'À vista'}</td><td class="n">${brl(v.total)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="vazio">Nenhuma compra registrada.</p>'}</section>`;

  $('#voltar').onclick = () => { detalheId = null; render(raiz); };
  $('#editar').onclick = () => formCliente(c);
  raiz.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => receber(abertas.find((x) => x.id === b.dataset.rec))));
  raiz.querySelectorAll('[data-rmp]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmar('Remover o preço personalizado deste produto?', { ok: 'Remover' }))) return;
    try { await chamar(sb.from('precos_cliente').delete().eq('cliente_id', c.id).eq('produto_id', b.dataset.rmp)); toast('Preço removido'); detalhe(); }
    catch (e) { toast(e.message, 'erro'); }
  }));
  $('#novo-preco')?.addEventListener('click', () => abrirForm({
    titulo: 'Preço personalizado',
    corpo: `<label>Produto<select name="produto">${produtos.sort((a, b) => a.medidas.descricao.localeCompare(b.medidas.descricao, 'pt-BR', { numeric: true }))
      .map((p) => `<option value="${p.id}">${esc(p.medidas.descricao)} · ${esc(p.marcas.nome)} · ${esc(p.nome)}</option>`).join('')}</select></label>
      <label>Preço para ${esc(c.nome)} (R$)<input name="preco" inputmode="decimal" required></label>`,
    async onSubmit(fd) {
      const preco = num(fd.get('preco'));
      if (!(preco >= 0)) throw new Error('Informe um preço válido.');
      await chamar(sb.from('precos_cliente').upsert({ cliente_id: c.id, produto_id: fd.get('produto'), preco }, { onConflict: 'cliente_id,produto_id' }));
      toast('Preço salvo'); detalhe();
    },
  }));
}
