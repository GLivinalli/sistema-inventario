const crypto = require('crypto');

/**
 * Exige o header "x-api-key" igual ao valor configurado em API_KEY (.env).
 * Usa comparação em tempo constante (timingSafeEqual) para evitar
 * timing attacks. Antes, apenas o DELETE pedia uma senha fraca e
 * hardcoded ('1234'); agora toda escrita (POST e DELETE) exige a chave.
 */
function requireApiKey(req, res, next) {
    const configured = process.env.API_KEY;
    const provided = req.headers['x-api-key'] || '';

    if (!configured) {
        console.error('API_KEY não configurada no .env — recusando escrita por segurança.');
        return res.status(500).json({ error: 'Servidor mal configurado: API_KEY ausente.' });
    }

    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(configured));

    const valido = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!valido) {
        return res.status(401).json({ error: 'Chave de acesso inválida.' });
    }

    next();
}

module.exports = { requireApiKey };
