/* Cloudflare Pages Function: POST /api/publicar
   Botón "Publicar tienda ahora" del panel. Pide a GitHub que corra YA el workflow
   "Catálogo estático" (catalogo.yml) en vez de esperar la revisión programada, que GitHub
   corre con mucho retraso (cada ~2 h en la práctica aunque esté puesta cada 20 min).

   Seguridad:
   - Solo personal con sesión de Firebase válida: se verifica la firma del ID token con las
     llaves públicas de Google, el proyecto, la caducidad y que tenga el claim admin o staff
     y el segundo factor (MFA), igual que exigen las reglas de Firestore (strongSession).
   - El token de GitHub vive SOLO como secreto en Cloudflare (variable GITHUB_TOKEN), nunca
     en el navegador. Debe ser un token "fine-grained" limitado al repositorio cdlp-page con
     permiso Actions: Read and write.
   - Esto solo hace que el catálogo se regenere antes; los datos salen de Firestore igual que
     siempre, así que llamarlo de más no cambia nada de la tienda.

   Variables en Cloudflare (Pages → casaplaceres → Settings → Variables and Secrets):
     GITHUB_TOKEN   (secreto, obligatorio)
     GITHUB_REPO    (opcional, por defecto contactocasadelosplaceres-beep/cdlp-page)
     FIREBASE_PROJECT (opcional, por defecto casa-de-los-placeres) */

const DEFAULT_REPO = 'contactocasadelosplaceres-beep/cdlp-page';
const DEFAULT_PROJECT = 'casa-de-los-placeres';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const MAX_SESSION_DAYS = 30;

let jwksCache = { keys: null, until: 0 };

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function googleKeys() {
  const now = Date.now();
  if (jwksCache.keys && now < jwksCache.until) return jwksCache.keys;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error('No se pudieron leer las llaves de Google (' + r.status + ')');
  const data = await r.json();
  const m = /max-age=(\d+)/.exec(r.headers.get('Cache-Control') || '');
  jwksCache = { keys: data.keys || [], until: now + (m ? Number(m[1]) * 1000 : 3600 * 1000) };
  return jwksCache.keys;
}

async function verifyFirebaseIdToken(token, projectId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('token mal formado');
  const header = b64urlToJson(parts[0]);
  const payload = b64urlToJson(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('algoritmo no válido');

  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('llave desconocida');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('firma no válida');

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error('proyecto no válido');
  if (payload.iss !== 'https://securetoken.google.com/' + projectId) throw new Error('emisor no válido');
  if (!payload.sub) throw new Error('sin usuario');
  if (typeof payload.exp !== 'number' || payload.exp <= now - 60) throw new Error('sesión caducada');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new Error('fecha no válida');
  return payload;
}

export async function onRequestPost({ request, env }) {
  const projectId = env.FIREBASE_PROJECT || DEFAULT_PROJECT;
  const repo = env.GITHUB_REPO || DEFAULT_REPO;

  if (!env.GITHUB_TOKEN) {
    return json(503, { ok: false, error: 'falta-token', mensaje: 'Falta configurar GITHUB_TOKEN en Cloudflare.' });
  }

  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return json(401, { ok: false, error: 'sin-sesion' });

  let claims;
  try {
    claims = await verifyFirebaseIdToken(m[1], projectId);
  } catch (e) {
    return json(401, { ok: false, error: 'sesion-invalida', detalle: String(e.message || e) });
  }

  const team = claims.admin === true || claims.staff === true;
  const fb = claims.firebase || {};
  const mfa = fb.sign_in_second_factor != null;
  const fresh = typeof claims.auth_time === 'number' &&
    Date.now() < (claims.auth_time * 1000) + MAX_SESSION_DAYS * 86400 * 1000;
  if (!team) return json(403, { ok: false, error: 'sin-permiso' });
  if (!mfa || !fresh) return json(403, { ok: false, error: 'sesion-debil', mensaje: 'Vuelve a iniciar sesión con tu código de 6 dígitos.' });

  let agotado = false;
  try { const b = await request.clone().json(); agotado = !!(b && b.motivo === 'agotado'); } catch (_) {}

  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/catalogo.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'casaplaceres-publicar',
      'Content-Type': 'application/json',
    },
    // force=0: el workflow regenera porque el panel acaba de marcar la petición como urgente
    // (settings/publish); si no hay nada pendiente, termina sin gastar nada.
    // existencias=1: el punto de venta acaba de agotar un producto que la tienda muestra disponible
    // (el POS no tiene permiso de escribir settings/publish, así que lo avisa por aquí).
    body: JSON.stringify({ ref: 'main', inputs: { force: '0', dry_run: '0', existencias: agotado ? '1' : '0' } }),
  });

  if (r.status === 204) return json(200, { ok: true });
  const txt = (await r.text()).slice(0, 300);
  return json(502, { ok: false, error: 'github', status: r.status, detalle: txt });
}

export function onRequest() {
  return json(405, { ok: false, error: 'usa POST' });
}
