/* Alta de productos VISIBLES con existencias iniciales, leídos de alta.json.
   Cada producto se crea con su foto ya en img/p/, su costo y proveedor (en productCosts, la capa privada), su proveedor (por nombre; si no existe
   en Proveedores se crea) y sus existencias en el centro Principal (el marcado como predeterminado).
   No crea nada si ya existe: mismo id, mismo SKU o un producto vivo con el mismo nombre.
   Deja anotado el alta en la bitácora y la entrada de inventario en los movimientos.
   Variables: FIREBASE_SERVICE_ACCOUNT, DRY_RUN (1 = solo reporte, por defecto). */
const fs = require('fs');
const path = require('path');
const env = process.env;
const DRY_RUN = env.DRY_RUN !== '0';
const { productos } = JSON.parse(fs.readFileSync(path.join(__dirname, 'alta.json'), 'utf8'));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const money = n => '$' + Number(n || 0).toLocaleString('es-MX');
const BY = 'Alta de producto (Acción de GitHub)';
// Igual que tools/costos/migrar.js: costo, historial y proveedor viven en productCosts (privado);
// en products solo queda el nivel de margen (mgTier) para los filtros.
function marginTier(price, cost){ price = Number(price); cost = Number(cost); if(!(price > 0) || !(cost > 0)) return null; const m = (price - cost) / price; return m >= 0.6 ? 3 : m >= 0.45 ? 2 : m >= 0.3 ? 1 : 0; }

async function run({ db, FieldValue }){
  const [snap, supSnap, cenSnap] = await Promise.all([
    db.collection('products').get(), db.collection('suppliers').get(), db.collection('distributionCenters').get()]);
  const live = snap.docs.filter(d => !d.data().deletedAt);
  const centers = cenSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const principal = centers.find(c => c.isDefault) || centers[0];
  if(!principal){ throw new Error('No hay centros de distribución: abre el panel una vez para que se cree "Principal".'); }
  console.log(`Productos: ${live.length} · centro para existencias: ${principal.name} · ${DRY_RUN ? 'DRY_RUN (no cambia nada)' : 'APLICANDO'}`);

  const todo = [], brincados = [], nuevosProv = {};
  for(const p of productos){
    if(snap.docs.some(d => d.id === p.id)){ brincados.push(`${p.name}: ya existe (mismo id)`); continue; }
    const sku = live.find(d => String(d.data().sku || '').toUpperCase() === p.sku.toUpperCase());
    if(sku){ brincados.push(`${p.name}: el SKU ${p.sku} ya lo usa "${sku.data().name}"`); continue; }
    const igual = live.find(d => norm(d.data().name) === norm(p.name));
    if(igual){ brincados.push(`${p.name}: ya hay un producto con ese nombre`); continue; }
    let sup = supSnap.docs.find(d => norm(d.data().name) === norm(p.proveedor));
    const supTxt = sup ? `proveedor ${sup.data().name}` : `proveedor ${p.proveedor} (no existe: se creará)`;
    if(!sup && p.proveedor) nuevosProv[norm(p.proveedor)] = p.proveedor;
    todo.push({ p, sup });
    console.log(`  + ${p.sku}  ${p.name} · ${money(p.price)} · costo ${money(p.cost)} · ${supTxt} · ${p.existencias} pza(s) · ${p.images.length} foto(s)`);
  }
  brincados.forEach(x => console.log(`  = ${x}: no se creó`));
  console.log(`::notice::${DRY_RUN ? 'Prueba' : 'Aplicando'}: ${todo.length} alta(s) · ${brincados.length} brincada(s)`);
  if(DRY_RUN){ console.log('DRY_RUN: no se tocó Firestore.'); return { created: 0, brincados }; }

  const provIds = {};
  for(const [k, nombre] of Object.entries(nuevosProv)){
    const ref = await db.collection('suppliers').add({ name: nombre, _sync: FieldValue.serverTimestamp() });
    provIds[k] = ref.id; console.log(`  Proveedor creado: ${nombre}`);
  }
  const now = new Date().toISOString();
  const batch = db.batch();
  for(const { p, sup } of todo){
    const supId = sup ? sup.id : (provIds[norm(p.proveedor)] || '');
    const supName = sup ? (sup.data().name || '') : (p.proveedor || '');
    const qty = Number(p.existencias) || 0;
    batch.create(db.collection('products').doc(p.id), {
      name: p.name, sku: p.sku, location: p.location || '', expirationDate: '', lowStockThreshold: 0,
      cat: p.cat, categories: p.categories, price: p.price, promoPrice: 0, stock: qty,
      desc: p.desc, images: p.images, needs: p.needs || [], stockByCenter: qty ? { [principal.id]: qty } : {}, hidden: !!p.oculto,
      variantGroups: [], variants: [], batches: [], isKit: false, kitItems: [],
      isMysteryBox: false, mysteryCategory: '', mysteryItemCount: 0, categorySortOrder: {}, createdAt: now,
      promoSince: null, ...(marginTier(p.price, p.cost) !== null ? { mgTier: marginTier(p.price, p.cost) } : {}),
      _sync: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('productCosts').doc(p.id), {
      cost: p.cost, supplierId: supId,
      costHistory: [{ cost: p.cost, date: now, supplierId: supId, supplierName: supName, source: 'alta', by: BY }],
      _sync: FieldValue.serverTimestamp(),
    });
    if(qty) batch.set(db.collection('stockMovements').doc(), {
      productId: p.id, type: 'ajuste_manual', qtyChange: qty, note: 'Existencias iniciales al dar de alta', centerId: principal.id,
      date: now, userEmail: BY, _sync: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('adminAuditLog').doc(), {
      action: 'alta_producto', targetType: 'producto', targetName: p.name, targetId: p.id,
      details: `Alta · ${money(p.price)} · costo ${money(p.cost)} · ${qty} pza(s) · proveedor ${supName} · SKU ${p.sku}`,
      userEmail: BY, date: now,
    });
  }
  if(todo.length) await batch.commit();
  console.log(`::notice::Creados: ${todo.length} · brincados: ${brincados.length}`);
  return { created: todo.length, brincados };
}
module.exports = { run };

if(require.main === module){
  (async () => {
    if(!env.FIREBASE_SERVICE_ACCOUNT){ console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT.'); process.exit(1); }
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
    await run({ db: admin.firestore(), FieldValue: admin.firestore.FieldValue });
  })().catch(e => { console.error(e); process.exit(1); });
}
