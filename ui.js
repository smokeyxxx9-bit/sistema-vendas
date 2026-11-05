export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const dataBR = (d) => (d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '');
export const hoje = () => new Date().toLocaleDateString('sv-SE');
export const fmtNum = (n) => Number(n || 0).toFixed(2).replace('.', ',');
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// Aceita "1.234,56", "1234,56", "500" e "500.5"
export function num(v) {
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  return Number(s);
}

export const FORMAS = [['dinheiro', 'Dinheiro'], ['pix', 'Pix'], ['cartao_debito', 'Cartão de débito'], ['cartao_credito', 'Cartão de crédito'],
  ['transferencia', 'Transferência'], ['boleto', 'Boleto'], ['outro', 'Outro']];
export const nomeForma = (v) => (FORMAS.find((f) => f[0] === v) || [, v])[1];
export const opcoes = (lista, sel) => lista.map(([v, t]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');

export function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + tipo; t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), tipo === 'erro' ? 6000 : 2500);
}

// Barra de estoque: preenchimento = total; risco = mínimo.
export function barra(total, minimo) {
  const escala = Math.max(total, minimo * 2, 1);
  return `<div class="trilho${total <= minimo ? ' baixo' : ''}" role="img" aria-label="${total} unidades, mínimo ${minimo}">` +
    `<i style="width:${(total / escala * 100).toFixed(1)}%"></i><b style="left:${(minimo / escala * 100).toFixed(1)}%"></b></div>`;
}

export function abrirForm({ titulo, corpo, ok = 'Salvar', perigo = false, onSubmit }) {
  const dlg = $('#dlg'); dlg.style.width = '';
  dlg.innerHTML = `<form class="dlg-form"><h2>${esc(titulo)}</h2><div class="dlg-corpo">${corpo}</div>
    <div class="dlg-acoes"><button type="button" class="btn" data-x>Cancelar</button><button class="btn ${perigo ? 'perigo' : 'primario'}">${esc(ok)}</button></div></form>`;
  const f = $('form', dlg), bt = $('button:not([data-x])', f);
  $('[data-x]', f).onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    bt.disabled = true;                       // evita duplo clique
    try { await onSubmit(new FormData(f), f); dlg.close(); }
    catch (err) { toast(err.message, 'erro'); }
    finally { bt.disabled = false; }
  };
  dlg.showModal();
  $('input:not([type=hidden]),select,textarea', f)?.focus();
  return f;
}

export const confirmar = (msg, { ok = 'Excluir', titulo = 'Confirmar' } = {}) => new Promise((res) => {
  let sim = false;
  abrirForm({ titulo, corpo: `<p>${esc(msg)}</p>`, ok, perigo: true, onSubmit: async () => { sim = true; } });
  $('#dlg').addEventListener('close', () => res(sim), { once: true });
});

export function baixar(nome, conteudo, tipo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const FORMAS_VENDA = [['dinheiro', 'Dinheiro'], ['pix', 'PIX'], ['cartao_debito', 'Débito'], ['cartao_credito', 'Crédito']];

// Janela livre (sem botões prontos): o conteúdo cuida dos próprios botões e chama fechar().
export function abrirModal({ titulo, corpo, largura = '' }) {
  const dlg = $('#dlg');
  dlg.style.width = largura;
  dlg.innerHTML = `<div class="dlg-form"><h2>${esc(titulo)}</h2><div class="dlg-corpo">${corpo}</div></div>`;
  dlg.showModal();
  return { dlg, corpo: $('.dlg-corpo', dlg), fechar: () => dlg.close() };
}

const svg = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONES = {
  cliente: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
  desconto: svg('<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>'),
  nota: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
  troca: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  garantia: svg('<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'),
  editar: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
};
