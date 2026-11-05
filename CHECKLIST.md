# Conferência: pedido x sistema

Legenda: **FASE 1** = `004_loja.sql` + telas de venda · **FASE 2** = `005_fase2.sql` + telas novas.

| # | Pedido | Situação | Onde está |
|---|---|---|---|
| 1 | Boletos a prazo (qtd, vencimento de cada um, registro de cada parcela) | Pronto | Venda > Pagamento > "Boletos a prazo" (`venda_form.js`); tabela `venda_boletos`; baixa em **A receber** (`fiado.js`, `baixar_boleto`) |
| 2 | Perfil **Cliente** (só estoque: qtd, medida, marca, modelo, preço) | Pronto | `estoque_cliente()` no banco (nunca devolve o custo); rota só do Estoque em `app.js` |
| 3 | Painel de vendas separado: **Loja** e **Atacado**, métricas independentes | Pronto | `painel_vendas.js` (`vendas.js` e `atacado.js`) |
| 4 | Perfil **Vendedor**: só Estoque, Clientes e Painel de Vendas | Pronto | Rotas em `app.js` + regras (RLS) no banco: financeiro, ajustes e cadastros ficam só com o administrador |
| 5 | Dashboard administrativo completo | Pronto (**FASE 2**) | `painel.js` + `dashboard_adm()` |
| 6 | Estoque de insumos separado, estoque mínimo, alerta de reposição | Pronto (**FASE 2**) | `insumos.js`, tabela `itens_complementares`; aviso no menu e no painel |
| 7 | Funcionários, comissão, meta com comissão maior, dia de fechamento, aviso no dashboard, valor a pagar | Pronto (**FASE 2**) | `funcionarios.js`, `comissoes()`, `pagar_comissao()` |
| 8 | Campos da venda da loja (pneus, alinhamento, bicos, cambagem, rodas, peças, serviços, total) | Pronto | `venda_form.js`, `registrar_venda_loja()` |
| 9 | Pagamento: dinheiro, PIX, débito, crédito (parcelas) e múltiplo (até 4) | Pronto | `venda_form.js`; tabela `venda_pagamentos` |
| 10 | Status: pago, pendente, parcialmente pago | Pronto | Campo na venda; calculado automaticamente e editável |
| 11 | Ações rápidas: associar cliente, desconto (R$ ou %), imprimir nota, base de troca | Pronto | `venda_form.js`, `nota.js`; troca em `trocas` |
| 12 | **Vendas da loja** no estilo da tabela do sistema antigo (index.html): cards de totais, grade de colunas, ícones por linha | Pronto | `painel_loja.js` (+ bloco `.lj` em `app.css`) |
| 13 | Reimprimir a **folha de garantia** (loja e atacado; novos 5 anos / seminovos 3 anos, mesmo texto do sistema antigo) | Pronto | `garantia.js`; botão do escudo na linha da venda |
| 14 | **Editar venda** no atacado (itens, preços, cliente, desconto, troca, pagamento) mantendo o número da nota | Pronto | `venda_form.js` (modo edição), `editar_venda_loja()` em `006_editar_venda.sql` |
| 15 | Nota/pedido do **atacado** com o **total de pneus** em destaque, para conferência | Pronto | `nota.js` (caixa "Total de pneus do pedido") |
| — | Dados da empresa na nota configuráveis (sem dados fixos) | Pronto | Ajustes > Dados da empresa |

## Indicadores do dashboard (item 5)
Entrada de mercadorias · Contas a pagar · Clientes devedores · Faturamento da loja · Faturamento do atacado · Total vendido no período · Ticket médio · Produtos mais vendidos · Pneus e insumos com baixo estoque · Comissões pendentes · Vendas por vendedor · Lucro estimado · (extras) valor do estoque de pneus a custo, valor dos insumos, próximas contas a pagar, maiores devedores, vendas por dia.

## Regras que valem saber
- **Lucro estimado** = total vendido − custo dos pneus vendidos. Serviços, peças, comissões e despesas não têm custo cadastrado, então não são descontados.
- **Comissão**: soma das vendas concluídas do usuário ligado ao funcionário, no mês. Se bateu a meta, o % da meta vale para **todas** as vendas do mês. Só dá para marcar como paga depois que o mês fecha; o valor pago fica congelado.
- **Insumos** nunca entram no custo, no valor nem no alerta dos pneus.
- **Base de troca** abate do total da venda quando "Abater da venda" está marcado.
- Venda cancelada devolve o estoque e cancela os boletos pendentes. Venda com pagamento já recebido não pode ser cancelada.

## Editar venda (atacado): como funciona e limites
- Ao salvar, o estoque dos itens antigos volta (movimentação "ajuste" com o motivo "Edição da venda #N") e os novos itens são baixados, tudo numa transação: se algo falhar, nada muda.
- O número da nota, a data e o vendedor originais são mantidos; a venda fica marcada com "editada" (quando e por quem).
- **Não dá para editar** venda cancelada nem venda que já tem recebimento registrado (entrada paga, pagamento de conta a receber ou boleto pago). Nesses casos o botão fica desabilitado.
- Quem edita: administrador (qualquer venda) e vendedor (somente as que ele lançou).
- O botão de editar está só no atacado. O formulário e a função do banco já aceitam vendas da loja; para liberar lá, basta repetir o botão em `painel_loja.js`.
