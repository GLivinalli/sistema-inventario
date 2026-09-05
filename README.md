# Sistema de Inventário e Almoxarifado

Sistema de controle de estoque com custeio **FIFO** (primeiro que entra, primeiro que sai): registro de entradas/saídas, estoque atual por produto, consumo por setor/funcionário e balanço mensal.

## Como rodar

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# abra o .env e troque API_KEY por um valor forte e único
# (gere um com: openssl rand -hex 24)

# 3. Rodar
npm start
```

Abra **http://localhost:3000** no navegador (funciona bem em celular também).

Ao tentar **registrar uma movimentação** ou **excluir um registro**, o site vai pedir a `API_KEY` que você definiu no `.env`. Ela fica guardada no `sessionStorage` do navegador (some ao fechar a aba).

## O que foi corrigido nesta revisão

**Segurança**
- Todas as rotas de escrita (`POST /api/inventario`, `DELETE /api/inventario/:id`) agora exigem uma `API_KEY` no header `x-api-key`, comparada com `crypto.timingSafeEqual` (antes só o DELETE pedia uma senha fraca `'1234'` hardcoded, em texto plano).
- Rate limiting (60 req/15min por IP) nas rotas de escrita.
- Escape de HTML em todo texto vindo do banco antes de ir para `innerHTML` no front — corrige um XSS armazenado real (era possível cadastrar um item com `<img onerror=...>` e ele executar para qualquer pessoa que abrisse o histórico).
- Validação de tipos e obrigatoriedade no back-end (`quantidade` inteiro positivo, `valor_unitario` numérico ≥ 0, campos obrigatórios por tipo de movimentação).
- Saídas maiores que o estoque disponível agora são bloqueadas com erro 400.

**Performance**
- Lógica de FIFO centralizada em `lib/fifo.js`, usada por todas as rotas (antes era reimplementada 4 vezes).
- Índices em `item+fabricante`, `data` e `tipo`.
- Valores monetários guardados em **centavos (INTEGER)** em vez de `REAL`, eliminando erro de arredondamento acumulado.
- Banco em modo `WAL` (melhor concorrência de leitura/escrita).

**Estrutura**
- Projeto modularizado: `server.js`, `db.js`, `lib/fifo.js`, `middleware/auth.js`, `routes/inventario.js`, `public/`.
- `async/await` em vez de callbacks em toda a camada de banco.
- Encerramento gracioso do banco em `SIGINT`/`SIGTERM`.
- Bug corrigido: o card de Saldo lia `data.saldoVal` (campo inexistente); a API retorna `saldoValor`.

**Responsividade**
- CSS reescrito mobile-first: tabelas viram "cards" empilhados em telas ≤720px (cada linha some info via `data-label`), formulários em coluna única no celular, alvos de toque ≥44px, inputs com `font-size: 16px` (evita zoom automático no iOS), tooltip de lotes também funciona por toque (não só hover), painel de Balanço some do fluxo no mobile e só "flutua" fixo em telas largas (≥1451px).

## Estrutura de pastas

```
inventario-app/
├── server.js              # ponto de entrada
├── db.js                  # conexão SQLite (async/await, índices, WAL)
├── lib/fifo.js             # lógica de custeio FIFO centralizada
├── middleware/auth.js      # autenticação por API key
├── routes/inventario.js    # rotas da API + validação
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
└── .env.example
```

## O que eu expandiria a seguir

1. **Trocar `alert`/`prompt` por um modal de login real** — hoje a UX de digitar a API key via `prompt()` é rústica. Um modal com "lembrar por X horas" ficaria bem melhor.
2. **Autenticação por usuário** (não só uma chave compartilhada) — se mais de uma pessoa usa o sistema, vale ter login individual (mesmo que simples, com `bcrypt` + sessão) para saber *quem* fez cada ação, não só o campo livre "responsável".
3. **Edição de registros** — hoje só dá para criar e excluir; corrigir um erro de digitação exige apagar e recriar (perde o `id` original e o histórico).
4. **Paginação/filtro por período no histórico** — a rota `/api/inventario` sempre traz tudo; em alguns meses de uso isso cresce e vale paginar.
5. **Exportar relatórios em CSV/Excel** — o consumo por setor é o tipo de dado que times de compras/financeiro costumam quere baixar.
6. **Testes automatizados** para `lib/fifo.js** — a lógica é o coração do sistema; hoje só validei manualmente (veja o teste rápido que rodei), vale formalizar com Jest/Vitest.
7. **Alertas de estoque mínimo** — definir um limite por item e notificar (mesmo que só visualmente na tela) quando o saldo cai abaixo dele.

## Observação importante sobre migração

O banco antigo usava `valor_unitario` em `REAL` (reais). Esta versão usa `valor_unitario_centavos` em `INTEGER` (centavos) — é uma mudança de schema. Se você já tinha um `inventario.db` em produção, **não é compatível diretamente**; delete o arquivo antigo para começar do zero, ou me avise que preparo um script de migração (multiplica os valores antigos por 100 e renomeia a coluna).
