/* Altas de productos nuevos, leídos de altas.json. Cada producto se crea OCULTO (hidden: true),
   sin existencias, con su costo y su foto ya en img/p/. Así se puede revisar en el panel y
   publicarlo a mano cuando llegue la mercancía (Productos → editar → quitar "Oculto").
   No crea nada si ya existe: mismo id, mismo SKU, o un producto vivo cuyo nombre contenga la
   todas las palabras de "buscar" (los sobres de 2 ml no cuentan). Lo que se brinque sale en el reporte.
   Variables: FIREBASE_SERVICE_ACCOUNT, DRY_RUN (1 = solo reporte, por defecto). */
const fs = require('fs');
const path = require('path');
const env = process.env;
const DRY_RUN = env.DRY_RUN !== '0';
const { productos } = JSON.parse(fs.readFileSync(path.join(__dirname, 'altas.json'), 'utf8'));

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const esSobre = n => /\b2 ?ml\b|\bsobre\b/.test(norm(n));
const money = n => '$' + Number(n || 0).toLocaleString('es-MX');

// Palabra o frase completa (no pedazo de otra palabra: "hot" no coincide con "hotsex").
const tiene = (n, frase) => new RegExp(`(^| )${norm(frase)}( |$)`).test(n);
function parecidos(p, live){
  const terminos = (Array.isArray(p.buscar) ? p.buscar : [p.buscar]).map(t => String(t).split('|'));
  const exc = norm(p.excluir || '');
  return live.filter(d => {
    const n = norm(d.data().name);
    return terminos.every(alts => alts.some(a => tiene(n, a))) && !esSobre(n) && !(exc && tiene(n, exc));
  });
}

async function run({ db, FieldValue }){
  const [snap, supSnap] = await Promise.all([db.collection('products').get(), db.collection('suppliers').get()]);
  const live = snap.docs.filter(d => !d.data().deletedAt);
  const sup = supSnap.docs.find(d => /orgie/i.test(String(d.data().name || '')));
  console.log(`Productos en la tienda: ${live.length} · altas en la lista: ${productos.length} · proveedor Orgie: ${sup ? sup.data().name : '(no existe, se deja vacío)'} · ${DRY_RUN ? 'DRY_RUN (no cambia nada)' : 'APLICANDO'}`);
  const todo = [], brincados = [];
  for(const p of productos){
    if(snap.docs.some(d => d.id === p.id)){ brincados.push(`${p.name}: ya existe un producto con su id (¿ya se dio de alta?)`); continue; }
    const mismoSku = live.filter(d => String(d.data().sku || '').toUpperCase() === p.sku.toUpperCase());
    if(mismoSku.length){ brincados.push(`${p.name}: el SKU ${p.sku} ya lo usa "${mismoSku[0].data().name}"`); continue; }
    const par = parecidos(p, live);
    if(par.length){ brincados.push(`${p.name}: ya hay ${par.map(d => `"${d.data().name}"${d.data().hidden ? ' (oculto)' : ''}`).join(', ')}`); continue; }
    todo.push(p);
    console.log(`  + ${p.sku}  ${p.name} · ${money(p.price)} · costo ${money(p.cost)}`);
  }
  brincados.forEach(x => console.log(`  = ${x} — no se creó`));
  console.log(`::notice::${DRY_RUN ? 'Prueba' : 'Aplicando'}: ${todo.length} alta(s) · ${brincados.length} brincada(s)`);
  if(DRY_RUN){ console.log('DRY_RUN: no se tocó Firestore.'); return { created: 0, brincados }; }

  const now = new Date().toISOString();
  const batch = db.batch();
  for(const p of todo){
    const ref = db.collection('products').doc(p.id);
    batch.create(ref, {
      name: p.name, sku: p.sku, location: '', supplierId: sup ? sup.id : '', expirationDate: '', lowStockThreshold: 0,
      cat: p.cat, categories: p.categories, price: p.price, promoPrice: 0, cost: p.cost, stock: 0,
      desc: p.desc, images: p.images, needs: p.needs, stockByCenter: {}, hidden: true,
      variantGroups: [], variants: [], batches: [], isKit: false, kitItems: [],
      isMysteryBox: false, mysteryCategory: '', mysteryItemCount: 0, categorySortOrder: {}, createdAt: now,
      costHistory: [{ cost: p.cost, date: now, supplierId: sup ? sup.id : '', supplierName: sup ? (sup.data().name || '') : 'Orgie', source: 'alta', by: 'Alta masiva (Acción de GitHub)' }],
      promoSince: null, internalNotes: `Orgie código ${p.codigoProveedor} · mayoreo ${money(p.precioMayoreo)} (costo con 10% de descuento)`,
      _sync: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('adminAuditLog').doc(), {
      action: 'alta_producto', targetType: 'producto', targetName: p.name, targetId: p.id,
      details: `Alta oculta · ${money(p.price)} · costo ${money(p.cost)} · SKU ${p.sku}`,
      userEmail: 'Alta masiva (Acción de GitHub)', date: now,
    });
  }
  if(todo.length) await batch.commit();
  console.log(`::notice::Creados (ocultos): ${todo.length} · brincados: ${brincados.length}`);
  return { created: todo.length, brincados };
}
module.exports = { run, parecidos, norm };

if(require.main === module){
  (async () => {
    if(!env.FIREBASE_SERVICE_ACCOUNT){ console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT.'); process.exit(1); }
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
    await run({ db: admin.firestore(), FieldValue: admin.firestore.FieldValue });
  })().catch(e => { console.error(e); process.exit(1); });
}
