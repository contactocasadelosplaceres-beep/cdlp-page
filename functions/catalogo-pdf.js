/* Cloudflare Pages Function: GET /catalogo-pdf
   Entrega el catálogo en PDF con la dirección de la tienda (casaplaceres.com/catalogo-pdf).
   El PDF lo genera el workflow "Catálogo estático" cada vez que se publica la tienda y lo sube como
   archivo de la versión "catalogo" de GitHub; así no se guarda en el repositorio ni gasta
   compilaciones de Cloudflare. Se guarda 10 min en la caché de Cloudflare. */
const SRC = 'https://github.com/contactocasadelosplaceres-beep/cdlp-page/releases/download/catalogo/catalogo.pdf';

export async function onRequest({ request }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Método no permitido', { status: 405 });
  const res = await fetch(SRC, { redirect: 'follow', cf: { cacheTtl: 600, cacheEverything: true } });
  if (!res.ok) {
    return new Response('El catálogo se está actualizando. Intenta de nuevo en unos minutos o entra a casaplaceres.com', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '300' },
    });
  }
  const headers = new Headers({
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="Catalogo-La-Casa-de-los-Placeres.pdf"',
    'Cache-Control': 'public, max-age=600',
  });
  const len = res.headers.get('Content-Length'); if (len) headers.set('Content-Length', len);
  return new Response(request.method === 'HEAD' ? null : res.body, { status: 200, headers });
}
