/* Cloudflare Pages Function: GET /catalogo
   La app instalable "CDLP Catálogo" vive en /catalogo (no en la raíz) para que su alcance (scope)
   NO abarque /admin ni /pos: en Android, si una app instalada cubre la raíz del sitio, Chrome cree
   que el panel y el punto de venta "ya están instalados" y no deja instalarlos aparte.
   Aquí solo se entrega la misma página de la tienda (index.html), conservando ?producto=…, así
   que no hay una segunda copia que mantener. Los enlaces que se comparten siguen saliendo con la
   dirección normal de la tienda (casaplaceres.com/?producto=…). */
export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Método no permitido', { status: 405 });
  const url = new URL(request.url);
  url.pathname = '/';
  const res = await env.ASSETS.fetch(new Request(url.toString(), { method: request.method, headers: request.headers }));
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-cache');
  return out;
}
