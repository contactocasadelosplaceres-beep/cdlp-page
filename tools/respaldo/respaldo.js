/* Respaldo de Firestore SIN plan Blaze (el exportador oficial de Google pide Blaze).
   Una GitHub Action lo corre cada semana: lee todas las colecciones con la cuenta de servicio,
   las junta en un archivo, lo comprime y lo CIFRA con tu contraseña (AES-256-GCM). El archivo
   cifrado se guarda como "artefacto" de la corrida durante 90 días (≈ 13 respaldos semanales).
   Como el repositorio es público, el respaldo nunca se sube sin cifrar: sin la contraseña no
   sirve de nada. Para abrirlo: node tools/respaldo/descifrar.js respaldo-AAAA-MM-DD.cdlp

   Costo: 1 lectura por documento (lo dice la corrida al final). Las colecciones de estadística
   que crecen mucho y no hacen falta para recuperar la tienda se saltan (variable SALTAR).

   Secretos (GitHub → Settings → Secrets and variables → Actions):
     FIREBASE_SERVICE_ACCOUNT  (ya existe)
     RESPALDO_CLAVE            (nuevo: una contraseña larga que guardes fuera de aquí) */
const admin = require('firebase-admin');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const env = process.env;
const CLAVE = env.RESPALDO_CLAVE || '';
const SALTAR = new Set(String(env.SALTAR || '').split(',').map(s => s.trim()).filter(Boolean));
const OUT_DIR = env.OUT_DIR || path.join(process.cwd(), 'respaldo-out');

function toPlain(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof admin.firestore.Timestamp) return { __ts: v.toDate().toISOString() };
  if (v instanceof admin.firestore.GeoPoint) return { __geo: [v.latitude, v.longitude] };
  if (v instanceof admin.firestore.DocumentReference) return { __ref: v.path };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __bytes: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = toPlain(v[k]); return o; }
  return v;
}

async function dumpCollection(col, out, stats) {
  const snap = await col.get();
  stats.reads += snap.size;
  const docs = {};
  for (const d of snap.docs) {
    const entry = { data: toPlain(d.data()) };
    const subs = await d.ref.listCollections();             // listar subcolecciones no cuesta lecturas
    if (subs.length) { entry.sub = {}; for (const s of subs) { entry.sub[s.id] = {}; await dumpCollection(s, entry.sub[s.id], stats); } }
    docs[d.id] = entry;
  }
  Object.assign(out, docs);
  return snap.size;
}

function encrypt(buf, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  // formato: "CDLP1" + sal(16) + iv(12) + etiqueta(16) + datos
  return Buffer.concat([Buffer.from('CDLP1'), salt, iv, c.getAuthTag(), enc]);
}

(async () => {
  if (CLAVE.length < 12) {
    console.log('::error::Falta el secreto RESPALDO_CLAVE (mínimo 12 caracteres). Créalo en GitHub → Settings → Secrets and variables → Actions.');
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore();
  const started = new Date();
  const stats = { reads: 0 };
  const data = {}, counts = [];
  for (const col of await db.listCollections()) {
    if (SALTAR.has(col.id)) { counts.push(`${col.id}=saltada`); continue; }
    data[col.id] = {};
    const n = await dumpCollection(col, data[col.id], stats);
    counts.push(`${col.id}=${n}`);
  }
  const payload = Buffer.from(JSON.stringify({ version: 1, project: env.GCLOUD_PROJECT || 'casa-de-los-placeres', createdAt: started.toISOString(), collections: data }));
  const gz = zlib.gzipSync(payload, { level: 9 });
  const file = path.join(OUT_DIR, `respaldo-${started.toISOString().slice(0, 10)}.cdlp`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(file, encrypt(gz, CLAVE));
  const mb = n => (n / 1048576).toFixed(2) + ' MB';
  console.log(counts.join('\n'));
  for (let i = 0; i < counts.length; i += 8) console.log('::notice::' + counts.slice(i, i + 8).join(' · '));
  console.log(`::notice::Respaldo listo: ${path.basename(file)} · ${stats.reads} lecturas · ${mb(payload.length)} sin comprimir → ${mb(fs.statSync(file).size)} cifrado`);
})().catch(e => { console.log('::error::' + (e.message || e)); process.exit(1); });
