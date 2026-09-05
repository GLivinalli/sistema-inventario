/**
 * Lógica de custeio FIFO (First In, First Out) centralizada.
 * Antes essa lógica estava duplicada em 4 rotas diferentes do server.js;
 * agora existe em um único lugar, percorrendo as linhas UMA vez e
 * produzindo todas as visões (histórico, estoque, consumo) a partir do
 * mesmo processamento.
 *
 * Todos os valores monetários aqui são inteiros em CENTAVOS.
 */

function chaveProduto(item, fabricante) {
    return `${(item || '').trim().toLowerCase()}_${(fabricante || '').trim().toLowerCase()}`;
}

/**
 * Processa todas as linhas (já ordenadas por data, id ASC) e retorna:
 * - historico: cada linha original + valor_total_centavos e valor_unitario_efetivo_centavos
 * - estoque: array por produto (item+fabricante) com saldo atual e lotes
 * - consumo: array de retiradas agregadas por data+setor+funcionário+produto
 */
function processarInventario(rows) {
    const lotesPorChave = {};   // chave -> [{ quantidade_restante, valor_unitario_centavos, data, quantidade_original }]
    const infoPorChave = {};    // chave -> { item, fabricante, valor_unitario_centavos, valor_anterior_centavos }
    const consumoMap = {};      // chave composta -> registro agregado de saída

    const historico = rows.map(row => {
        const key = chaveProduto(row.item, row.fabricante);
        if (!lotesPorChave[key]) lotesPorChave[key] = [];
        if (!infoPorChave[key]) {
            infoPorChave[key] = {
                item: row.item,
                fabricante: row.fabricante,
                valor_unitario_centavos: 0,
                valor_anterior_centavos: null
            };
        }

        let valorTotalCentavos = 0;
        let custoUnitarioEfetivoCentavos = row.valor_unitario_centavos || 0;

        if (row.tipo === 'Entrada') {
            lotesPorChave[key].push({
                data: row.data,
                quantidade_original: row.quantidade,
                quantidade_restante: row.quantidade,
                valor_unitario_centavos: row.valor_unitario_centavos || 0
            });

            infoPorChave[key].valor_anterior_centavos =
                infoPorChave[key].valor_unitario_centavos > 0 ? infoPorChave[key].valor_unitario_centavos : null;
            infoPorChave[key].valor_unitario_centavos = row.valor_unitario_centavos || 0;

            valorTotalCentavos = row.quantidade * (row.valor_unitario_centavos || 0);
        } else if (row.tipo === 'Saída') {
            let qtdParaBaixar = row.quantidade;
            let custoTotalSaidaCentavos = 0;

            for (const lote of lotesPorChave[key]) {
                if (qtdParaBaixar <= 0) break;
                if (lote.quantidade_restante > 0) {
                    const qtdUsada = Math.min(lote.quantidade_restante, qtdParaBaixar);
                    custoTotalSaidaCentavos += qtdUsada * lote.valor_unitario_centavos;
                    lote.quantidade_restante -= qtdUsada;
                    qtdParaBaixar -= qtdUsada;
                }
            }

            valorTotalCentavos = custoTotalSaidaCentavos;
            custoUnitarioEfetivoCentavos = row.quantidade > 0
                ? Math.round(custoTotalSaidaCentavos / row.quantidade)
                : 0;

            const setor = row.setor || '-';
            const func = row.funcionario_destino || '-';
            const consumoKey = `${row.data}_${setor}_${func}_${key}`;
            if (!consumoMap[consumoKey]) {
                consumoMap[consumoKey] = {
                    data: row.data,
                    setor,
                    funcionario_destino: func,
                    item: row.item,
                    fabricante: row.fabricante,
                    total_retirado: 0,
                    valor_total_retirado_centavos: 0,
                    ids: [] // ids das linhas de "Saída" que compõem este agregado (pode ser mais de uma)
                };
            }
            consumoMap[consumoKey].total_retirado += row.quantidade;
            consumoMap[consumoKey].valor_total_retirado_centavos += custoTotalSaidaCentavos;
            consumoMap[consumoKey].ids.push(row.id);
        }

        return {
            ...row,
            valor_unitario_efetivo_centavos: custoUnitarioEfetivoCentavos,
            valor_total_centavos: valorTotalCentavos
        };
    });

    const estoque = Object.keys(infoPorChave).map(key => {
        const info = infoPorChave[key];
        const lotes = lotesPorChave[key] || [];

        let total = 0;
        let valorTotalEstoqueCentavos = 0;
        lotes.forEach(l => {
            total += l.quantidade_restante;
            valorTotalEstoqueCentavos += l.quantidade_restante * l.valor_unitario_centavos;
        });

        const historicoLotes = [...lotes].reverse().map(l =>
            `${l.data}|${l.quantidade_original}|${l.quantidade_restante}|${l.valor_unitario_centavos}`
        );

        return {
            item: info.item,
            fabricante: info.fabricante,
            total,
            valor_unitario_centavos: info.valor_unitario_centavos,
            valor_anterior_centavos: info.valor_anterior_centavos,
            valor_total_estoque_centavos: valorTotalEstoqueCentavos,
            entradas_historico: historicoLotes.join(';')
        };
    });

    return { historico, estoque, consumo: Object.values(consumoMap) };
}

/**
 * Retorna a quantidade atualmente disponível em estoque para um produto,
 * dado o conjunto de linhas já existentes (antes de uma nova inserção).
 * Usado para bloquear saídas maiores que o saldo disponível.
 */
function estoqueDisponivel(rows, item, fabricante) {
    const { estoque } = processarInventario(rows);
    const key = chaveProduto(item, fabricante);
    const produto = estoque.find(e => chaveProduto(e.item, e.fabricante) === key);
    return produto ? produto.total : 0;
}

module.exports = { chaveProduto, processarInventario, estoqueDisponivel };
