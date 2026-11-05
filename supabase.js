import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const MENSAGENS = [
  [/estoque_insuficiente:?\s*(.*)/, (m) => `Estoque insuficiente: ${m[1] || 'verifique as quantidades'}. Outro aparelho pode ter vendido antes.`],
  [/valor_maior_que_saldo/, () => 'O valor é maior que o saldo em aberto.'],
  [/conta_encerrada/, () => 'Esta conta já está quitada ou cancelada.'],
  [/venda_com_pagamentos/, () => 'Esta venda já tem pagamentos registrados e não pode ser cancelada.'],
  [/edicao_com_pagamentos/, () => 'Esta venda já tem recebimento registrado (pagamento ou boleto pago) e não pode ser editada.'],
  [/venda_inexistente/, () => 'Venda não encontrada.'],
  [/venda_ja_cancelada/, () => 'Esta venda já foi cancelada.'],
  [/cliente_obrigatorio/, () => 'Escolha um cliente para vendas no atacado ou a prazo.'],
  [/forma_obrigatoria/, () => 'Escolha a forma de pagamento.'],
  [/venda_sem_itens/, () => 'Adicione pelo menos um item ou serviço.'],
  [/pagamento_incompleto/, () => 'A soma das formas de pagamento precisa ser igual ao total da venda.'],
  [/pagamento_inconsistente/, () => 'Os valores pagos e os boletos não fecham com o total da venda.'],
  [/max_4_formas/, () => 'No pagamento múltiplo o máximo é 4 formas.'],
  [/desconto_maior_que_total/, () => 'O desconto é maior que o valor da venda.'],
  [/total_negativo/, () => 'O abatimento da troca e os descontos passam do valor da venda.'],
  [/venda_a_prazo/, () => 'Vendas a prazo já têm cliente e conta a receber; o cliente não pode ser trocado.'],
  [/periodo_aberto/, () => 'O mês ainda não fechou. Só dá para pagar comissões de meses encerrados.'],
  [/use_ajustar_item/, () => 'A quantidade do insumo só muda por entrada ou ajuste de estoque.'],
  [/comissao_paga/, () => 'Esta comissão já foi marcada como paga.'],
  [/comissao_zerada/, () => 'Não há valor de comissão a pagar neste mês.'],
  [/funcionario_inexistente/, () => 'Funcionário não encontrado.'],
  [/entrada_sem_itens/, () => 'Adicione pelo menos uma mercadoria à entrada.'],
  [/produto_inexistente|item_inexistente/, () => 'Mercadoria não encontrada ou inativa.'],
  [/ajuste_invalido/, () => 'Informe uma quantidade diferente de zero.'],
  [/forma_invalida/, () => 'Forma de pagamento inválida.'],
  [/use_ajustar_estoque/, () => 'A quantidade só muda por venda ou por ajuste de estoque.'],
  [/sem_permissao|row-level security|permission denied/, () => 'Você não tem permissão para esta ação.'],
  [/duplicate key/, () => 'Já existe um registro com esses dados.'],
  [/foreign key/, () => 'Este registro está em uso e não pode ser removido.'],
  [/Failed to fetch|NetworkError|Load failed/, () => 'Sem conexão com o servidor. Confira a internet e tente de novo.'],
  [/Invalid login credentials/, () => 'Usuário ou senha incorretos.'],
];

export function traduzir(e) {
  const txt = e?.message || String(e);
  for (const [re, fn] of MENSAGENS) { const m = txt.match(re); if (m) return new Error(fn(m)); }
  return new Error(txt);
}

export async function chamar(promessa) {
  let r;
  try { r = await promessa; } catch (e) { throw traduzir(e); }
  if (r.error) throw traduzir(r.error);
  return r.data;
}

// Busca todas as páginas (o Supabase devolve no máximo 1000 linhas por consulta).
export async function todos(montar) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const data = await chamar(montar(i, i + 999));
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
