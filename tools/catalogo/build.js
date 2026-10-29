/* Catálogo estático: genera catalogo.json en la raíz del repo con lo que la tienda pública necesita
   (productos visibles, ajustes públicos, número de pedidos). index.html lo carga como archivo, así
   cada visita cuesta CERO lecturas de Firestore.

   Cuándo se regenera (decide este script, el workflow solo lo lanza cada 20 min):
     1) Si el panel pidió publicar (settings/publish.requestedAt > publishedAt) -> regenera. El botón
        "Publicar tienda" marca la petición como urgente (se atiende en el siguiente ciclo de 20 min);
        las peticiones automáticas por guardar productos/ajustes esperan al menos MIN_GAP_MINUTOS
        desde la última publicación, para que muchas ediciones seguidas cuesten una sola regeneración.
     2) Si pasaron MAX_AGE_HORAS desde la última publicación -> regenera (refresca existencias).
     3) Si catalogo.json no existe, o FORCE=1 (corrida manual) -> regenera.
     4) Si no, solo costó 1 lectura (settings/publish) y termina.
   NUNCA publica: costos, historial de costo, proveedor, existencias por centro, lotes, ubicación,
   caducidad ni umbrales internos; tampoco productos ocultos o en la papelera. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const admin = require('firebase-admin');
const env = process.env;
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'catalogo.json');
const MAX_AGE_H = Number(env.MAX_AGE_HORAS || 6);
const MIN_GAP_MIN = Number(env.MIN_GAP_MINUTOS || 45); // entre publicaciones automáticas (las urgentes del botón no esperan)
const FORCE = env.FORCE === '1';
const FULL_H = Number(env.FULL_HORAS || 24); // relectura completa de productos como máximo cada FULL_H horas; entre tanto, solo los que cambiaron (sello _sync)
const DRY_RUN = env.DRY_RUN === '1';
const SITE_URL = env.SITE_URL || 'https://contactocasadelosplaceres-beep.github.io/cdlp-page/';

// Campos de producto que NO salen en el JSON público.
const PRIV_PRODUCT = ['cost', 'costHistory', 'supplierId', 'stockByCenter', 'batches', 'expirationDate',
  'lowStockThreshold', 'location', 'createdBy', 'updatedBy', 'deletedBy', 'deletedAt', 'internalNotes', 'internalNote', '_sync',
  'mgTier', 'promoCandidate']; // mgTier = nivel de margen (S-02): no se publica
const PRIV_VARIANT = ['cost', 'stockByCenter', 'supplierId'];
// Ajustes que son solo del panel (la tienda no los usa).
const PRIV_SETTINGS = ['recurringExpenses', 'salesGoalMonthly', 'duplicatesIgnored', 'deliveryWhatsapp', 'storeAddress',
  'repurchaseProductIds', 'repurchaseDays', 'churnRiskDays', 'churnRiskMinPurchases', 'deliverySurveyQuestions',
  'bestSellersUpdatedAt', 'slackWebhookUrl', 'ai',
  // notas y controles internos del panel: la tienda no los usa
  'dashboardNotes', 'checklists', 'monthCloses', 'repurchaseNotified', 'churnRiskNotified', 'dismissedHealthItems', 'spellIgnore'];
const SECRET_KEY = /(secret|token|password|passwd|apikey|api_key|privatekey)/i;

const isData = s => typeof s === 'string' && s.startsWith('data:');
const MAX_BASE64_TOTAL = 1.5 * 1024 * 1024; // tope de fotos base64 aún no convertidas que se incluyen en el JSON

function cleanProduct(id, d, budget) {
  const p = { id, ...d };
  PRIV_PRODUCT.forEach(k => { delete p[k]; });
  if (Array.isArray(p.variants)) p.variants = p.variants.map(v => { if (!v || typeof v !== 'object') return v; const c = { ...v }; PRIV_VARIANT.forEach(k => delete c[k]); return c; });
  if (Array.isArray(p.images)) {
    p.images = p.images.filter(s => {
      if (!isData(s)) return true;
      if (budget.used + s.length > MAX_BASE64_TOTAL) { budget.dropped++; return false; }
      budget.used += s.length; return true;
    });
  }
  return p;
}
function cleanSettings(s) {
  const out = {};
  Object.keys(s || {}).forEach(k => { if (!PRIV_SETTINGS.includes(k) && !SECRET_KEY.test(k)) out[k] = s[k]; });
  return out;
}
// productStock/{id} (S-01): lo único que la tienda lee de Firestore, para revisar existencias al enviar el pedido.
// El panel y el POS lo actualizan al guardar; aquí se corrige por si alguna copia falló.
function stockView(d) {
  if (!d || d.hidden || d.deletedAt) return { stock: 0, variants: [] };
  return { stock: Math.max(0, Number(d.stock) || 0),
    variants: (Array.isArray(d.variants) ? d.variants : []).filter(v => v && v.id != null).map(v => ({ id: String(v.id), stock: Math.max(0, Number(v.stock) || 0) })) };
}
async function writeStock(db, docs) {
  if (DRY_RUN || !docs.length) return;
  const now = new Date().toISOString();
  for (let i = 0; i < docs.length; i += 400) {
    const b = db.batch();
    docs.slice(i, i + 400).forEach(d => b.set(db.collection('productStock').doc(d.id), Object.assign(stockView(d.data()), { updatedAt: now })));
    await b.commit();
  }
  console.log(`productStock: ${docs.length} existencia(s) copiadas.`);
}
function stable(o) { return JSON.stringify(o); }
function git(cmd) { return execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString().trim(); }

async function requestPagesBuild() {
  const repo = env.GITHUB_REPOSITORY, token = env.GITHUB_TOKEN;
  if (!repo || !token || typeof fetch !== 'function') return;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/pages/builds`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    console.log(`Solicitud de publicación a GitHub Pages: ${r.status}`);
  } catch (e) { console.log('No se pudo pedir la publicación a Pages:', e.message); }
}

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore();
  const pubRef = db.collection('settings').doc('publish');
  const pubSnap = await pubRef.get();                        // 1 lectura
  const pub = pubSnap.exists ? pubSnap.data() : {};
  const ageH = pub.publishedAt ? (Date.now() - new Date(pub.publishedAt).getTime()) / 36e5 : Infinity;
  const requestedRaw = pub.requestedAt && (!pub.publishedAt || pub.requestedAt > pub.publishedAt);
  const requested = requestedRaw && (pub.urgent === true || ageH * 60 >= MIN_GAP_MIN);
  if (requestedRaw && !requested) console.log(`Hay una petición automática en espera (mínimo ${MIN_GAP_MIN} min entre publicaciones; han pasado ${(ageH * 60).toFixed(0)}).`);
  const why = FORCE ? 'corrida manual' : !fs.existsSync(OUT) ? 'catalogo.json no existe' : requested ? 'el panel pidió publicar' : ageH >= MAX_AGE_H ? `pasaron ${ageH.toFixed(1)} h (refresco de existencias)` : null;
  if (!why) { console.log(`Sin cambios por publicar (última publicación hace ${ageH.toFixed(1)} h). Fin: 1 lectura.`); return; }
  console.log('Regenerando catálogo:', why);

  const startedAt = new Date().toISOString();
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const msOf = v => (v && typeof v.toMillis === 'function') ? v.toMillis() : 0;
  const fullAge = pub.fullAt ? (Date.now() - new Date(pub.fullAt).getTime()) / 36e5 : Infinity;
  // Solo lo que cambió: el panel y el POS sellan cada producto que tocan con "_sync" (hora del servidor).
  const incremental = !FORCE && prev && Array.isArray(prev.products) && prev.products.length && Number(pub.syncMax) > 0 && fullAge < FULL_H;
  const budget = { used: 0, dropped: 0 };
  let products, readCount, syncMax = Number(pub.syncMax) || 0;
  const [setSnap, cntSnap] = await Promise.all([
    db.collection('settings').doc('store').get(),
    db.collection('counters').doc('orders').get(),
  ]);
  if (incremental) {
    const since = admin.firestore.Timestamp.fromMillis(Math.max(0, syncMax - 120000));
    const [chSnap, tombSnap] = await Promise.all([
      db.collection('products').where('_sync', '>', since).get(),
      db.collection('settings').doc('syncTombstones').get(),
    ]);
    const map = new Map(prev.products.map(p => [p.id, p]));
    prev.products.forEach(p => (p.images || []).forEach(s => { if (isData(s)) budget.used += s.length; }));
    chSnap.docs.forEach(d => {
      const x = d.data(); syncMax = Math.max(syncMax, msOf(x._sync));
      if (x.hidden || x.deletedAt) map.delete(d.id); else map.set(d.id, cleanProduct(d.id, x, budget));
    });
    const tomb = (tombSnap.exists && tombSnap.data().t && tombSnap.data().t.products) || {};
    Object.keys(tomb).forEach(id => { if (map.has(id) && !chSnap.docs.some(d => d.id === id && msOf(d.data()._sync) > msOf(tomb[id]))) map.delete(id); });
    products = [...map.values()];
    readCount = chSnap.size;
    await writeStock(db, chSnap.docs);
    console.log(`Modo: solo cambios · ${chSnap.size} producto(s) cambiaron desde la última publicación`);
  } else {
    const prodSnap = await db.collection('products').get();
    prodSnap.docs.forEach(d => { syncMax = Math.max(syncMax, msOf(d.data()._sync)); });
    await writeStock(db, prodSnap.docs);
    products = prodSnap.docs
      .map(d => ({ id: d.id, data: d.data() }))
      .filter(x => !x.data.hidden && !x.data.deletedAt)
      .map(x => cleanProduct(x.id, x.data, budget));
    readCount = prodSnap.size;
    console.log(`Modo: lectura completa (${FORCE ? 'corrida manual' : !prev ? 'sin catálogo previo' : !pub.syncMax ? 'primera vez con sellos' : 'relectura diaria'})`);
  }
  products.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  console.log(`::notice::Catálogo: ${incremental ? 'solo cambios' : 'lectura completa'} · ${readCount} producto(s) leídos de Firestore`);
  const settings = cleanSettings(setSnap.exists ? setSnap.data() : {});
  const orderCount = cntSnap.exists ? Math.max(0, (cntSnap.data().next || 1) - 1) : 0;
  console.log(`Productos publicados: ${products.length} · leídos de Firestore: ${readCount} · ajustes públicos: ${Object.keys(settings).length} claves · pedidos: ${orderCount}`);
  if (budget.dropped) console.log(`AVISO: ${budget.dropped} foto(s) base64 sin convertir quedaron fuera del JSON por tamaño (correr "Fotos de productos a archivos webp").`);
  console.log('Claves de ajustes publicadas:', Object.keys(settings).sort().join(', '));

  const body = { version: 1, products, settings, orderCount };
  const same = prev && stable({ version: prev.version, products: prev.products, settings: prev.settings, orderCount: prev.orderCount }) === stable(body);
  const kb = Math.round(Buffer.byteLength(stable(body)) / 1024);
  console.log(`Tamaño del JSON: ${kb} KB · ${same ? 'idéntico al publicado' : 'hay cambios'}`);
  if (DRY_RUN) { console.log('DRY_RUN: no se escribe nada.'); return; }

  if (!same) {
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: startedAt, ...body }));
    git('git config user.name "cdlp-catalogo[bot]"');
    git('git config user.email "actions@users.noreply.github.com"');
    git('git add catalogo.json');
    git(`git commit -m "Catálogo estático: ${products.length} productos (${why})"`);
    let pushed = false;
    for (let i = 0; i < 4 && !pushed; i++) {
      try { git('git pull --rebase -X theirs origin HEAD'); git('git push origin HEAD'); pushed = true; }
      catch (e) { console.log('push falló, reintento', i + 1, String(e.message).slice(0, 200)); await new Promise(r => setTimeout(r, 4000 * (i + 1))); }
    }
    if (!pushed) throw new Error('No se pudo subir catalogo.json');
    await requestPagesBuild();
  }
  await pubRef.set(Object.assign({ publishedAt: startedAt, urgent: false, productCount: products.length, sizeKb: kb, syncMax }, incremental ? {} : { fullAt: startedAt }), { merge: true });
  console.log('Listo.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
