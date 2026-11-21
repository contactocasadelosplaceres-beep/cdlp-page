/* Repara costos que se quedaron en "products" (bug: la carga "solo cambios" del panel no encendía la
   capa de costos privados, así que algunos guardados escribían el costo en products y al volver a
   abrir el panel se veía el costo viejo de productCosts).

   A diferencia de migrar.js, NO copia a ciegas: compara products contra productCosts por producto.
   - costo: si products trae un costo > 0, ese es el último que se guardó desde el panel y gana;
            si trae 0 o nada (el producto se guardó sin costo cargado), se respeta el de productCosts.
   - historial: se juntan los dos (sin repetir) y se ordena por fecha.
   - proveedor: el de products si no está vacío; si no, el de productCosts.
   - costo por variante: el de products si es > 0; si no, el de productCosts.
   Después borra esos campos de products. Variables: FIREBASE_SERVICE_ACCOUNT, DRY_RUN (1 por defecto),
   BACKUP_DIR (respaldo JSON de ambos lados antes de tocar nada). */
const fs = require('fs');
const path = require('path');
const { plan, marginTier } = require('./migrar.js');
const env = process.env;
const DRY_RUN = env.DRY_RUN !== '0';
const BACKUP_DIR = env.BACKUP_DIR || path.join(__dirname, '..', '..', '..', 'respaldo-costos');

const num = v => Number(v) || 0;
function mergeHist(a, b){
  const seen = new Set(), out = [];
  [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].forEach(h => {
    if(!h || typeof h !== 'object') return;
    const k = `${h.date || ''}|${num(h.cost)}|${h.source || ''}`;
    if(seen.has(k)) return; seen.add(k); out.push(h);
  });
  return out.sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
}
function decide(pubData, privData){
  const p = plan(pubData); if(!p) return null;
  const pv = p.priv, cv = privData || {};
  const final = {};
  const pc = num(pv.cost), cc = num(cv.cost);
  final.cost = pc > 0 ? pc : cc;
  final.costHistory = mergeHist(cv.costHistory, pv.costHistory);
  final.supplierId = (pv.supplierId || '') || (cv.supplierId || '');
  if(pv.variantCosts){
    const vc = { ...(cv.variantCosts || {}) };
    Object.entries(pv.variantCosts).forEach(([id, c]) => { if(num(c) > 0) vc[id] = num(c); });
    final.variantCosts = vc;
  }
  const change = pc > 0 && pc !== cc ? 'gana products' : (pc > 0 ? 'igual' : (cc > 0 ? 'se respeta productCosts' : 'sin costo en ninguno'));
  return { final, variants: p.variants, pc, cc, change, tier: marginTier(pubData.price, final.cost) };
}

async function run({ db, FieldValue }){
  const snap = await db.collection('products').get();
  const todo = snap.docs.filter(d => plan(d.data()));
  console.log(`Productos: ${snap.size} · con costos atorados en "products": ${todo.length} · ${DRY_RUN ? 'DRY_RUN (no cambia nada)' : 'APLICANDO'}`);
  const rows = [];
  for(const d of todo){
    const pc = await db.collection('productCosts').doc(d.id).get();
    const r = decide(d.data(), pc.exists ? pc.data() : null);
    rows.push({ id: d.id, name: String(d.data().name || ''), ...r });
  }
  const count = k => rows.filter(r => r.change === k).length;
  console.log(`  gana el costo de products (más nuevo): ${count('gana products')} · iguales: ${count('igual')} · se respeta productCosts: ${count('se respeta productCosts')} · sin costo en ninguno: ${count('sin costo en ninguno')}`);
  console.log(`::notice::${DRY_RUN ? 'Prueba' : 'Aplicando'}: ${rows.length} producto(s) · cambia el costo en ${count('gana products')} · ya iguales ${count('igual')} · se conserva productCosts ${count('se respeta productCosts')} · sin costo ${count('sin costo en ninguno')}`);
  rows.forEach(r => console.log(`  ${r.id}  ${r.name.slice(0, 50).padEnd(50)}  products ${String(r.pc || '—').padStart(7)}  productCosts ${String(r.cc || '—').padStart(7)}  → queda ${String(r.final.cost || '—').padStart(7)}  (${r.change})`));
  if(DRY_RUN){ console.log('DRY_RUN: no se tocó Firestore.'); return { fixed: 0 }; }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  let fixed = 0;
  for(const r of rows){
    const ref = db.collection('products').doc(r.id), privRef = db.collection('productCosts').doc(r.id);
    await db.runTransaction(async tx => {
      const [cur, curPriv] = await Promise.all([tx.get(ref), tx.get(privRef)]);
      if(!cur.exists) return;
      const x = decide(cur.data(), curPriv.exists ? curPriv.data() : null); if(!x) return;
      fs.writeFileSync(path.join(BACKUP_DIR, `${r.id}.json`), JSON.stringify({ id: r.id, name: cur.data().name || '', products: plan(cur.data()).priv, productCosts: curPriv.exists ? curPriv.data() : null, final: x.final }, null, 1));
      tx.set(privRef, Object.assign({}, x.final, { _sync: FieldValue.serverTimestamp() }), { merge: true });
      const upd = { cost: FieldValue.delete(), costHistory: FieldValue.delete(), supplierId: FieldValue.delete(), _sync: FieldValue.serverTimestamp() };
      if(x.variants) upd.variants = x.variants;
      if(x.tier !== null) upd.mgTier = x.tier;
      tx.update(ref, upd);
    });
    fixed++;
  }
  const after = await db.collection('products').get();
  const left = after.docs.filter(d => plan(d.data())).length;
  console.log(`::notice::Reparados: ${fixed} · quedan con costos en products: ${left}`);
  return { fixed, left };
}
module.exports = { run, decide };

if(require.main === module){
  (async () => {
    if(!env.FIREBASE_SERVICE_ACCOUNT){ console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT.'); process.exit(1); }
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
    await run({ db: admin.firestore(), FieldValue: admin.firestore.FieldValue });
  })().catch(e => { console.error(e); process.exit(1); });
}
