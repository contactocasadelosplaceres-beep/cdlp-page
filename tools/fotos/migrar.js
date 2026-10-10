/* Fotos de productos: de texto base64 en Firestore a archivos .webp en este mismo repositorio.

   Por qué: cada visita a la tienda descargaba ~26 MB de fotos metidas dentro de los documentos de
   Firestore (auditoría QA-04). Como archivos servidos por GitHub Pages pesan ~10 veces menos, se
   guardan en caché del celular y no gastan la cuota gratuita de Firestore.

   Qué hace, producto por producto:
   1. Toma cada foto que todavía sea "data:image/...;base64,..." (las que ya son archivo se dejan).
   2. La convierte a .webp: grande (máx. 1000 px, calidad 80) en img/p/ y miniatura (500 px) en
      img/p/t/ con el MISMO nombre — así la tienda saca la miniatura de la ruta, sin campos extra.
      El nombre lleva una huella del contenido: si la foto cambia, cambia el nombre (nada de caché vieja).
   3. Guarda un respaldo JSON con las fotos originales (se sube como artefacto del Action).
   4. Con DRY_RUN=0: hace commit y push de los archivos, espera a que GitHub Pages los publique y
      solo entonces cambia `images` del producto — y únicamente si nadie lo editó mientras tanto.

   Variables: FIREBASE_SERVICE_ACCOUNT (JSON de la cuenta de servicio, secreto del repo),
   DRY_RUN (1 = solo reporta, valor por defecto), LIMIT (máx. de productos en esta corrida),
   ONLY_IDS (ids separados por coma), AUTO (1 = corrida programada: solo actúa si hay ≤20 pendientes), CLEAN_ORPHANS (1 = borra archivos que ya ningún producto usa;
   solo en corrida completa), SITE_URL (para comprobar que Pages ya publicó). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const IMG_DIR = 'img/p';
const THUMB_DIR = 'img/p/t';
const env = process.env;
let DRY_RUN = env.DRY_RUN !== '0';
const AUTO = env.AUTO === '1';
const AUTO_MAX = 20;
// 0, vacío o "todos" = sin límite
const LIMIT = (() => { const n = parseInt(String(env.LIMIT || '').trim(), 10); return Number.isFinite(n) && n > 0 ? n : 0; })();
const ONLY_IDS = (env.ONLY_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const CLEAN_ORPHANS = env.CLEAN_ORPHANS === '1';
const SITE_URL = (env.SITE_URL || 'https://contactocasadelosplaceres-beep.github.io/cdlp-page/').replace(/\/?$/, '/');
const BACKUP_DIR = env.BACKUP_DIR || path.join(ROOT, '..', 'respaldo-fotos');

const isData = s => typeof s === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(s);
const kb = n => Math.round(n / 1024);

async function convert(sharp, dataUri) {
  const buf = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
  const big = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const thumb = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 500, height: 700, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
  return { original: buf.length, big, thumb };
}

async function planProduct(sharp, id, images) {
  const out = []; const files = []; let before = 0, after = 0, converted = 0;
  for (let i = 0; i < images.length; i++) {
    const src = images[i];
    if (!isData(src)) { out.push(src); continue; }
    const { original, big, thumb } = await convert(sharp, src);
    const hash = crypto.createHash('sha1').update(big).digest('hex').slice(0, 10);
    const name = `${id}-${i}-${hash}.webp`;
    files.push({ rel: `${IMG_DIR}/${name}`, data: big }, { rel: `${THUMB_DIR}/${name}`, data: thumb });
    out.push(`${IMG_DIR}/${name}`);
    before += src.length; after += big.length; converted++;
    void original;
  }
  return { out, files, before, after, converted };
}

function sameArray(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]); }

// Las publicaciones hechas por un Action no siempre disparan GitHub Pages por sí solas: se le pide
// una publicación explícita (si Pages se publica con su propio workflow, esto simplemente no aplica).
async function requestPagesBuild() {
  const repo = env.GITHUB_REPOSITORY, token = env.GITHUB_TOKEN;
  if (!repo || !token || typeof fetch !== 'function') return;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/pages/builds`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    console.log(`Solicitud de publicación a GitHub Pages: ${r.status}`);
  } catch (e) { console.log('No se pudo pedir la publicación a Pages:', e.message); }
}

async function waitForPages(rels) {
  if (!rels.length || typeof fetch !== 'function') return;
  await requestPagesBuild();
  const probe = rels[rels.length - 1];
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(SITE_URL + probe, { method: 'HEAD', cache: 'no-store' }); if (r.ok) { console.log(`GitHub Pages ya sirve ${probe}`); return; } } catch (e) {}
    await new Promise(r => setTimeout(r, 15000));
  }
  throw new Error('GitHub Pages no publicó los archivos en 10 minutos; no se cambió ningún producto.');
}

function git(cmd) { return execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString().trim(); }

async function run({ db, sharp, commit = true }) {
  const snap = await db.collection('products').get();
  let docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
  if (ONLY_IDS.length) docs = docs.filter(d => ONLY_IDS.includes(d.id));
  const pending = docs.filter(d => (d.data.images || []).some(isData));
  if(AUTO && pending.length > AUTO_MAX){
    console.log(`Corrida automática: hay ${pending.length} productos con fotos base64 (más de ${AUTO_MAX}). La migración inicial se lanza a mano desde Actions; esta corrida solo reporta.`);
    DRY_RUN = true;
  }
  const batch = LIMIT ? pending.slice(0, LIMIT) : pending;
  console.log(`Productos: ${docs.length} · con fotos base64: ${pending.length} · en esta corrida: ${batch.length} · ${DRY_RUN ? 'DRY_RUN (no cambia nada)' : 'APLICANDO'}`);

  const plans = []; let totBefore = 0, totAfter = 0, totImgs = 0;
  for (const d of batch) {
    const images = d.data.images || [];
    try {
      const plan = await planProduct(sharp, d.id, images);
      plans.push({ id: d.id, name: d.data.name || '', original: images, ...plan });
      totBefore += plan.before; totAfter += plan.after; totImgs += plan.converted;
      console.log(`  ${d.id}  ${String(d.data.name || '').slice(0, 50).padEnd(50)}  ${plan.converted} foto(s)  ${kb(plan.before)} KB → ${kb(plan.after)} KB`);
    } catch (e) { console.log(`  ${d.id}  ERROR al convertir: ${e.message} (se omite)`); }
  }
  console.log(`Total: ${totImgs} fotos · ${kb(totBefore)} KB → ${kb(totAfter)} KB (miniaturas aparte)`);

  if (DRY_RUN) { console.log('DRY_RUN: no se escribió ningún archivo ni se tocó Firestore.'); return { plans, applied: 0 }; }
  if (!plans.length) { console.log('Nada que migrar.'); }

  // 1) respaldo de lo original
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  for (const p of plans) fs.writeFileSync(path.join(BACKUP_DIR, `${p.id}.json`), JSON.stringify({ id: p.id, name: p.name, images: p.original }));
  // 2) archivos
  const rels = [];
  for (const p of plans) for (const f of p.files) { const abs = path.join(ROOT, f.rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, f.data); rels.push(f.rel); }
  // 3) commit + push y esperar a Pages
  if (commit && rels.length) {
    git('git config user.name "cdlp-fotos[bot]"'); git('git config user.email "cdlp-fotos@users.noreply.github.com"');
    git(`git add ${IMG_DIR}`);
    git(`git commit -m "Fotos: ${totImgs} foto(s) de ${plans.length} producto(s) convertidas a webp"`);
    git('git pull --rebase origin main'); git('git push origin HEAD:main');
    await waitForPages(rels);
  }
  // 4) actualizar productos (solo si nadie los cambió mientras tanto)
  let applied = 0, skipped = 0;
  for (const p of plans) {
    const ref = db.collection('products').doc(p.id);
    const ok = await db.runTransaction(async tx => {
      const cur = await tx.get(ref);
      if (!cur.exists || !sameArray(cur.data().images || [], p.original)) return false;
      tx.update(ref, { images: p.out, imagesMigratedAt: new Date().toISOString() });
      return true;
    });
    if (ok) applied++; else { skipped++; console.log(`  ${p.id} cambió mientras tanto; se reintenta en la siguiente corrida.`); }
  }
  console.log(`Productos actualizados: ${applied} · omitidos por cambios: ${skipped}`);

  // 5) limpieza opcional de archivos que ya nadie usa
  if (CLEAN_ORPHANS && !LIMIT && !ONLY_IDS.length) {
    const used = new Set();
    (await db.collection('products').get()).docs.forEach(d => (d.data().images || []).forEach(s => { if (typeof s === 'string' && s.startsWith(IMG_DIR + '/')) used.add(path.basename(s)); }));
    const dir = path.join(ROOT, IMG_DIR); let removed = 0;
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.webp') || used.has(f)) continue;
      fs.rmSync(path.join(dir, f)); fs.rmSync(path.join(dir, 't', f), { force: true }); removed++;
    }
    if (removed && commit) { git(`git add -A ${IMG_DIR}`); git(`git commit -m "Fotos: se quitan ${removed} archivo(s) que ya ningún producto usa"`); git('git pull --rebase origin main'); git('git push origin HEAD:main'); }
    console.log(`Archivos sin uso eliminados: ${removed}`);
  }
  return { plans, applied };
}

module.exports = { run, isData, planProduct };

if (require.main === module) {
  (async () => {
    if (!env.FIREBASE_SERVICE_ACCOUNT) { console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT (Settings → Secrets and variables → Actions).'); process.exit(1); }
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
    await run({ db: admin.firestore(), sharp: require('sharp') });
  })().catch(e => { console.error(e); process.exit(1); });
}
