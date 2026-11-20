/* Crea un proveedor (si no existe) y se lo asigna a sus productos.
   Productos de ese proveedor = los que tienen la MARCA como palabra en el nombre (p. ej. "Orgie").
   Además reporta (sin tocarlos) los que parecen de la marca pero no la dicen en el nombre.
   No cambia productos que ya tienen OTRO proveedor asignado: solo los reporta.
   Variables: FIREBASE_SERVICE_ACCOUNT, DRY_RUN (1 = solo reporte, por defecto),
   PROVEEDOR (nombre, p. ej. "Orgie"), MARCA (palabra a buscar en el nombre; por defecto = PROVEEDOR),
   PISTAS (otras palabras de la marca separadas por coma, solo para el reporte). */
const env = process.env;
const DRY_RUN = env.DRY_RUN !== '0';
const PROVEEDOR = String(env.PROVEEDOR || '').trim();
const MARCA = String(env.MARCA || PROVEEDOR).trim();
const PISTAS = String(env.PISTAS || '').split(',').map(s => s.trim()).filter(Boolean);

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tiene = (n, frase) => new RegExp(`(^| )${norm(frase)}( |$)`).test(norm(n));

async function run({ db, FieldValue }){
  if(!PROVEEDOR) throw new Error('Falta PROVEEDOR');
  const [prodSnap, supSnap] = await Promise.all([db.collection('products').get(), db.collection('suppliers').get()]);
  const sups = supSnap.docs.map(d => ({ id: d.id, name: String(d.data().name || '') }));
  let sup = sups.find(s => norm(s.name) === norm(PROVEEDOR));
  console.log(`Proveedor "${PROVEEDOR}": ${sup ? 'ya existe' : 'no existe, se crea'} · ${DRY_RUN ? 'DRY_RUN (no cambia nada)' : 'APLICANDO'}`);
  const live = prodSnap.docs.filter(d => !d.data().deletedAt);
  const deMarca = live.filter(d => tiene(d.data().name, MARCA));
  const todo = [], otros = [];
  deMarca.forEach(d => {
    const x = d.data(), cur = x.supplierId || '';
    if(sup && cur === sup.id){ console.log(`  = ${x.name}: ya lo tenía`); return; }
    if(cur && (!sup || cur !== sup.id)){ const o = sups.find(s => s.id === cur); otros.push(`${x.name}: tiene otro proveedor (${o ? o.name : cur})`); return; }
    todo.push(d); console.log(`  • ${x.name}${x.hidden ? ' (oculto)' : ''}`);
  });
  otros.forEach(x => console.log(`  ✗ ${x} — no se tocó`));
  const dudosos = live.filter(d => !tiene(d.data().name, MARCA) && PISTAS.some(p => tiene(d.data().name, p)));
  dudosos.forEach(d => console.log(`  ? ${d.data().name}: parece de la marca pero no dice "${MARCA}" — no se tocó`));
  console.log(`::notice::${DRY_RUN ? 'Prueba' : 'Aplicando'}: ${todo.length} producto(s) a asignar · ${otros.length} con otro proveedor · ${dudosos.length} dudoso(s)`);
  if(DRY_RUN){ console.log('DRY_RUN: no se tocó Firestore.'); return; }

  if(!sup){
    const ref = db.collection('suppliers').doc();
    await ref.set({ name: PROVEEDOR, _sync: FieldValue.serverTimestamp() });
    sup = { id: ref.id, name: PROVEEDOR };
    console.log(`Proveedor creado: ${PROVEEDOR} (${ref.id})`);
  }
  const now = new Date().toISOString();
  for(let i = 0; i < todo.length; i += 200){
    const batch = db.batch();
    todo.slice(i, i + 200).forEach(d => {
      const x = d.data();
      // Los renglones del historial de costos que no tenían proveedor quedan con este.
      const hist = Array.isArray(x.costHistory) ? x.costHistory.map(h => (h && !h.supplierId) ? Object.assign({}, h, { supplierId: sup.id, supplierName: sup.name }) : h) : x.costHistory;
      const upd = { supplierId: sup.id, _sync: FieldValue.serverTimestamp() };
      if(hist !== undefined) upd.costHistory = hist;
      batch.update(d.ref, upd);
      batch.set(db.collection('adminAuditLog').doc(), {
        action: 'edicion_producto', targetType: 'producto', targetName: x.name || '', targetId: d.id,
        details: `Proveedor: (vacío) → ${sup.name}`, userEmail: 'Asignar proveedor (Acción de GitHub)', date: now,
      });
    });
    await batch.commit();
  }
  console.log(`::notice::Proveedor ${sup.name} asignado a ${todo.length} producto(s)`);
}

if(require.main === module){
  (async () => {
    if(!env.FIREBASE_SERVICE_ACCOUNT){ console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT.'); process.exit(1); }
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
    await run({ db: admin.firestore(), FieldValue: admin.firestore.FieldValue });
  })().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { run };
