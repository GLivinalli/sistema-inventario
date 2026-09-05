const express = require('express');
const { getDb } = require('../db');
const { processarInventario, estoqueDisponivel } = require('../lib/fifo');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

// Converte centavos (int) -> reais (number) só na saída da API,
// pra manter o front-end simples (continua falando em reais).
function centavosParaReais(c) {
    return Math.round(c || 0) / 100;
}

function linhaParaReais(row, camposCentavos) {
    const out = { ...row };
    camposCentavos.forEach(campo => {
        const destino = campo.replace('_centavos', '');
        out[destino] = centavosParaReais(row[campo]);
        delete out[campo];
    });
    return out;
}

// ---------- Validação de entrada ----------
function validarMovimentacao(body) {
    const erros = [];
    const { tipo, data, item, fabricante, quantidade, valor_unitario, responsavel, setor, funcionario_destino } = body;

    if (tipo !== 'Entrada' && tipo !== 'Saída') {
        erros.push('Tipo deve ser "Entrada" ou "Saída".');
    }
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        erros.push('Data inválida (formato esperado AAAA-MM-DD).');
    }
    if (!item || typeof item !== 'string' || !item.trim()) {
        erros.push('Item é obrigatório.');
    }
    if (!fabricante || typeof fabricante !== 'string' || !fabricante.trim()) {
        erros.push('Fabricante é obrigatório.');
    }
    if (!responsavel || typeof responsavel !== 'string' || !responsavel.trim()) {
        erros.push('Responsável é obrigatório.');
    }

    const qtd = Number(quantidade);
    if (!Number.isFinite(qtd) || !Number.isInteger(qtd) || qtd <= 0) {
        erros.push('Quantidade deve ser um número inteiro maior que zero.');
    }

    let valorCentavos = 0;
    if (tipo === 'Entrada') {
        const valor = Number(valor_unitario);
        if (!Number.isFinite(valor) || valor < 0) {
            erros.push('Valor unitário deve ser um número maior ou igual a zero.');
        } else {
            valorCentavos = Math.round(valor * 100);
        }
    }

    if (tipo === 'Saída') {
        if (!setor || !String(setor).trim()) erros.push('Setor de destino é obrigatório em saídas.');
        if (!funcionario_destino || !String(funcionario_destino).trim()) erros.push('Funcionário é obrigatório em saídas.');
    }

    return { erros, quantidade: qtd, valorCentavos };
}

// ---------- GET /api/inventario ----------
router.get('/inventario', async (req, res) => {
    try {
        const db = await getDb();
        const rows = await db.all(`SELECT * FROM inventario ORDER BY data ASC, id ASC`);
        const { historico } = processarInventario(rows);
        const historicoReais = historico
            .map(r => linhaParaReais(r, ['valor_unitario_centavos', 'valor_unitario_efetivo_centavos', 'valor_total_centavos']))
            .reverse();
        res.json(historicoReais);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao carregar histórico.' });
    }
});

// ---------- POST /api/inventario ----------
router.post('/inventario', requireApiKey, async (req, res) => {
    try {
        const { erros, quantidade, valorCentavos } = validarMovimentacao(req.body);
        if (erros.length) {
            return res.status(400).json({ error: erros.join(' ') });
        }

        const { tipo, data, item, fabricante, responsavel, setor, funcionario_destino } = req.body;
        const db = await getDb();

        // Bloqueia saída maior que o saldo disponível (antes não havia checagem nenhuma).
        if (tipo === 'Saída') {
            const rowsExistentes = await db.all(`SELECT * FROM inventario ORDER BY data ASC, id ASC`);
            const disponivel = estoqueDisponivel(rowsExistentes, item, fabricante);
            if (quantidade > disponivel) {
                return res.status(400).json({
                    error: `Estoque insuficiente. Disponível: ${disponivel}, solicitado: ${quantidade}.`
                });
            }
        }

        const result = await db.run(
            `INSERT INTO inventario (tipo, data, item, fabricante, quantidade, valor_unitario_centavos, responsavel, setor, funcionario_destino)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tipo, data, item.trim(), fabricante.trim(), quantidade, valorCentavos,
                responsavel.trim(), (setor || '').trim(), (funcionario_destino || '').trim()
            ]
        );

        res.json({ id: result.lastID });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao registrar movimentação.' });
    }
});

// ---------- DELETE /api/inventario/:id ----------
router.delete('/inventario/:id', requireApiKey, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'ID inválido.' });
        }
        const db = await getDb();
        const result = await db.run(`DELETE FROM inventario WHERE id = ?`, [id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Registro não encontrado.' });
        }
        res.json({ message: 'Excluído com sucesso' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao excluir registro.' });
    }
});

// ---------- GET /api/estoque ----------
router.get('/estoque', async (req, res) => {
    try {
        const db = await getDb();
        const rows = await db.all(`SELECT * FROM inventario ORDER BY data ASC, id ASC`);
        const { estoque } = processarInventario(rows);
        const estoqueReais = estoque.map(e => ({
            item: e.item,
            fabricante: e.fabricante,
            total: e.total,
            valor_unitario: centavosParaReais(e.valor_unitario_centavos),
            valor_anterior: e.valor_anterior_centavos === null ? null : centavosParaReais(e.valor_anterior_centavos),
            valor_total_estoque: centavosParaReais(e.valor_total_estoque_centavos),
            // entradas_historico mantém centavos crus separados por "|"; convertido no front.
            entradas_historico: e.entradas_historico
        }));
        res.json(estoqueReais);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao carregar estoque.' });
    }
});

// ---------- GET /api/resumo-mensal ----------
router.get('/resumo-mensal', async (req, res) => {
    try {
        const mesFiltro = req.query.mes;
        const db = await getDb();
        const rows = await db.all(`SELECT * FROM inventario ORDER BY data ASC, id ASC`);
        const { historico } = processarInventario(rows);

        let entradasCentavos = 0, entradasQtd = 0;
        let saidasCentavos = 0, saidasQtd = 0;

        historico.forEach(r => {
            const noMes = !mesFiltro || (r.data && r.data.startsWith(mesFiltro));
            if (!noMes) return;
            if (r.tipo === 'Entrada') {
                entradasCentavos += r.valor_total_centavos;
                entradasQtd += r.quantidade;
            } else if (r.tipo === 'Saída') {
                saidasCentavos += r.valor_total_centavos;
                saidasQtd += r.quantidade;
            }
        });

        res.json({
            entradasValor: centavosParaReais(entradasCentavos),
            entradasQtd,
            saidasValor: centavosParaReais(saidasCentavos),
            saidasQtd,
            saldoValor: centavosParaReais(entradasCentavos - saidasCentavos)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao carregar resumo mensal.' });
    }
});

// ---------- GET /api/relatorio-consumo ----------
router.get('/relatorio-consumo', async (req, res) => {
    try {
        const { setor, funcionario, mes } = req.query;
        const db = await getDb();
        const rows = await db.all(`SELECT * FROM inventario ORDER BY data ASC, id ASC`);
        const { consumo } = processarInventario(rows);

        let resultado = consumo.map(c => ({
            data: c.data,
            setor: c.setor,
            funcionario_destino: c.funcionario_destino,
            item: c.item,
            fabricante: c.fabricante,
            total_retirado: c.total_retirado,
            valor_total_retirado: centavosParaReais(c.valor_total_retirado_centavos),
            ids: c.ids // ids das movimentações de "Saída" que compõem esta linha (usado para excluir)
        }));

        if (mes) resultado = resultado.filter(r => r.data && r.data.startsWith(mes));
        if (setor) resultado = resultado.filter(r => r.setor.toLowerCase().includes(String(setor).toLowerCase()));
        if (funcionario) resultado = resultado.filter(r => r.funcionario_destino.toLowerCase().includes(String(funcionario).toLowerCase()));

        res.json(resultado);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao carregar relatório de consumo.' });
    }
});

module.exports = router;
