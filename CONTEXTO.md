# CONTEXTO DO PROJETO — Sistema de Inventário e Almoxarifado

Este documento resume tudo que foi feito neste projeto até agora, para que
qualquer pessoa (ou IA) consiga continuar sem perder contexto. Leia isto
antes de mexer no código.

## O que é o projeto

Sistema web de controle de estoque/almoxarifado com custeio **FIFO**
(primeiro que entra, primeiro que sai). Stack: **Node.js + Express +
SQLite**, front-end em **HTML/CSS/JS puro** (sem framework).

Funcionalidades:
- Registrar movimentações de **Entrada** (compra) e **Saída** (retirada por
  setor/funcionário).
- Histórico de movimentações.
- Estoque atual por produto (item + fabricante), com saldo calculado por
  lotes FIFO.
- Consumo agregado por setor/funcionário/mês.
- Balanço mensal (entradas x saídas x saldo).

## Histórico de decisões (do mais antigo ao mais recente)

1. **Ponto de partida:** o usuário já tinha um protótipo funcional (um
   `server.js` monolítico + um `index.html` com CSS/JS inline), com lógica de
   FIFO duplicada em 4 rotas diferentes, senha de exclusão hardcoded
   (`'1234'`), sem validação de dados, valores monetários em `REAL`
   (float), e um bug onde o card de "Saldo" nunca atualizava (lia
   `data.saldoVal`, mas a API retornava `saldoValor`).

2. **Revisão completa (segurança/performance/estrutura):** reescrevi o
   projeto inteiro, modularizado:
   - `server.js` — ponto de entrada, rate limiting, encerramento gracioso.
   - `db.js` — conexão SQLite via pacote `sqlite` (async/await), com índices
     e modo WAL.
   - `lib/fifo.js` — **toda** a lógica de custeio FIFO centralizada aqui
     (antes estava duplicada 4x). Processa as linhas UMA vez e devolve
     `historico`, `estoque` e `consumo`.
   - `middleware/auth.js` — autenticação simples por header `x-api-key`,
     comparado com `crypto.timingSafeEqual` contra a variável de ambiente
     `API_KEY`.
   - `routes/inventario.js` — todas as rotas da API + validação de entrada
     (tipos, obrigatoriedade, bloqueio de saída maior que o estoque
     disponível).
   - `public/index.html`, `public/css/style.css`, `public/js/app.js` —
     front-end separado em arquivos (antes era tudo inline num único HTML).
   - **Valores monetários agora são guardados em CENTAVOS (INTEGER)** no
     banco, não em `REAL`, pra evitar erro de arredondamento acumulado. A
     conversão pra reais acontece só na resposta da API
     (`routes/inventario.js`, função `centavosParaReais`).
   - Correção do bug do `saldoVal` → `saldoValor`.

3. **Ajustes de UI a pedido do usuário, em sequência:**
   - As 3 abas (Registro/Histórico, Estoque Atual, Consumo por Setor) viraram
     um grid de 3 colunas fixas que sempre cabem na tela, sem scroll
     horizontal.
   - O card "💰 Balanço" virou um botão colapsável (`app.toggleResumo()`),
     com o estado (aberto/fechado) salvo em `localStorage` sob a chave
     `resumoColapsado`.
   - Pediram tabelas em formato vertical (cards empilhados) → depois
     pediram para VOLTAR ao formato horizontal tradicional (cabeçalho fixo
     no topo, `position: sticky`, com scroll lateral em telas pequenas).
     **O estado atual é horizontal**, não confundir com uma versão anterior
     que tinha virado "card".
   - Coluna "Dias em Estoque": pediram primeiro no Histórico (dias desde a
     data da movimentação), depois pediram pra mover pro Estoque Atual — lá
     ela significa algo mais útil: **dias desde a data do lote mais antigo
     que AINDA tem saldo** (calculado a partir do campo `entradas_historico`
     que a API retorna, no formato `data|qtd_original|qtd_restante|centavos`
     separado por `;`, do lote mais novo pro mais velho).
   - Botão de excluir na tabela "Consultar Consumo" (`app.deleteConsumo`):
     como uma linha ali pode agregar MAIS DE UMA movimentação de saída
     (mesma data+setor+funcionário+item), a função `lib/fifo.js` agora
     rastreia um array `ids: []` dentro de cada grupo do `consumoMap`,
     exposto pela API em `/api/relatorio-consumo`. O botão apaga TODAS as
     movimentações daquele grupo, usando a MESMA `x-api-key` já usada no
     Histórico (reaproveita `app.getApiKey()`).

## Estrutura de arquivos atual

```
inventario-app/
├── package.json
├── .env.example
├── server.js
├── db.js
├── lib/
│   └── fifo.js
├── middleware/
│   └── auth.js
├── routes/
│   └── inventario.js
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
└── README.md
```

## ⚠️ PROBLEMA EM ABERTO (é o que estávamos resolvendo quando geramos este pacote)

O usuário tentou hospedar o projeto e passou por duas plataformas:

1. **Cloudflare Workers/Pages** — **não funciona** com este projeto como
   está. Motivo: Workers roda em V8 isolates, sem sistema de arquivos
   persistente e sem suporte a addons nativos compilados. Isso quebra:
   - `sqlite3` (binding nativo C++, não roda no Workers).
   - `process.env` + `dotenv` (no Workers as variáveis chegam via um objeto
     `env` passado à função, não pelo `process.env` global).
   - O sintoma relatado foi: toda vez que digitava a `API_KEY`, dava "Chave
     de acesso inválida" — e depois confirmamos via console do navegador que
     `/api/inventario` retornava **404**, ou seja, o Express nem estava
     rodando; só os arquivos estáticos foram servidos pelo Cloudflare Pages.

2. **Migrou para Render.com** (recomendação dada: plataforma que roda
   Node.js de verdade, com sistema de arquivos persistente, sem precisar
   mudar código). Passos que passamos ao usuário:
   - Subir o projeto pro GitHub (sem `.env` nem `node_modules`).
   - Criar conta no Render, "New" → "Web Service", conectar o repo.
   - Build Command: `npm install`. Start Command: `node server.js` (ou
     `npm start`).
   - Configurar variáveis de ambiente no painel do Render: `PORT` e
     `API_KEY`.
   - Alertamos que o **plano Free do Render pode não ter disco persistente
     garantido entre reinícios** — isso é um risco para o arquivo
     `inventario.db` (SQLite local). Se os dados sumirem após um restart,
     é provável que seja por isso; nesse caso a solução seria configurar um
     "Persistent Disk" (pago) no Render, ou migrar para um banco externo
     (ex: Render Postgres, ou manter SQLite mas montado num disco
     persistente).

   Depois do primeiro deploy no Render, o usuário reportou:
   - `npm install` mostrou **10 vulnerabilidades (2 low, 3 moderate, 4 high,
     1 critical)** — ainda NÃO recebemos a saída detalhada de `npm audit`
     pra saber exatamente quais pacotes/CVEs são. Prováveis suspeitos:
     dependências transitivas do `sqlite3` (que arrasta `node-gyp`, `tar`,
     etc., historicamente com vulnerabilidades). Se confirmado, a sugestão
     era trocar `sqlite3` por `better-sqlite3` (mais moderno, menos
     dependências, API síncrona — exigiria reescrever `db.js` e as queries
     em `routes/inventario.js` de async/await para chamadas síncronas).
   - Ao tentar abrir o site publicado, deu **"Not Found"**. Estávamos no
     meio do diagnóstico: perguntamos (1) se o status do serviço no painel
     do Render está "Live" (verde) ou com erro, e (2) se a página "Not
     Found" é a página padrão do navegador/Render ou tem visual do próprio
     app. **Ainda não recebemos essas respostas.**

### Próximos passos sugeridos para quem continuar

1. Pegar a resposta do usuário sobre o status do serviço no Render (Live?
   erro nos logs? build falhou?) e sobre a aparência da página "Not Found".
   Causas prováveis de "Not Found" no Render: build falhou silenciosamente,
   Start Command errado, o serviço ainda está fazendo deploy, ou a rota
   raiz não está sendo servida por algum motivo (checar se
   `express.static(path.join(__dirname, 'public'))` está de fato apontando
   pro lugar certo depois do build do Render).
2. Pedir a saída completa de `npm audit` pra decidir se basta `npm audit
   fix` ou se vale trocar `sqlite3` por `better-sqlite3`.
3. Confirmar com o usuário se o Render Free tier está mantendo o arquivo
   `inventario.db` entre deploys/restarts (persistência de disco). Se não
   estiver, decidir entre: (a) plano pago com Persistent Disk, (b) migrar
   pra Render Postgres, ou (c) outro provedor (Railway/Fly.io) com
   armazenamento persistente mais simples de configurar.

## Coisas importantes pra não esquecer

- A senha antiga de exclusão (`'1234'`) **não existe mais** — tudo (POST e
  DELETE) exige o header `x-api-key` batendo com a variável de ambiente
  `API_KEY`.
- O schema do banco mudou de `valor_unitario REAL` para
  `valor_unitario_centavos INTEGER` — **não é compatível** com um
  `inventario.db` antigo gerado pela primeira versão do projeto.
- O front-end guarda a API key em `sessionStorage` (não `localStorage`) —
  some ao fechar a aba, por design.
- O card de Balanço colapsado/expandido é lembrado via `localStorage`
  (`resumoColapsado`), separado da API key.
