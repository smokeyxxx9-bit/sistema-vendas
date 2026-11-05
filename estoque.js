import { sb, chamar } from '../supabase.js';
import { ehAdmin, ehCliente } from '../state.js';
import { $, esc, brl, num, fmtNum, barra, abrirForm, confirmar, toast, debounce } from '../ui.js';

let dados = { prods: [], resumo: [], medidas: [], marcas: [] };
const filtro = { q: '', medida: '', marca: '' };
let raiz, margemPadrao = 50;   // % sobre o custo; vem de Ajustes

export async function render(root) {
  if (ehCliente()) return renderCliente(root);
  raiz = root;
  const [prods, resumo, medidas, marcas, cfgMargem] = await Promise.all([
    chamar(sb.from('produtos').select('*, medidas(descricao), marcas(nome)').eq('ativo', true)),
    chamar(sb.from('v_estoque_medida').select('*')),
    chamar(sb.from('medidas').select('id, descricao').eq('ativo', true).order('descricao')),
    chamar(sb.from('marcas').select('id, nome').eq('ativo', true).order('nome')),
    chamar(sb.from('configuracoes').select('valor').eq('chave', 'margem_padrao').maybeSingle()),
  ]);
  const m = Number(cfgMargem?.valor);
  margemPadrao = Number.isFinite(m) ? m : 50;
  dados = { prods, resumo, medidas, marcas };
  if (!$('#lista-estoque', root)) {
    root.innerHTML = `<div class="barra-ferramentas">
      <label>Buscar<input id="f-q" type="search" placeholder="Medida, marca ou nome" value="${esc(filtro.q)}"></label>
      <label>Medida<select id="f-medida"></select></label>
      <label>Marca<select id="f-marca"></select></label>
      ${ehAdmin() ? '<button class="btn primario" id="novo">Novo produto</button>' : ''}</div>
      <div id="lista-estoque"></div>`;
    $('#f-q').oninput = debounce((e) => { filtro.q = e.target.value; lista(); }, 150);
    $('#f-medida').onchange = (e) => { filtro.medida = e.target.value; lista(); };
    $('#f-marca').onchange = (e) => { filtro.marca = e.target.value; lista(); };
    $('#novo')?.addEventListener('click', () => formProduto());
    $('#lista-estoque').onclick = acao;
  }
  $('#f-medida').innerHTML = '<option value="">Todas</option>' + medidas.map((m) => `<option value="${m.id}"${m.id === filtro.medida ? ' selected' : ''}>${esc(m.descricao)}</option>`).join('');
  $('#f-marca').innerHTML = '<option value="">Todas</option>' + marcas.map((m) => `<option value="${m.id}"${m.id === filtro.marca ? ' selected' : ''}>${esc(m.nome)}</option>`).join('');
  lista();
}
export const aoMudar = render;

function lista() {
  const q = filtro.q.toLowerCase(), grupos = new Map();
  for (const p of dados.prods) {
    if (filtro.medida && p.medida_id !== filtro.medida) continue;
    if (filtro.marca && p.marca_id !== filtro.marca) continue;
    if (q && !`${p.medidas.descricao} ${p.marcas.nome} ${p.nome} ${p.categoria || ''}`.toLowerCase().includes(q)) continue;
    if (!grupos.has(p.medida_id)) grupos.set(p.medida_id, []);
    grupos.get(p.medida_id).push(p);
  }
  const adm = ehAdmin();
  const html = [...grupos.entries()]
    .map(([id, ps]) => ({ r: dados.resumo.find((x) => x.medida_id === id), ps }))
    .sort((a, b) => (a.ps[0].medidas.descricao).localeCompare(b.ps[0].medidas.descricao, 'pt-BR', { numeric: true }))
    .map(({ r, ps }) => `<section class="medida"><header>
        <h2>${esc(ps[0].medidas.descricao)}</h2>
        <span class="total">${r?.total ?? 0} un. no total</span>
        <span>${r?.baixo ? `<span class="chip baixo">Estoque baixo (mínimo ${r.minimo})</span>` : `<span class="chip">Mínimo ${r?.minimo ?? '-'}</span>`}</span>
        ${r ? barra(r.total, r.minimo) : ''}</header>
      <div class="rolagem"><table><thead><tr><th>Marca</th><th>Produto</th><th class="n">Qtd.</th>${adm ? '<th class="n">Custo</th>' : ''}<th class="n">Venda</th>${adm ? '<th></th>' : ''}</tr></thead><tbody>
      ${ps.sort((a, b) => a.marcas.nome.localeCompare(b.marcas.nome)).map((p) => `<tr data-id="${p.id}">
        <td>${esc(p.marcas.nome)}</td><td>${esc(p.nome)}</td><td class="n">${p.quantidade}</td>${adm ? `<td class="n">${brl(p.preco_custo)}</td>` : ''}<td class="n">${brl(p.preco_venda)}</td>
        ${adm ? `<td class="acoes"><button class="btn mini" data-a="ajuste">Entrada/ajuste</button><button class="btn mini" data-a="editar">Editar</button><button class="btn mini" data-a="excluir">Excluir</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div></section>`).join('');
  $('#lista-estoque').innerHTML = html || '<p class="vazio">Nenhum produto encontrado.</p>';
}

function acao(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const p = dados.prods.find((x) => x.id === b.closest('tr').dataset.id);
  if (b.dataset.a === 'editar') formProduto(p);
  if (b.dataset.a === 'ajuste') formAjuste(p);
  if (b.dataset.a === 'excluir') excluir(p);
}

async function obter(tabela, campo, valor) {
  const ex = await chamar(sb.from(tabela).select('id').ilike(campo, valor.replace(/[%_\\]/g, '\\$&')).limit(1));
  if (ex.length) return ex[0].id;
  return (await chamar(sb.from(tabela).insert({ [campo]: valor }).select('id').single())).id;
}

function formProduto(p) {
  const f = abrirForm({
    titulo: p ? 'Editar produto' : 'Novo produto',
    corpo: `
      <label>Nome do produto<input name="nome" required value="${esc(p?.nome)}" placeholder="Ex.: Pilot Sport"></label>
      <label>Medida<input name="medida" list="dl-medidas" required value="${esc(p?.medidas.descricao)}" placeholder="205/55R16"></label>
      <label>Marca<input name="marca" list="dl-marcas" required value="${esc(p?.marcas.nome)}"></label>
      <label>Categoria (opcional)<input name="categoria" value="${esc(p?.categoria)}"></label>
      ${p ? '' : '<label>Quantidade inicial<input name="qtd" type="number" min="0" step="1" value="0"></label>'}
      <label>Preço de custo (R$)<input name="custo" inputmode="decimal" required value="${p ? fmtNum(p.preco_custo) : ''}"></label>
      <label>Preço de venda padrão (R$)<input name="venda" inputmode="decimal" required value="${p ? fmtNum(p.preco_venda) : ''}"></label>
      <label>Margem de lucro sobre o custo (%)<input name="margem" inputmode="decimal" value="${margemInicial(p)}"></label>
      <datalist id="dl-medidas">${dados.medidas.map((m) => `<option value="${esc(m.descricao)}">`).join('')}</datalist>
      <datalist id="dl-marcas">${dados.marcas.map((m) => `<option value="${esc(m.nome)}">`).join('')}</datalist>`,
    async onSubmit(fd) {
      const custo = num(fd.get('custo')), venda = num(fd.get('venda'));
      if (!(custo >= 0) || !(venda >= 0)) throw new Error('Informe preços válidos.');
      const medida = fd.get('medida').trim().toUpperCase().replace(/\s+/g, '');
      const campos = {
        nome: fd.get('nome').trim(), categoria: fd.get('categoria').trim() || null, preco_custo: custo, preco_venda: venda,
        medida_id: await obter('medidas', 'descricao', medida), marca_id: await obter('marcas', 'nome', fd.get('marca').trim().replace(/\s+/g, ' ')),
      };
      if (p) {
        // trava otimista: só grava se ninguém alterou o produto desde que você abriu o formulário
        const r = await chamar(sb.from('produtos').update(campos).eq('id', p.id).eq('versao', p.versao).select('id'));
        if (!r.length) throw new Error('Este produto foi alterado em outro aparelho. Feche e abra de novo para ver os dados atuais.');
      } else {
        await chamar(sb.from('produtos').insert({ ...campos, quantidade: parseInt(fd.get('qtd'), 10) || 0 }));
      }
      toast('Produto salvo'); await render(raiz);
    },
  });
  ligarMargem(f);
}

function margemInicial(p) {
  if (p && p.preco_custo > 0) return fmtNum((p.preco_venda / p.preco_custo - 1) * 100);
  return String(margemPadrao).replace('.', ',');
}

// Custo ou margem mudam => recalcula o preço de venda. Preço de venda mudado à mão => recalcula a margem.
function ligarMargem(f) {
  const { custo, venda, margem } = f.elements;
  const calcularVenda = () => {
    const c = num(custo.value), m = num(margem.value);
    if (c >= 0 && Number.isFinite(m)) venda.value = fmtNum(Math.round(c * (1 + m / 100) * 100) / 100);
  };
  custo.addEventListener('input', calcularVenda);
  margem.addEventListener('input', calcularVenda);
  venda.addEventListener('input', () => {
    const c = num(custo.value), v = num(venda.value);
    if (c > 0 && v >= 0) margem.value = fmtNum((v / c - 1) * 100);
  });
}

function formAjuste(p) {
  abrirForm({
    titulo: `Entrada/ajuste — ${p.medidas.descricao} ${p.marcas.nome}`,
    corpo: `<p>Estoque atual: <strong>${p.quantidade}</strong> un.</p>
      <label>Quantidade (use + para entrada, − para saída ou perda)<input name="delta" type="number" step="1" required placeholder="Ex.: 10 ou -2"></label>
      <label>Motivo<input name="motivo" required placeholder="Ex.: compra do fornecedor, contagem, avaria"></label>`,
    ok: 'Registrar',
    async onSubmit(fd) {
      await chamar(sb.rpc('ajustar_estoque', { p_produto: p.id, p_delta: parseInt(fd.get('delta'), 10), p_motivo: fd.get('motivo').trim() }));
      toast('Estoque atualizado'); await render(raiz);
    },
  });
}

async function excluir(p) {
  if (!(await confirmar(`Excluir ${p.medidas.descricao} ${p.marcas.nome} (${p.nome})? O histórico de vendas é mantido.`))) return;
  try { await chamar(sb.from('produtos').update({ ativo: false }).eq('id', p.id)); toast('Produto excluído'); await render(raiz); }
  catch (e) { toast(e.message, 'erro'); }
}

// Perfil Cliente: só quantidade, medida, marca, modelo e o preço dele. Os dados vêm de uma função do banco que nunca devolve custo.
let linhasCliente = [];
async function renderCliente(root) {
  linhasCliente = await chamar(sb.rpc('estoque_cliente'));
  if (!$('#c-lista', root)) {
    root.innerHTML = '<div class="barra-ferramentas"><label>Buscar<input id="c-q" type="search" placeholder="Medida, marca ou modelo"></label></div><div id="c-lista"></div>';
    $('#c-q').oninput = debounce(pintarCliente, 150);
  }
  pintarCliente();
}
function pintarCliente() {
  const q = ($('#c-q')?.value || '').toLowerCase();
  const l = linhasCliente.filter((x) => !q || `${x.medida} ${x.marca} ${x.modelo}`.toLowerCase().includes(q));
  $('#c-lista').innerHTML = l.length ? `<div class="bloco"><div class="rolagem"><table><thead><tr><th>Medida</th><th>Marca</th><th>Modelo</th><th class="n">Em estoque</th><th class="n">Preço</th></tr></thead><tbody>
    ${l.map((x) => `<tr><td>${esc(x.medida)}</td><td>${esc(x.marca)}</td><td>${esc(x.modelo)}</td><td class="n">${x.quantidade > 0 ? x.quantidade : '<span class="neg">Sem estoque</span>'}</td><td class="n">${brl(x.preco)}</td></tr>`).join('')}</tbody></table></div></div>`
    : '<p class="vazio">Nenhum pneu encontrado.</p>';
}
