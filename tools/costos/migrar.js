/* Costos privados (auditoría QA-03): mueve cost, costHistory, supplierId y el costo de cada variante
   de "products" (lectura pública) a "productCosts" (solo personal), y deja en products un nivel de
   margen aproximado (mgTier 0–3) que usa el buscador de la tienda para ordenar.

   Requisito: las reglas nuevas ya publicadas (con "productCosts") y el panel/POS ya actualizados.
   Variables: FIREBASE_SERVICE_ACCOUNT, DRY_RUN (1 = solo reporte, por defecto), LIMIT (0 = todos),
   BACKUP_DIR (respaldo JSON de lo que se mueve). Cada producto se mueve en una transacción: si alguien
   lo edita al mismo tiempo, Firestore reintenta con los datos nuevos. */
const fs = require('fs');
const path = require('path');
const env = process.env;
const DRY_RUN = env.DRY_RUN !== '0';
const LIMIT = (() => { const n = parseInt(String(env.LIMIT || '').trim(), 10); return Number.isFinite(n) && n > 0 ? n : 0; })();
const BACKUP_DIR = env.BACKUP_DIR || path.join(__dirname, '..', '..', '..', 'respaldo-costos');
const PRIV_KEYS = ['cost', 'costHistory', 'supplierId'];

function marginTier(price, cost){ price = Number(price); cost = Number(cost); if(!(price > 0) || !(cost > 0)) return null; const m = (price - cost) / price; return m >= 0.6 ? 3 : m >= 0.45 ? 2 : m >= 0.3 ? 1 : 0; }

function plan(data){
  const priv = {}; let has = false;
  for(const k of PRIV_KEYS) if(Object.prototype.hasOwnProperty.call(data, k)){ priv[k] = data[k]; has = true; }
  let variants = null; const vc = {};
  if(Array.isArray(data.variants) && data.variants.some(v => v && typeof v === 'object' && 'cost' in v)){
    variants = data.variants.map(v => { if(v && typeof v === 'object' && 'cost' in v){ const { cost, ...rest } = v; if(v.id != null) vc[v.id] = cost; return rest; } return v; });
    if(Object.keys(vc).length) priv.variantCosts = vc;
    has = true;
  }
  if(!has) return null;
  const tier = marginTier(data.price, priv.cost);
  return { priv, variants, tier };
}

async function run({ db, FieldValue }){
  const snap = await db.collection('products').get();
  let todo = snap.docs.filter(d => plan(d.data()));
  console.log(`Productos: ${snap.size} · con datos privados en "products": ${todo.length}${LIMIT ? ` · en esta corrida: ${Math.min(LIMIT, todo.length)}` : ''} · ${DRY_RUN ? 'DRY_RUN (no cambia nada)' : 'APLICANDO'}`);
  if(LIMIT) todo = todo.slice(0, LIMIT);
  let withCost = 0, withHist = 0, withSup = 0, withVar = 0;
  todo.forEach(d => { const p = plan(d.data()); if('cost' in p.priv) withCost++; if('costHistory' in p.priv) withHist++; if('supplierId' in p.priv) withSup++; if(p.priv.variantCosts) withVar++; });
  console.log(`  con costo: ${withCost} · con historial: ${withHist} · con proveedor: ${withSup} · con costo por variante: ${withVar}`);
  todo.slice(0, 15).forEach(d => { const x = d.data(); const p = plan(x); console.log(`  ${d.id}  ${String(x.name || '').slice(0, 45).padEnd(45)}  costo ${p.priv.cost ?? '—'}  margen nivel ${p.tier ?? '—'}${p.priv.variantCosts ? `  variantes ${Object.keys(p.priv.variantCosts).length}` : ''}`); });
  if(todo.length > 15) console.log(`  … y ${todo.length - 15} más`);
  if(DRY_RUN){ console.log('DRY_RUN: no se tocó Firestore.'); return { moved: 0 }; }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  let moved = 0;
  for(const d of todo){
    const ref = d.ref, privRef = db.collection('productCosts').doc(d.id);
    await db.runTransaction(async tx => {
      const cur = await tx.get(ref); if(!cur.exists) return;
      const p = plan(cur.data()); if(!p) return;
      fs.writeFileSync(path.join(BACKUP_DIR, `${d.id}.json`), JSON.stringify({ id: d.id, name: cur.data().name || '', ...p.priv }));
      tx.set(privRef, Object.assign({}, p.priv, { _sync: FieldValue.serverTimestamp() }), { merge: true });
      const upd = {}; for(const k of PRIV_KEYS) if(k in p.priv) upd[k] = FieldValue.delete();
      if(p.variants) upd.variants = p.variants;
      if(p.tier !== null) upd.mgTier = p.tier;
      upd._sync = FieldValue.serverTimestamp(); // el panel y el catálogo ven el cambio sin releer todo
      tx.update(ref, upd);
    });
    moved++;
  }
  // comprobación
  const after = await db.collection('products').get();
  const left = after.docs.filter(d => plan(d.data())).length;
  console.log(`Productos movidos: ${moved} · quedan con datos privados en "products": ${left}`);
  return { moved, left };
}
module.exports = { run, plan, marginTier };

if(require.main === module){
  (async () => {
    if(!env.FIREBASE_SERVICE_ACCOUNT){ console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT.'); process.exit(1); }
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
    await run({ db: admin.firestore(), FieldValue: admin.firestore.FieldValue });
  })().catch(e => { console.error(e); process.exit(1); });
}
