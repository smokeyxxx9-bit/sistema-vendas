import { sb, chamar } from '../supabase.js';
import { $, esc, brl, num, fmtNum, hoje, dataBR, FORMAS, opcoes, abrirForm, confirmar, toast, debounce } from '../ui.js';

const CATEGORIAS = ['Mercadoria', 'Aluguel', 'Energia', 'Água', 'Internet', 'Impostos', 'Salários', 'Manutenção', 'Outros'];
let contas = [], filtro = 'pendente', busca = '', raiz;

const addMeses = (iso, n) => {
  const d = new Date(iso + 'T12:00:00'), dia = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(dia, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.toLocaleDateString('sv-SE');
};

export async function render(root) {
  raiz = root;
  const [pend, pagas] = await Promise.all([
    chamar(sb.from('contas_pagar').select('*').eq('status', 'pendente').order('vencimento')),
    chamar(sb.from('contas_pagar').select('*').eq('status', 'pago').order('pago_em', { ascending: false }).limit(200)),
  ]);
  contas = [...pend, ...pagas];
  if (!$('#p-lista', root)) {
    root.innerHTML = `<div id="p-kpis"></div><div class="barra-ferramentas"><label>Buscar<input id="p-q" type="search" placeholder="Descrição, fornecedor ou categoria" value="${esc(busca)}"></label>
      <label>Mostrar<select id="p-f"><option value="pendente">Pendentes</option><option value="vencida">Só vencidas</option><option value="pago">Pagas (últimas 200)</option><option value="todas">Todas</option></select></label>
      <button class="btn primario" id="p-nova">Nova conta</button></div><div id="p-lista"></div>`;
    $('#p-q').oninput = debounce((e) => { busca = e.target.value; pintar(); }, 150);
    $('#p-f').value = filtro; $('#p-f').onchange = (e) => { filtro = e.target.value; pintar(); };
    $('#p-nova').onclick = () => form();
    $('#p-lista').onclick = acao;
  }
  pintar();
}
export const aoMudar = render;

function pintar() {
  const h = hoje(), q = busca.toLowerCase();
  const em7 = new Date(Date.now() + 7 * 864e5).toLocaleDateString('sv-SE');
  const pend = contas.filter((c) => c.status === 'pendente');
  const venc = pend.filter((c) => c.vencimento < h);
  const soma = (xs) => xs.reduce((s, c) => s + Number(c.valor), 0);
  $('#p-kpis').innerHTML = `<div class="cards-dia"><div class="card k-alerta"><span>A pagar (pendente)</span><b>${brl(soma(pend))}</b></div>
    <div class="card k-alerta"><span>Vencidas<em style="font-style:normal">${venc.length}</em></span><b>${brl(soma(venc))}</b></div>
    <div class="card"><span>Vencem em 7 dias</span><b>${brl(soma(pend.filter((c) => c.vencimento >= h && c.vencimento <= em7)))}</b></div></div>`;
  const l = contas.filter((c) => (filtro === 'todas' || (filtro === 'vencida' ? c.status === 'pendente' && c.vencimento < h : c.status === filtro))
    && (!q || `${c.descricao} ${c.fornecedor || ''} ${c.categoria || ''}`.toLowerCase().includes(q)));
  $('#p-lista').innerHTML = l.length ? `<div class="bloco"><div class="rolagem"><table><thead><tr><th>Vencimento</th><th>Descrição</th><th>Fornecedor</th><th>Categoria</th><th class="n">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
    ${l.map((c) => `<tr data-id="${c.id}"><td>${dataBR(c.vencimento)}</td><td>${esc(c.descricao)}</td><td>${esc(c.fornecedor)}</td><td>${esc(c.categoria)}</td><td class="n">${brl(c.valor)}</td>
      <td>${c.status === 'pago' ? `<span class="chip pago">Paga em ${dataBR(c.pago_em)}</span>` : c.vencimento < h ? '<span class="chip atraso">Vencida</span>' : c.vencimento === h ? '<span class="chip parcial">Vence hoje</span>' : '<span class="chip">A vencer</span>'}</td>
      <td class="acoes">${c.status === 'pendente' ? '<button class="btn mini primario" data-a="pagar">Pagar</button><button class="btn mini" data-a="editar">Editar</button><button class="btn mini" data-a="excluir">Excluir</button>' : ''}</td></tr>`).join('')}</tbody></table></div></div>`
    : '<p class="vazio">Nenhuma conta neste filtro.</p>';
}

function acao(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const c = contas.find((x) => x.id === b.closest('tr').dataset.id);
  if (b.dataset.a === 'pagar') pagar(c);
  if (b.dataset.a === 'editar') form(c);
  if (b.dataset.a === 'excluir') excluir(c);
}

function pagar(c) {
  abrirForm({
    titulo: 'Pagar conta', ok: 'Confirmar pagamento',
    corpo: `<p><strong>${esc(c.descricao)}</strong><br>${esc(c.fornecedor || '')} · vence em ${dataBR(c.vencimento)} · <strong>${brl(c.valor)}</strong></p>
      <label>Forma de pagamento<select name="forma">${opcoes(FORMAS, 'pix')}</select></label>`,
    async onSubmit(fd) {
      const r = await chamar(sb.from('contas_pagar').update({ status: 'pago', pago_em: new Date().toISOString(), forma: fd.get('forma') }).eq('id', c.id).eq('status', 'pendente').select('id'));
      if (!r.length) throw new Error('Esta conta já foi paga em outro aparelho.');
      toast('Conta paga'); await render(raiz);
    },
  });
}

function form(c) {
  abrirForm({
    titulo: c ? 'Editar conta' : 'Nova conta a pagar',
    corpo: `<label>Descrição<input name="descricao" required value="${esc(c?.descricao)}" placeholder="Ex.: Aluguel da loja"></label>
      <label>Fornecedor<input name="fornecedor" value="${esc(c?.fornecedor)}"></label>
      <label>Categoria<input name="categoria" list="dl-cp" value="${esc(c?.categoria || '')}"></label>
      <datalist id="dl-cp">${CATEGORIAS.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <label>Valor (R$)<input name="valor" inputmode="decimal" required value="${c ? fmtNum(c.valor) : ''}"></label>
      <label>Vencimento<input type="date" name="venc" required value="${c?.vencimento || hoje()}"></label>
      ${c ? '' : '<label>Repetir por quantos meses? (1 = só esta)<input name="rep" type="number" min="1" max="24" value="1"></label>'}`,
    async onSubmit(fd) {
      const valor = num(fd.get('valor'));
      if (!(valor > 0)) throw new Error('Informe um valor válido.');
      const base = { descricao: fd.get('descricao').trim(), fornecedor: fd.get('fornecedor').trim() || null, categoria: fd.get('categoria').trim() || null, valor };
      if (c) {
        const r = await chamar(sb.from('contas_pagar').update({ ...base, vencimento: fd.get('venc') }).eq('id', c.id).eq('status', 'pendente').select('id'));
        if (!r.length) throw new Error('Esta conta já foi paga ou alterada em outro aparelho.');
      } else {
        const n = Math.min(24, Math.max(1, parseInt(fd.get('rep'), 10) || 1));
        await chamar(sb.from('contas_pagar').insert(Array.from({ length: n }, (_, i) => ({ ...base, descricao: n > 1 ? `${base.descricao} (${i + 1}/${n})` : base.descricao, vencimento: addMeses(fd.get('venc'), i) }))));
      }
      toast('Conta salva'); await render(raiz);
    },
  });
}

async function excluir(c) {
  if (!(await confirmar(`Excluir a conta "${c.descricao}" de ${brl(c.valor)}?`))) return;
  try { await chamar(sb.from('contas_pagar').delete().eq('id', c.id).eq('status', 'pendente')); toast('Conta excluída'); await render(raiz); }
  catch (e) { toast(e.message, 'erro'); }
}
