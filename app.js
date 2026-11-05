import { sb, chamar } from './supabase.js';
import { state, papel } from './state.js';
import { $, $$, esc, toast, debounce } from './ui.js';
import { DOMINIO_LOGIN } from './config.js';

const A = 'admin', V = 'vendedor', C = 'cliente';   // quem pode abrir cada tela
const ROTAS = {
  painel:     { t: 'Painel',             m: () => import('./views/painel.js'),     p: [A] },
  vendas:     { t: 'Vendas da loja',     m: () => import('./views/vendas.js'),     p: [A, V] },
  atacado:    { t: 'Vendas de atacado',  m: () => import('./views/atacado.js'),    p: [A, V], n: 'Atacado' },
  estoque:    { t: 'Estoque',            m: () => import('./views/estoque.js'),    p: [A, V, C] },
  insumos:    { t: 'Insumos e serviços', m: () => import('./views/insumos.js'),    p: [A], n: 'Insumos' },
  entradas:   { t: 'Entrada de mercadorias', m: () => import('./views/entradas.js'), p: [A], n: 'Entradas' },
  pagar:      { t: 'Contas a pagar',     m: () => import('./views/pagar.js'),      p: [A], n: 'A pagar' },
  clientes:   { t: 'Clientes',           m: () => import('./views/clientes.js'),   p: [A, V] },
  fiado:      { t: 'A receber',          m: () => import('./views/fiado.js'),      p: [A] },
  funcionarios: { t: 'Funcionários e comissões', m: () => import('./views/funcionarios.js'), p: [A], n: 'Funcionários' },
  relatorios: { t: 'Relatórios',         m: () => import('./views/relatorios.js'), p: [A] },
  ajustes:    { t: 'Ajustes',            m: () => import('./views/ajustes.js'),    p: [A] },
};
const permitidas = () => Object.entries(ROTAS).filter(([, r]) => r.p.includes(papel()));
const inicial = () => permitidas()[0]?.[0] || 'estoque';
let modulo = null, canal = null;

// ---------- tema ----------
$('#tema').onclick = () => {
  const novo = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
  document.documentElement.dataset.tema = novo; localStorage.setItem('tema', novo);
};

// ---------- conexão ----------
const online = () => { $('#offline').hidden = navigator.onLine; };
addEventListener('online', () => { online(); state.recarregar?.(); });
addEventListener('offline', online);
online();

// ---------- login ----------
function mostrarLogin() {
  $('#app').hidden = true; $('#login').hidden = false;
  canal && sb.removeChannel(canal); canal = null;
}
$('#form-login').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target), bt = $('button', e.target), erro = $('#login-erro');
  const u = f.get('usuario').trim();
  bt.disabled = true; erro.textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({ email: u.includes('@') ? u : `${u}@${DOMINIO_LOGIN}`, password: f.get('senha') });
  bt.disabled = false;
  if (error) { erro.textContent = /Invalid login/i.test(error.message) ? 'Usuário ou senha incorretos.' : error.message; return; }
  e.target.reset();
  await entrar(data.session.user.id);
};
$('#sair').onclick = async () => { await sb.auth.signOut(); mostrarLogin(); };

async function entrar(uid) {
  const { data: perfil } = await sb.from('perfis').select('*').eq('id', uid).maybeSingle();
  if (!perfil || !perfil.ativo) {
    await sb.auth.signOut(); mostrarLogin();
    $('#login-erro').textContent = 'Usuário sem acesso. Peça a um administrador para ativá-lo.';
    return;
  }
  state.perfil = perfil;
  $('#quem').textContent = `${perfil.nome} · ${{ admin: 'Administrador', vendedor: 'Vendedor', cliente: 'Cliente' }[perfil.papel] || perfil.papel}`;
  $('#nav').innerHTML = permitidas()
    .map(([k, r]) => `<a href="#/${k}" data-rota="${k}">${r.n || r.t}<span class="badge" data-b="${k}" hidden></span></a>`).join('');
  atualizarBadges();
  $('#login').hidden = true; $('#app').hidden = false;
  assinarTempoReal();
  rotear();
}

// ---------- avisos no menu (só administrador) ----------
async function atualizarBadges() {
  if (papel() !== 'admin') return;
  try {
    const a = await chamar(sb.rpc('alertas_resumo'));
    const mapa = { insumos: a.itens_baixos, pagar: a.contas_vencidas, funcionarios: a.comissoes, estoque: a.pneus_baixos };
    for (const [k, n] of Object.entries(mapa)) { const el = $(`#nav [data-b="${k}"]`); if (el) { el.textContent = n; el.hidden = !(n > 0); } }
  } catch { /* sem avisos */ }
}

// ---------- tempo real: o que um aparelho grava aparece nos outros ----------
function assinarTempoReal() {
  canal && sb.removeChannel(canal);
  const atualizar = debounce(async () => {
    if ($('#dlg').open) { state.pendente = true; return; }   // não derruba formulário aberto
    atualizarBadges();
    try { modulo?.aoMudar ? await modulo.aoMudar($('#view')) : await state.recarregar?.(); } catch { /* ignora */ }
  }, 500);
  canal = sb.channel('geral').on('postgres_changes', { event: '*', schema: 'public' }, atualizar).subscribe();
}
$('#dlg').addEventListener('close', () => { if (state.pendente) { state.pendente = false; state.recarregar?.(); } });

// ---------- rotas ----------
async function rotear() {
  if (!state.perfil) return;
  const nome = location.hash.replace('#/', '') || inicial();
  const r = ROTAS[nome];
  if (!r || !r.p.includes(papel())) { location.hash = '#/' + inicial(); return; }
  $('#titulo').textContent = r.t;
  $$('#nav a').forEach((a) => (a.dataset.rota === nome ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const root = $('#view');
  root.innerHTML = '<p class="carregando">Carregando…</p>';
  try {
    modulo = await r.m();
    state.recarregar = () => modulo.render(root);
    await modulo.render(root);
  } catch (e) { root.innerHTML = `<div class="erro">${esc(e.message)}</div>`; }
}
addEventListener('hashchange', rotear);

// ---------- início ----------
(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const { data: { session } } = await sb.auth.getSession();
  session ? await entrar(session.user.id) : mostrarLogin();
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') mostrarLogin(); });
})();
