// Guarda y lee la lista de conversos en Upstash Redis.
// Vercel inyecta las credenciales al instalar la integración de Upstash.

const URL_REDIS   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN_REDIS = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CODIGO = process.env.CODIGO_ACCESO || '';
const LLAVE = 'conversos';

async function redis(comando) {
  let r;
  try {
    r = await fetch(URL_REDIS, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN_REDIS}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(comando),
      signal: AbortSignal.timeout(8000)
    });
  } catch (e) {
    // Sin esto, el error llega como un escueto "fetch failed" y no se sabe por qué.
    const causa = e.cause?.code || e.cause?.message || e.name || '';
    const host = (() => { try { return new URL(URL_REDIS).host; } catch (_) { return URL_REDIS; } })();
    if (causa === 'ENOTFOUND' || causa === 'EAI_AGAIN') {
      throw new Error(`La base de datos ya no existe: el nombre ${host} no resuelve. Upstash archiva las bases gratuitas que pasan meses sin uso. Crea una nueva en Vercel → Storage y vuelve a desplegar.`);
    }
    if (causa === 'ECONNREFUSED' || causa === 'UND_ERR_CONNECT_TIMEOUT' || e.name === 'TimeoutError') {
      throw new Error(`No se pudo conectar con ${host} (${causa || 'tiempo agotado'}). La base puede estar pausada o archivada.`);
    }
    throw new Error(`Fallo de red hacia ${host}: ${causa || e.message}`);
  }
  const texto = await r.text();
  let j;
  try { j = JSON.parse(texto); }
  catch (_) { throw new Error(`Respuesta inesperada de la base (HTTP ${r.status}): ${texto.slice(0, 120)}`); }
  if (j.error) throw new Error(`La base rechazó el comando: ${j.error}`);
  if (!r.ok) throw new Error(`La base respondió HTTP ${r.status}`);
  return j.result;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!URL_REDIS || !TOKEN_REDIS) {
    return res.status(500).json({ error: 'Falta conectar la base de datos. Instala la integración de Upstash Redis en el proyecto de Vercel y vuelve a desplegar.' });
  }
  if (CODIGO && req.headers['x-codigo'] !== CODIGO) {
    return res.status(401).json({ error: 'Código de acceso incorrecto.' });
  }

  try {
    if (req.method === 'GET') {
      const plano = (await redis(['HGETALL', LLAVE])) || [];
      const personas = [];
      for (let i = 1; i < plano.length; i += 2) {
        try { personas.push(JSON.parse(plano[i])); } catch (e) { /* fila corrupta, se ignora */ }
      }
      return res.status(200).json({ personas });
    }

    if (req.method === 'POST') {
      let cuerpo = req.body;
      if (typeof cuerpo === 'string') cuerpo = JSON.parse(cuerpo);
      const guardar = Array.isArray(cuerpo?.guardar) ? cuerpo.guardar : [];
      const borrar  = Array.isArray(cuerpo?.borrar)  ? cuerpo.borrar  : [];

      if (guardar.length) {
        const pares = [];
        guardar.forEach(p => { if (p && p.id) pares.push(String(p.id), JSON.stringify(p)); });
        // en bloques, para no mandar un comando gigante
        for (let i = 0; i < pares.length; i += 200) {
          await redis(['HSET', LLAVE, ...pares.slice(i, i + 200)]);
        }
      }
      if (borrar.length) await redis(['HDEL', LLAVE, ...borrar.map(String)]);

      return res.status(200).json({ ok: true, guardados: guardar.length, borrados: borrar.length });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
