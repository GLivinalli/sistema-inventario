const app = {
    formatCurrency: val => (parseFloat(val) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    formatDate: dt => dt ? dt.split('-').reverse().join('/') : '-',

    // Dias corridos entre uma data (formato AAAA-MM-DD) e hoje.
    // Usado na coluna "Dias em Estoque" da aba Estoque Atual, aplicado à
    // data do lote mais antigo que ainda tem saldo (quantidade_restante > 0).
    diasDesde(dataStr) {
        if (!dataStr) return null;
        const [ano, mes, dia] = dataStr.split('-').map(Number);
        const dataMov = Date.UTC(ano, mes - 1, dia);
        const hoje = new Date();
        const hojeUTC = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
        const diffMs = hojeUTC - dataMov;
        return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    },

    // Corrige o XSS armazenado: qualquer texto vindo do banco (item, fabricante,
    // setor, funcionário) passa por aqui antes de entrar em innerHTML.
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str === null || str === undefined ? '' : String(str);
        return div.innerHTML;
    },

    // --- Gestão da chave de API (autenticação para POST/DELETE) ---
    getApiKey() {
        let key = sessionStorage.getItem('apiKey');
        if (!key) {
            key = prompt('Digite a chave de acesso (API_KEY) para fazer alterações:');
            if (key) sessionStorage.setItem('apiKey', key);
        }
        return key || '';
    },
    clearApiKey() {
        sessionStorage.removeItem('apiKey');
    },
    async authFetch(url, options = {}) {
        const key = this.getApiKey();
        const headers = { ...(options.headers || {}), 'x-api-key': key };
        const res = await fetch(url, { ...options, headers });
        if (res.status === 401) {
            this.clearApiKey();
            alert('Chave de acesso inválida. Tente novamente.');
        }
        return res;
    },

    init() {
        document.getElementById('data').valueAsDate = new Date();
        this.loadHistorico();
        this.toggleFields();
    },

    switchTab(evt, tabName) {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

        document.getElementById(tabName).classList.add('active');
        evt.currentTarget.classList.add('active');

        const resumoBox = document.getElementById('resumoCardBox');
        if (tabName === 'aba-estoque') {
            resumoBox.classList.add('is-visible');
            this.applyResumoCollapsedState();
            this.loadEstoque();
            this.loadResumo();
        } else {
            resumoBox.classList.remove('is-visible');
        }
        if (tabName === 'aba-relatorios') this.loadRelatorio();
    },

    // --- Balanço: mostrar/esconder o conteúdo (economiza espaço de tela) ---
    // O estado (aberto/fechado) fica salvo no localStorage e é lembrado
    // entre visitas.
    applyResumoCollapsedState() {
        const box = document.getElementById('resumoCardBox');
        const colapsado = localStorage.getItem('resumoColapsado') === '1';
        box.classList.toggle('collapsed', colapsado);
    },
    toggleResumo() {
        const box = document.getElementById('resumoCardBox');
        const agoraColapsado = !box.classList.contains('collapsed');
        box.classList.toggle('collapsed', agoraColapsado);
        localStorage.setItem('resumoColapsado', agoraColapsado ? '1' : '0');
    },

    toggleFields() {
        const isSaida = document.getElementById('tipo').value === 'Saída';
        document.querySelector('.campo-entrada-valor').classList.toggle('hidden', isSaida);
        document.getElementById('valor_unitario').toggleAttribute('required', !isSaida);
        document.querySelectorAll('.campo-saida').forEach(el => {
            el.classList.toggle('hidden', !isSaida);
            el.querySelector('input').toggleAttribute('required', isSaida);
        });
    },

    formatVariacao(atual, anterior) {
        if (!anterior) return '<span class="var-neutro">1ª compra</span>';
        if (atual === anterior) return '<span class="var-neutro">0%</span>';
        const diff = ((atual - anterior) / anterior) * 100;
        return `<span class="${diff > 0 ? 'var-subiu' : 'var-descuiu'}">${diff > 0 ? '+' : ''}${diff.toFixed(1)}%</span>`;
    },

    async loadHistorico() {
        const res = await fetch('/api/inventario');
        const data = await res.json();
        const body = document.getElementById('historicoBody');
        body.innerHTML = '';

        const precos = {};
        const registrosOrdenados = [...data].reverse();
        const processados = registrosOrdenados.map(rec => {
            const key = `${rec.item.toLowerCase().trim()}_${rec.fabricante.toLowerCase().trim()}`;
            let varHtml = '-';
            if (rec.tipo === 'Entrada') {
                const val = parseFloat(rec.valor_unitario) || 0;
                varHtml = this.formatVariacao(val, precos[key]);
                precos[key] = val;
            }
            return { ...rec, varHtml };
        }).reverse();

        const esc = this.escapeHtml.bind(this);
        processados.forEach(r => {
            const valUnitExibido = r.tipo === 'Entrada' ? r.valor_unitario : r.valor_unitario_efetivo;
            body.innerHTML += `
                <tr>
                    <td class="${r.tipo === 'Entrada' ? 'tipo-entrada' : 'tipo-saida'}" data-label="Tipo">${esc(r.tipo)}</td>
                    <td data-label="Data">${this.formatDate(r.data)}</td>
                    <td data-label="Item">${esc(r.item)}</td>
                    <td data-label="Fabricante">${esc(r.fabricante)}</td>
                    <td data-label="Qtd">${esc(r.quantidade)}</td>
                    <td data-label="Valor Un.">${this.formatCurrency(valUnitExibido)}</td>
                    <td data-label="Var.">${r.varHtml}</td>
                    <td data-label="Total"><b>${this.formatCurrency(r.valor_total)}</b></td>
                    <td data-label="Setor">${esc(r.setor) || '-'}</td>
                    <td data-label="Retirado Por">${esc(r.funcionario_destino) || '-'}</td>
                    <td data-label="Ação"><button class="btn-delete" onclick="app.delete(${Number(r.id)})">X</button></td>
                </tr>`;
        });
    },

    async loadEstoque() {
        const res = await fetch('/api/estoque');
        const data = await res.json();
        const body = document.getElementById('estoqueBody');
        body.innerHTML = data.length ? '' : `<tr><td colspan="7" align="center">Estoque vazio.</td></tr>`;

        data.forEach(i => {
            let lotesHtml = '<div class="tooltip-title">Histórico de Lotes:</div>';
            let dataLoteMaisAntigo = null; // lote mais antigo que AINDA tem saldo (quantidade_restante > 0)

            if (i.entradas_historico) {
                // entradas_historico vem ordenado do lote mais novo para o mais velho.
                i.entradas_historico.split(';').forEach(e => {
                    const [dt, orig, rest, valCentavos] = e.split('|');
                    const valReais = (parseInt(valCentavos, 10) || 0) / 100;
                    lotesHtml += `<div class="tooltip-item">${this.formatDate(dt)} - ${this.formatCurrency(valReais)}</div>`;

                    if (parseInt(rest, 10) > 0) {
                        dataLoteMaisAntigo = dt; // como a lista vai do mais novo pro mais velho, o último match é o mais antigo ainda com saldo
                    }
                });
            }

            const dias = dataLoteMaisAntigo ? this.diasDesde(dataLoteMaisAntigo) : null;
            const diasTexto = dias === null ? '-' : `${dias} ${dias === 1 ? 'dia' : 'dias'}`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td data-label="Item">${this.escapeHtml(i.item)}</td>
                <td data-label="Fabricante">${this.escapeHtml(i.fabricante)}</td>
                <td data-label="Qtd" class="${i.total <= 0 ? 'estoque-baixo' : 'estoque-ok'}">${Number(i.total)}</td>
                <td data-label="Último Valor">${this.formatCurrency(i.valor_unitario)}</td>
                <td data-label="Var.">${this.formatVariacao(i.valor_unitario, i.valor_anterior)}</td>
                <td data-label="Dias em Estoque">${diasTexto}</td>
                <td data-label="Total Estoque">
                    <div class="tooltip-container">
                        <b>${this.formatCurrency(i.valor_total_estoque)}</b> ℹ️
                    </div>
                </td>`;

            const container = tr.querySelector('.tooltip-container');
            const globalTooltip = document.getElementById('global-tooltip');

            container.addEventListener('mouseenter', () => {
                globalTooltip.innerHTML = lotesHtml;
                globalTooltip.style.display = 'block';
                const rect = container.getBoundingClientRect();
                globalTooltip.style.top = (rect.bottom + 8) + 'px';
                globalTooltip.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
            });
            container.addEventListener('mouseleave', () => {
                globalTooltip.style.display = 'none';
            });
            // Suporte a toque (mobile não tem hover)
            container.addEventListener('click', () => {
                const visivel = globalTooltip.style.display === 'block';
                if (visivel) { globalTooltip.style.display = 'none'; return; }
                globalTooltip.innerHTML = lotesHtml;
                globalTooltip.style.display = 'block';
                const rect = container.getBoundingClientRect();
                globalTooltip.style.top = (rect.bottom + 8) + 'px';
                globalTooltip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 240)) + 'px';
            });

            body.appendChild(tr);
        });
    },

    async loadResumo() {
        const mes = document.getElementById('filtroMesResumo').value;
        const res = await fetch(`/api/resumo-mensal?mes=${encodeURIComponent(mes)}`);
        const data = await res.json();
        document.getElementById('resumoEntradasVal').innerText = this.formatCurrency(data.entradasValor);
        document.getElementById('resumoEntradasQtd').innerText = `${data.entradasQtd} itens`;
        document.getElementById('resumoSaidasVal').innerText = this.formatCurrency(data.saidasValor);
        document.getElementById('resumoSaidasQtd').innerText = `${data.saidasQtd} itens`;
        // BUG CORRIGIDO: antes lia "data.saldoVal" (campo que não existe).
        // A API retorna "saldoValor".
        document.getElementById('resumoSaldoVal').innerText = this.formatCurrency(data.saldoValor);
    },

    clearMes() { document.getElementById('filtroMesResumo').value = ''; this.loadResumo(); },

    async loadRelatorio() {
        const mes = document.getElementById('filterMes').value;
        const setor = document.getElementById('filterSetor').value;
        const func = document.getElementById('filterFuncionario').value;
        const res = await fetch(`/api/relatorio-consumo?mes=${encodeURIComponent(mes)}&setor=${encodeURIComponent(setor)}&funcionario=${encodeURIComponent(func)}`);
        const data = await res.json();
        const body = document.getElementById('relatorioBody');
        body.innerHTML = data.length ? '' : `<tr><td colspan="8" align="center">Nenhum registro.</td></tr>`;
        const esc = this.escapeHtml.bind(this);
        data.forEach(r => {
            const ids = (r.ids || []).join(',');
            body.innerHTML += `
                <tr>
                    <td data-label="Data">${this.formatDate(r.data)}</td>
                    <td data-label="Setor"><b>${esc(r.setor)}</b></td>
                    <td data-label="Funcionário">${esc(r.funcionario_destino)}</td>
                    <td data-label="Item">${esc(r.item)}</td>
                    <td data-label="Fabricante">${esc(r.fabricante)}</td>
                    <td data-label="Retirado" class="tipo-saida">${Number(r.total_retirado)}</td>
                    <td data-label="Valor Total"><b>${this.formatCurrency(r.valor_total_retirado)}</b></td>
                    <td data-label="Ação"><button class="btn-delete" onclick="app.deleteConsumo('${ids}')">X</button></td>
                </tr>`;
        });
    },

    clearFilter() {
        document.getElementById('filterMes').value = '';
        document.getElementById('filterSetor').value = '';
        document.getElementById('filterFuncionario').value = '';
        this.loadRelatorio();
    },

    async delete(id) {
        if (!confirm('Confirma a exclusão deste registro?')) return;
        const res = await fetch(`/api/inventario/${id}`, {
            method: 'DELETE',
            headers: { 'x-api-key': this.getApiKey() }
        });
        const result = await res.json().catch(() => ({}));
        if (res.status === 401) {
            this.clearApiKey();
            alert('Chave de acesso inválida.');
            return;
        }
        if (!res.ok) { alert(result.error || 'Erro ao excluir.'); return; }
        alert('Excluído!');
        this.loadHistorico();
    },

    // Exclui uma linha do relatório de Consumo. Como uma linha ali pode
    // agregar mais de uma movimentação de "Saída" (mesma data+setor+
    // funcionário+item), apaga todas as movimentações que compõem a linha,
    // usando a MESMA chave de API (x-api-key) do Histórico.
    async deleteConsumo(idsStr) {
        const ids = (idsStr || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (!ids.length) { alert('Não foi possível identificar as movimentações desta linha.'); return; }

        const aviso = ids.length > 1
            ? `Esta linha agrupa ${ids.length} movimentações de saída. Confirma a exclusão de TODAS elas?`
            : 'Confirma a exclusão desta retirada?';
        if (!confirm(aviso)) return;

        const apiKey = this.getApiKey();
        let falhas = 0;

        for (const id of ids) {
            const res = await fetch(`/api/inventario/${id}`, {
                method: 'DELETE',
                headers: { 'x-api-key': apiKey }
            });
            if (res.status === 401) {
                this.clearApiKey();
                alert('Chave de acesso inválida.');
                return;
            }
            if (!res.ok) falhas++;
        }

        if (falhas > 0) {
            alert(`${falhas} de ${ids.length} movimentações não puderam ser excluídas.`);
        } else {
            alert('Excluído!');
        }
        this.loadRelatorio();
    }
};

document.getElementById('inventoryForm').addEventListener('submit', async e => {
    e.preventDefault();
    const tipo = document.getElementById('tipo').value;
    const payload = {
        tipo, data: document.getElementById('data').value,
        item: document.getElementById('item').value.trim(),
        fabricante: document.getElementById('fabricante').value.trim(),
        quantidade: document.getElementById('quantidade').value,
        valor_unitario: tipo === 'Entrada' ? document.getElementById('valor_unitario').value : 0,
        responsavel: document.getElementById('responsavel').value.trim(),
        setor: document.getElementById('setor').value.trim(),
        funcionario_destino: document.getElementById('funcionario_destino').value.trim()
    };

    const res = await app.authFetch('/api/inventario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await res.json().catch(() => ({}));
    if (res.ok) {
        e.target.reset();
        app.init();
        alert('Registrado!');
    } else if (res.status !== 401) {
        alert(result.error || 'Erro ao registrar.');
    }
});

app.init();
