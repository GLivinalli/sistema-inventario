const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let dbInstance = null;

async function getDb() {
    if (dbInstance) return dbInstance;

    dbInstance = await open({
        filename: path.join(__dirname, 'inventario.db'),
        driver: sqlite3.Database
    });

    await dbInstance.exec('PRAGMA foreign_keys = ON');
    await dbInstance.exec('PRAGMA journal_mode = WAL');

    // Valores monetários são guardados em CENTAVOS (INTEGER) para evitar
    // erros de arredondamento acumulados que ocorrem com REAL/float.
    await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS inventario (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT NOT NULL CHECK(tipo IN ('Entrada', 'Saída')),
            data TEXT NOT NULL,
            item TEXT NOT NULL,
            fabricante TEXT NOT NULL,
            quantidade INTEGER NOT NULL CHECK(quantidade > 0),
            valor_unitario_centavos INTEGER NOT NULL DEFAULT 0 CHECK(valor_unitario_centavos >= 0),
            responsavel TEXT NOT NULL,
            setor TEXT DEFAULT '',
            funcionario_destino TEXT DEFAULT '',
            criado_em TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Índices nas colunas mais filtradas/agrupadas (item+fabricante formam a
    // "chave" do produto usada no cálculo de FIFO; data é usada em filtros
    // de mês e ordenação).
    await dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_inventario_item_fabricante ON inventario(item, fabricante)`);
    await dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_inventario_data ON inventario(data)`);
    await dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_inventario_tipo ON inventario(tipo)`);

    console.log('Conectado ao banco de dados SQLite (com WAL + índices).');
    return dbInstance;
}

async function closeDb() {
    if (dbInstance) {
        await dbInstance.close();
        dbInstance = null;
        console.log('Conexão com o banco encerrada.');
    }
}

module.exports = { getDb, closeDb };
