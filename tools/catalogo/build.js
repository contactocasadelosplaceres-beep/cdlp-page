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
const DRY_RUN = env.DRY_RUN === '1';
const SITE_URL = env.SITE_URL || 'https://contactocasadelosplaceres-beep.github.io/cdlp-page/';

// Campos de producto que NO salen en el JSON público.
const PRIV_PRODUCT = ['cost', 'costHistory', 'supplierId', 'stockByCenter', 'batches', 'expirationDate',
  'lowStockThreshold', 'location', 'createdBy', 'updatedBy', 'deletedBy', 'deletedAt', 'internalNotes', 'internalNote'];
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
  const [prodSnap, setSnap, cntSnap] = await Promise.all([
    db.collection('products').get(),
    db.collection('settings').doc('store').get(),
    db.collection('counters').doc('orders').get(),
  ]);
  const budget = { used: 0, dropped: 0 };
  const products = prodSnap.docs
    .map(d => ({ id: d.id, data: d.data() }))
    .filter(x => !x.data.hidden && !x.data.deletedAt)
    .map(x => cleanProduct(x.id, x.data, budget))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  const settings = cleanSettings(setSnap.exists ? setSnap.data() : {});
  const orderCount = cntSnap.exists ? Math.max(0, (cntSnap.data().next || 1) - 1) : 0;
  console.log(`Productos publicados: ${products.length} de ${prodSnap.size} · ajustes públicos: ${Object.keys(settings).length} claves · pedidos: ${orderCount}`);
  if (budget.dropped) console.log(`AVISO: ${budget.dropped} foto(s) base64 sin convertir quedaron fuera del JSON por tamaño (correr "Fotos de productos a archivos webp").`);
  console.log('Claves de ajustes publicadas:', Object.keys(settings).sort().join(', '));

  const body = { version: 1, products, settings, orderCount };
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
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
  await pubRef.set({ publishedAt: startedAt, urgent: false, productCount: products.length, sizeKb: kb }, { merge: true });
  console.log('Listo.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
