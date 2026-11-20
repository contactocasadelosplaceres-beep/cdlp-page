/* Ajustes masivos de productos: nombre, precio y categorías, leídos de cambios.json.
   Cada producto se busca por SKU y solo se toca si su nombre actual coincide con "antes"
   (así no se pisa un producto que alguien ya editó o un SKU repetido).
   Variables: FIREBASE_SERVICE_ACCOUNT, DRY_RUN (1 = solo reporte, por defecto), BACKUP_DIR.
   Cada producto se actualiza en una transacción, deja respaldo JSON de lo que tenía, marca _sync
   (el panel y el catálogo ven el cambio) y anota el cambio en la bitácora (adminAuditLog). */
const fs = require('fs');
const path = require('path');
const env = process.env;
const DRY_RUN = env.DRY_RUN !== '0';
const BACKUP_DIR = env.BACKUP_DIR || path.join(__dirname, 'respaldo');
const { cambios } = JSON.parse(fs.readFileSync(path.join(__dirname, 'cambios.json'), 'utf8'));

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const money = n => '$' + Number(n || 0).toLocaleString('es-MX');

function planFor(c, data, storeCats){
  const upd = {}, notes = [];
  if(c.nombre && c.nombre !== data.name){ upd.name = c.nombre; notes.push(`Nombre: ${data.name} → ${c.nombre}`); }
  if(c.precio != null && Number(data.price) !== c.precio){
    upd.price = c.precio; notes.push(`Precio: ${money(data.price)} → ${money(c.precio)}`);
    if(Number(data.promoPrice) > 0 && Number(data.promoPrice) >= c.precio) notes.push(`OJO: su precio promocional (${money(data.promoPrice)}) quedó igual o mayor`);
    const overrides = (Array.isArray(data.variants) ? data.variants : []).filter(v => v && Number(v.priceOverride) > 0);
    if(overrides.length) notes.push(`OJO: ${overrides.length} variante(s) tienen precio propio y no cambian`);
  }
  if(c.categorias){
    const faltan = (c.categorias.poner || []).filter(x => !storeCats.includes(x));
    if(faltan.length) notes.push(`NO se cambió la categoría: no existe en la tienda (${faltan.join(', ')})`);
    else {
      const prev = Array.isArray(data.categories) && data.categories.length ? data.categories : [data.cat].filter(Boolean);
      let next = prev.filter(x => !(c.categorias.quitar || []).includes(x));
      (c.categorias.poner || []).forEach(x => { if(!next.includes(x)) next.push(x); });
      if(!next.length) next = prev;
      if(JSON.stringify(next) !== JSON.stringify(prev)){
        upd.categories = next;
        const cat = next.includes(data.cat) ? data.cat : next[0];
        if(cat !== data.cat) upd.cat = cat;
        notes.push(`Categorías: ${prev.join(', ')} → ${next.join(', ')}`);
      }
    }
  }
  return { upd, notes };
}

async function run({ db, FieldValue }){
  const [snap, storeDoc] = await Promise.all([db.collection('products').get(), db.collection('settings').doc('store').get()]);
  const storeCats = (storeDoc.exists && Array.isArray(storeDoc.data().categories)) ? storeDoc.data().categories : [];
  const live = snap.docs.filter(d => !d.data().deletedAt);
  console.log(`Productos: ${live.length} · cambios en la lista: ${cambios.length} · ${DRY_RUN ? 'DRY_RUN (no cambia nada)' : 'APLICANDO'}`);
  const todo = [], problemas = [];
  for(const c of cambios){
    const hits = live.filter(d => String(d.data().sku || '').trim().toUpperCase() === c.sku.toUpperCase());
    if(!hits.length){ problemas.push(`${c.sku}: no se encontró ningún producto con ese SKU`); continue; }
    const ok = hits.filter(d => norm(d.data().name) === norm(c.antes) || (c.nombre && norm(d.data().name) === norm(c.nombre)));
    if(ok.length !== 1){ problemas.push(`${c.sku}: ${ok.length ? 'hay varios productos' : 'el nombre actual no coincide'} (${hits.map(d => `"${d.data().name}"`).join(', ')}) — no se tocó`); continue; }
    const d = ok[0]; const p = planFor(c, d.data(), storeCats);
    if(!Object.keys(p.upd).length){ console.log(`  = ${c.sku}  ${d.data().name}: ya estaba como se pidió${p.notes.length ? ' · ' + p.notes.join(' · ') : ''}`); continue; }
    todo.push({ c, d, p });
    console.log(`  • ${c.sku}  ${p.notes.join(' · ')}`);
  }
  problemas.forEach(x => console.log(`  ✗ ${x}`));
  console.log(`::notice::${DRY_RUN ? 'Prueba' : 'Aplicando'}: ${todo.length} producto(s) a cambiar · ${problemas.length} sin tocar por algún problema`);
  if(DRY_RUN){ console.log('DRY_RUN: no se tocó Firestore.'); return { changed: 0, problemas }; }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  let changed = 0;
  for(const { c, d } of todo){
    await db.runTransaction(async tx => {
      const cur = await tx.get(d.ref); if(!cur.exists) return;
      const data = cur.data(); const p = planFor(c, data, storeCats);
      if(!Object.keys(p.upd).length) return;
      fs.writeFileSync(path.join(BACKUP_DIR, `${d.id}.json`), JSON.stringify({ id: d.id, sku: c.sku, name: data.name, price: data.price, cat: data.cat, categories: data.categories || null }));
      tx.update(d.ref, Object.assign({}, p.upd, { _sync: FieldValue.serverTimestamp() }));
      tx.set(db.collection('adminAuditLog').doc(), {
        action: 'price' in p.upd ? 'cambio_precio' : 'edicion_producto', targetType: 'producto', targetName: data.name || '',
        details: p.notes.join(' · '), targetId: d.id, userEmail: 'Ajuste masivo (Acción de GitHub)', date: new Date().toISOString(),
      });
    });
    changed++;
  }
  console.log(`Productos cambiados: ${changed}`);
  console.log(`::notice::Cambiados: ${changed} · sin tocar: ${problemas.length}`);
  return { changed, problemas };
}
module.exports = { run, planFor };

if(require.main === module){
  (async () => {
    if(!env.FIREBASE_SERVICE_ACCOUNT){ console.error('Falta el secreto FIREBASE_SERVICE_ACCOUNT.'); process.exit(1); }
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
    await run({ db: admin.firestore(), FieldValue: admin.firestore.FieldValue });
  })().catch(e => { console.error(e); process.exit(1); });
}
