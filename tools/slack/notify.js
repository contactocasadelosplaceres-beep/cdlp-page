/* Avisos a Slack de cada pedido de la tienda y cada venta del Punto de Venta.
   Antes los mandaba el navegador de la clienta/cajera con el webhook guardado en settings/store, que es
   público. Ahora los manda esta Action (cada ~5 min) y el webhook vive como secreto SLACK_WEBHOOK_URL.

   Cómo funciona: guarda un "cursor" (fecha del último pedido/venta avisado) en notifyState/slack, que no
   tiene regla para el navegador (solo esta Action, con la cuenta de servicio, puede leerlo). Cada corrida
   cuesta ~3 lecturas: el cursor y una consulta por colección con solo lo posterior.
   Primera corrida: pone el cursor en "ahora" (no avisa lo anterior). Si Slack falla, el cursor no avanza y
   se reintenta en la siguiente corrida (sin duplicar lo ya enviado).
   Webhook: usa SLACK_WEBHOOK_URL; si ese secreto no existe, usa settings/store.slackWebhookUrl (el de antes)
   para que los avisos no se interrumpan. Cuando el secreto existe, borra ese campo público de settings/store. */
const admin = require('firebase-admin');
const env = process.env;
const MAX_PER_RUN = 25;

const money = n => '$' + Number(Math.round(Number(n) || 0)).toLocaleString('es-MX') + ' MXN';
const folio = n => (n ? `#${n}` : '');
const lines = items => (items || []).map(it => `• ${it.qty}x ${it.name}`).join('\n');

function orderText(o) {
  return `🛒 *Nuevo pedido* ${folio(o.orderNumber)}\nCliente: ${o.customer || 'Sin nombre'} (${o.phone || 's/t'})\nProducto:\n${lines(o.items)}\nDirección: ${o.address || '—'}\nTotal: ${money(o.total)} (no incluye envío)`;
}
function saleText(s) {
  const cli = s.customerName ? `\nCliente: ${s.customerName}${s.customerPhone ? ` (${s.customerPhone})` : ''}` : '';
  return `💰 *Nueva venta* ${folio(s.orderNumber)} — ${s.centerName || 'POS'}\nAtendió: ${s.cashierName || '—'}\nProducto:\n${lines(s.items)}${cli}\nTotal: ${money(s.total)}`;
}

async function post(url, text) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!r.ok) throw new Error(`Slack respondió ${r.status}`);
}

let CUR = null; // cursor en memoria: en el modo continuo solo se lee notifyState/slack una vez
async function main() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore();
  const stRef = db.collection('notifyState').doc('slack');
  const nowIso = new Date().toISOString();
  if (!CUR) {
    const st = await stRef.get();
    if (!st.exists) {
      await stRef.set({ ordersCursor: nowIso, salesCursor: nowIso, createdAt: nowIso });
      CUR = { ordersCursor: nowIso, salesCursor: nowIso };
      console.log('Primera corrida: cursor inicial en ahora. No se avisa nada anterior.');
      return;
    }
    CUR = st.data();
  }
  const cur = CUR;
  const [oSnap, sSnap] = await Promise.all([
    db.collection('orders').where('date', '>', cur.ordersCursor).orderBy('date').limit(MAX_PER_RUN).get(),
    db.collection('sales').where('date', '>', cur.salesCursor).orderBy('date').limit(MAX_PER_RUN).get(),
  ]);
  const pend = [
    ...oSnap.docs.map(d => ({ kind: 'order', id: d.id, d: d.data() })),
    ...sSnap.docs.map(d => ({ kind: 'sale', id: d.id, d: d.data() })),
  ].sort((a, b) => String(a.d.date).localeCompare(String(b.d.date)));
  if (!pend.length && (cur.webhookMigrated || !String(env.SLACK_WEBHOOK_URL || '').trim())) { console.log('Nada nuevo.'); return; }

  let url = (env.SLACK_WEBHOOK_URL || '').trim();
  const usingSecret = !!url;
  let storeRef = null, storeData = null;
  if (pend.length || !cur.webhookMigrated) {
    storeRef = db.collection('settings').doc('store');
    const s = await storeRef.get(); storeData = s.exists ? s.data() : {};
    if (!url) url = String(storeData.slackWebhookUrl || '').trim();
  }
  const upd = {};
  let sent = 0;
  if (!url && pend.length) console.log('AVISO: no hay webhook de Slack (ni secreto SLACK_WEBHOOK_URL ni en settings/store). Se omiten los avisos.');
  for (const p of pend) {
    if (p.d.historical || p.d.importedFrom) { upd[p.kind === 'order' ? 'ordersCursor' : 'salesCursor'] = p.d.date; continue; }
    if (url) {
      try { await post(url, p.kind === 'order' ? orderText(p.d) : saleText(p.d)); sent++; }
      catch (e) { console.log('Falló el aviso, se reintenta en la siguiente corrida:', e.message); break; }
    }
    upd[p.kind === 'order' ? 'ordersCursor' : 'salesCursor'] = p.d.date;
  }
  // Con el secreto ya configurado, el webhook deja de estar en el documento público.
  if (usingSecret && storeData && storeData.slackWebhookUrl) {
    await storeRef.update({ slackWebhookUrl: admin.firestore.FieldValue.delete() });
    console.log('Se quitó slackWebhookUrl de settings/store (ahora vive en el secreto SLACK_WEBHOOK_URL).');
  }
  if (usingSecret) upd.webhookMigrated = true;
  if (Object.keys(upd).length) { await stRef.set(upd, { merge: true }); CUR = Object.assign({}, CUR, upd); }
  console.log(`Pedidos/ventas nuevos: ${pend.length} · avisos enviados: ${sent}${usingSecret ? ' · webhook: secreto' : ' · webhook: settings/store (heredado)'}`);
}
/* MODO CONTINUO: GitHub corre los horarios "cada 5 min" con horas de retraso (se vio un aviso llegar
   3–5 h tarde). Con LOOP_MINUTES > 0 la corrida se queda revisando cada INTERVAL_SEC segundos
   (~2 lecturas por revisión) y, antes de terminar, se vuelve a lanzar sola (workflow_dispatch con el
   GITHUB_TOKEN, que GitHub sí permite). Así siempre hay una revisando y el aviso llega en ~1 minuto. */
async function relaunch() {
  const repo = env.GITHUB_REPOSITORY, token = env.GITHUB_TOKEN;
  if (!repo || !token) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/slack.yml/dispatches`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, body: JSON.stringify({ ref: env.GITHUB_REF_NAME || 'main' }) });
    console.log(`Siguiente turno de avisos: ${r.status === 204 ? 'lanzado' : 'no se pudo (' + r.status + ')'}`);
  } catch (e) { console.log('No se pudo lanzar el siguiente turno:', e.message); }
}
/* HORARIO DE AVISOS: solo se revisa entre HORA_INICIO y HORA_FIN (hora de Ciudad Guzmán, UTC-6 todo el
   año). Fuera de ese horario no se lee nada: la corrida espera dormida y, al abrir, la primera revisión
   manda juntos los pedidos y ventas que llegaron de noche (el cursor guarda dónde se quedó). */
const OFFSET_H = Number(env.UTC_OFFSET_HORAS || -6), H_START = Number(env.HORA_INICIO || 8), H_END = Number(env.HORA_FIN || 21);
const localHour = t => (new Date(t + OFFSET_H * 3600000)).getUTCHours() + (new Date(t + OFFSET_H * 3600000)).getUTCMinutes() / 60;
const inWindow = t => { const h = localHour(t); return h >= H_START && h < H_END; };
function msUntilOpen(t) {
  const loc = new Date(t + OFFSET_H * 3600000);
  const open = Date.UTC(loc.getUTCFullYear(), loc.getUTCMonth(), loc.getUTCDate(), H_START) - OFFSET_H * 3600000;
  return open > t ? open - t : open + 86400000 - t;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* VIGILANTE DEL CATÁLOGO: el horario "cada 20 min" de catalogo.yml también lo corre GitHub con horas de
   retraso (se vio pasar 11 h sin publicar), así que los cambios de productos tardaban en verse en la
   tienda. Esta misma corrida continua lee settings/publish (1 lectura) cada CATALOGO_CADA_MIN minutos
   en horario (CATALOGO_NOCHE_MIN de noche) y, si el panel pidió publicar o ya toca el refresco de
   existencias, lanza "Catálogo estático" al momento. build.js decide igual que siempre (no fuerza nada). */
const CAT_EVERY = Math.max(2, Number(env.CATALOGO_CADA_MIN || 5)) * 60000;
const CAT_NIGHT = Math.max(5, Number(env.CATALOGO_NOCHE_MIN || 30)) * 60000;
const CAT_MIN_GAP = Number(env.MIN_GAP_MINUTOS || 45), CAT_MAX_AGE_H = Number(env.MAX_AGE_HORAS || 6);
let catNext = 0, catLastDispatch = 0;
async function catalogWatch() {
  const t = Date.now(); if (t < catNext) return; catNext = t + (inWindow(t) ? CAT_EVERY : CAT_NIGHT);
  const repo = env.GITHUB_REPOSITORY, token = env.GITHUB_TOKEN; if (!repo || !token) return;
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
  const pub = (await admin.firestore().collection('settings').doc('publish').get()).data() || {};
  const ageMin = pub.publishedAt ? (t - new Date(pub.publishedAt).getTime()) / 60000 : Infinity;
  const requested = pub.requestedAt && (!pub.publishedAt || pub.requestedAt > pub.publishedAt) && (pub.urgent === true || ageMin >= CAT_MIN_GAP);
  const why = requested ? 'el panel pidió publicar' : ageMin >= CAT_MAX_AGE_H * 60 ? 'refresco de existencias' : null;
  if (!why || t - catLastDispatch < 12 * 60000) return; // no relanzar mientras la anterior aún corre
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/catalogo.yml/dispatches`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, body: JSON.stringify({ ref: env.GITHUB_REF_NAME || 'main', inputs: { force: '0', dry_run: '0' } }) });
  catLastDispatch = t;
  console.log(`Catálogo: ${why} → ${r.status === 204 ? 'publicación lanzada' : 'no se pudo lanzar (' + r.status + ')'}`);
}
const catSafe = async () => { try { await catalogWatch(); } catch (e) { console.log('Vigilante del catálogo:', e.message); } };
(async () => {
  const loopMin = Number(env.LOOP_MINUTES || 0), every = Math.max(30, Number(env.INTERVAL_SEC || 60)) * 1000;
  if (!loopMin) { if (inWindow(Date.now()) || env.FORZAR === '1') await main(); else console.log('Fuera del horario de avisos; no se revisa.'); return; }
  const end = Date.now() + loopMin * 60000;
  let fails = 0;
  while (Date.now() < end) {
    if (!inWindow(Date.now())) {
      await catSafe();
      const wait = Math.min(msUntilOpen(Date.now()), end - Date.now(), CAT_NIGHT);
      console.log(`Fuera del horario de avisos (${H_START}:00–${H_END}:00). Sin avisos; espero ${Math.round(wait / 60000)} min (solo se revisa el catálogo).`);
      await sleep(Math.max(1000, wait));
      continue;
    }
    await catSafe();
    try { await main(); fails = 0; } catch (e) { fails++; console.error('Revisión fallida:', e.message); if (fails >= 10) break; }
    await sleep(every);
  }
  await relaunch();
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
