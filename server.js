require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { getDb, closeDb } = require('./db');
const inventarioRoutes = require('./routes/inventario');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Limita tentativas em rotas de escrita (mitiga força bruta contra a API_KEY
// e evita abuso geral). 60 requisições / 15 min por IP é folgado para uso
// normal, mas barra automações abusivas.
const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' }
});
app.use('/api/inventario', (req, res, next) => {
    if (req.method === 'POST' || req.method === 'DELETE') return writeLimiter(req, res, next);
    next();
});

app.use('/api', inventarioRoutes);

// Inicializa o banco antes de subir o servidor (evita corrida entre
// primeira requisição e criação das tabelas/índices).
async function start() {
    await getDb();
    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));

    const encerrar = async () => {
        console.log('\nEncerrando servidor...');
        server.close();
        await closeDb();
        process.exit(0);
    };

    process.on('SIGINT', encerrar);
    process.on('SIGTERM', encerrar);
}

start().catch(err => {
    console.error('Falha ao iniciar o servidor:', err);
    process.exit(1);
});
