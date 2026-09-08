// Guarda y lee la lista de conversos en Upstash Redis.
// Vercel inyecta las credenciales al instalar la integración de Upstash.

const URL_REDIS   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN_REDIS = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CODIGO = process.env.CODIGO_ACCESO || '';
const LLAVE = 'conversos';

async function redis(comando) {
  const r = await fetch(URL_REDIS, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN_REDIS}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(comando)
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
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
