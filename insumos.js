import { sb, chamar } from '../supabase.js';
import { $, esc, brl, num, fmtNum, abrirForm, confirmar, toast, debounce } from '../ui.js';

const CATEGORIAS = ['Óleo', 'Bicos', 'Filtro de motor', 'Filtro de ar', 'Filtro de ar-condicionado', 'Outros'];
const fmtQ = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const baixo = (i) => Number(i.estoque_minimo) > 0 && Number(i.quantidade) <= Number(i.estoque_minimo);
let itens = [], busca = '', raiz;

export async function render(root) {
  raiz = root;
  itens = await chamar(sb.from('itens_complementares').select('*').eq('ativo', true).order('categoria').order('nome'));
  if (!$('#i-lista', root)) {
    root.innerHTML = `<div class="barra-ferramentas"><label>Buscar<input id="i-q" type="search" placeholder="Nome ou categoria" value="${esc(busca)}"></label>
      <button class="btn primario" id="i-novo">Novo item</button></div><div id="i-alerta"></div><div id="i-lista"></div>`;
    $('#i-q').oninput = debounce((e) => { busca = e.target.value; pintar(); }, 150);
    $('#i-novo').onclick = () => form();
    $('#i-lista').onclick = acao;
  }
  pintar();
}
export const aoMudar = render;

function pintar() {
  const q = busca.toLowerCase(), l = itens.filter((i) => !q || `${i.nome} ${i.categoria}`.toLowerCase().includes(q));
  const repor = itens.filter(baixo);
  $('#i-alerta').innerHTML = repor.length ? `<section class="bloco alerta"><h2>Reposição necessária</h2><ul class="lista-medidas">${repor.map((i) =>
    `<li><span><strong>${esc(i.nome)}</strong>: ${fmtQ(i.quantidade)} ${esc(i.unidade)} em estoque, mínimo ${fmtQ(i.estoque_minimo)}. Recomenda-se realizar reposição.</span></li>`).join('')}</ul></section>` : '';
  const grupos = new Map();
  for (const i of l) { if (!grupos.has(i.categoria)) grupos.set(i.categoria, []); grupos.get(i.categoria).push(i); }
  $('#i-lista').innerHTML = grupos.size ? [...grupos].map(([cat, ls]) => `<section class="medida"><header><h2>${esc(cat)}</h2></header><div class="rolagem"><table><thead><tr>
      <th>Item</th><th class="n">Em estoque</th><th class="n">Mínimo</th><th>Situação</th><th class="n">Custo un.</th><th></th></tr></thead><tbody>
      ${ls.map((i) => `<tr data-id="${i.id}"><td>${esc(i.nome)}</td><td class="n">${fmtQ(i.quantidade)} ${esc(i.unidade)}</td><td class="n">${fmtQ(i.estoque_minimo)}</td>
        <td>${baixo(i) ? '<span class="chip baixo">Repor</span>' : '<span class="chip">Ok</span>'}</td><td class="n">${brl(i.custo_unitario)}</td>
        <td class="acoes"><button class="btn mini" data-a="ajuste">Entrada/ajuste</button><button class="btn mini" data-a="editar">Editar</button><button class="btn mini" data-a="excluir">Excluir</button></td></tr>`).join('')}</tbody></table></div></section>`).join('')
    : '<p class="vazio">Nenhum item cadastrado. Use "Novo item" para começar (óleo, bicos, filtros…).</p>';
}

function acao(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const i = itens.find((x) => x.id === b.closest('tr').dataset.id);
  if (b.dataset.a === 'editar') form(i);
  if (b.dataset.a === 'ajuste') ajuste(i);
  if (b.dataset.a === 'excluir') excluir(i);
}

function form(i) {
  abrirForm({
    titulo: i ? 'Editar item' : 'Novo item',
    corpo: `<label>Nome<input name="nome" required value="${esc(i?.nome)}" placeholder="Ex.: Óleo 5W30"></label>
      <label>Categoria<input name="categoria" list="dl-cat" required value="${esc(i?.categoria || '')}"></label>
      <datalist id="dl-cat">${CATEGORIAS.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <label>Unidade (un, litro, caixa…)<input name="unidade" required value="${esc(i?.unidade || 'un')}"></label>
      ${i ? '' : '<label>Quantidade inicial<input name="qtd" inputmode="decimal" value="0"></label>'}
      <label>Estoque mínimo (alerta de reposição)<input name="min" inputmode="decimal" required value="${i ? fmtNum(i.estoque_minimo) : ''}"></label>
      <label>Custo unitário (R$, só informativo)<input name="custo" inputmode="decimal" value="${i ? fmtNum(i.custo_unitario) : ''}"></label>`,
    async onSubmit(fd) {
      const min = num(fd.get('min')), custo = fd.get('custo').trim() ? num(fd.get('custo')) : 0;
      if (!(min >= 0) || !(custo >= 0)) throw new Error('Confira o estoque mínimo e o custo.');
      const campos = { nome: fd.get('nome').trim(), categoria: fd.get('categoria').trim(), unidade: fd.get('unidade').trim(), estoque_minimo: min, custo_unitario: custo };
      if (i) {
        const r = await chamar(sb.from('itens_complementares').update(campos).eq('id', i.id).eq('versao', i.versao).select('id'));
        if (!r.length) throw new Error('Este item foi alterado em outro aparelho. Feche e abra de novo.');
      } else {
        const q = num(fd.get('qtd')); await chamar(sb.from('itens_complementares').insert({ ...campos, quantidade: q >= 0 ? q : 0 }));
      }
      toast('Item salvo'); await render(raiz);
    },
  });
}

function ajuste(i) {
  abrirForm({
    titulo: `Entrada/ajuste — ${i.nome}`, ok: 'Registrar',
    corpo: `<p>Estoque atual: <strong>${fmtQ(i.quantidade)} ${esc(i.unidade)}</strong></p>
      <label>Quantidade (+ entrada, − saída ou uso)<input name="delta" inputmode="decimal" required placeholder="Ex.: 10 ou -2"></label>
      <label>Motivo<input name="motivo" required placeholder="Ex.: compra, uso na oficina, contagem"></label>`,
    async onSubmit(fd) {
      const delta = num(fd.get('delta'));
      if (!Number.isFinite(delta) || delta === 0) throw new Error('Informe uma quantidade diferente de zero.');
      await chamar(sb.rpc('ajustar_item', { p_item: i.id, p_delta: delta, p_motivo: fd.get('motivo').trim() }));
      toast('Estoque atualizado'); await render(raiz);
    },
  });
}

async function excluir(i) {
  if (!(await confirmar(`Excluir "${i.nome}"? O histórico é mantido.`))) return;
  try { await chamar(sb.from('itens_complementares').update({ ativo: false }).eq('id', i.id)); toast('Item excluído'); await render(raiz); }
  catch (e) { toast(e.message, 'erro'); }
}
