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
const { cambios, ajustesTienda } = JSON.parse(fs.readFileSync(path.join(__dirname, 'cambios.json'), 'utf8'));

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
  // categoriasExactas: deja exactamente esa lista (la primera es la principal).
  if(Array.isArray(c.categoriasExactas) && c.categoriasExactas.length){
    const faltan = c.categoriasExactas.filter(x => !storeCats.includes(x));
    const prev = Array.isArray(data.categories) && data.categories.length ? data.categories : [data.cat].filter(Boolean);
    if(faltan.length) notes.push(`NO se cambió la categoría: no existe en la tienda (${faltan.join(', ')})`);
    else if(JSON.stringify(prev) !== JSON.stringify(c.categoriasExactas) || data.cat !== c.categoriasExactas[0]){
      upd.categories = [...c.categoriasExactas]; upd.cat = c.categoriasExactas[0];
      notes.push(`Categorías: ${prev.join(', ')} → ${c.categoriasExactas.join(', ')}`);
    }
  }
  // needs: etiquetas "para quién" exactas.
  if(Array.isArray(c.needs)){
    const prev = Array.isArray(data.needs) ? data.needs : [];
    if(JSON.stringify([...prev].sort()) !== JSON.stringify([...c.needs].sort())){ upd.needs = [...c.needs]; notes.push(`Para quién: ${prev.join(', ') || '(nada)'} → ${c.needs.join(', ') || '(nada)'}`); }
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
  const store = storeDoc.exists ? storeDoc.data() : {};
  let storeCats = Array.isArray(store.categories) ? store.categories : [];
  // ajustesTienda: lista de categorías (en orden) y etiquetas "para quién" de la tienda.
  let storePatch = null;
  if(ajustesTienda){
    storePatch = {};
    if(Array.isArray(ajustesTienda.categories)){
      storePatch.categories = ajustesTienda.categories;
      storePatch.hiddenCategories = (store.hiddenCategories || []).filter(x => ajustesTienda.categories.includes(x));
      const fuera = storeCats.filter(x => !ajustesTienda.categories.includes(x)), nuevas = ajustesTienda.categories.filter(x => !storeCats.includes(x));
      console.log(`Categorías de la tienda: ${ajustesTienda.categories.join(', ')}`);
      if(fuera.length) console.log(`  se quitan: ${fuera.join(', ')}`);
      if(nuevas.length) console.log(`  nuevas: ${nuevas.join(', ')}`);
      storeCats = ajustesTienda.categories;
    }
    if(Array.isArray(ajustesTienda.needs)){ storePatch.needs = ajustesTienda.needs; console.log(`Etiquetas "para quién": ${ajustesTienda.needs.map(n => n.label).join(', ')}`); }
  }
  const live = snap.docs.filter(d => !d.data().deletedAt);
  console.log(`Productos: ${live.length} · cambios en la lista: ${cambios.length} · ${DRY_RUN ? 'DRY_RUN (no cambia nada)' : 'APLICANDO'}`);
  const todo = [], problemas = [];
  for(const c of cambios){
    if(c.id){
      const d = live.find(x => x.id === c.id);
      if(!d){ problemas.push(`${c.id} (${c.antes || ''}): ya no existe`); continue; }
      const p = planFor(c, d.data(), storeCats);
      if(!Object.keys(p.upd).length) continue;
      todo.push({ c, d, p }); console.log(`  • ${d.data().name}  ${p.notes.join(' · ')}`); continue;
    }
    const hits = live.filter(d => String(d.data().sku || '').trim().toUpperCase() === c.sku.toUpperCase());
    if(!hits.length){ problemas.push(`${c.sku}: no se encontró ningún producto con ese SKU`); continue; }
    if(!c.antes){ problemas.push(`${c.sku}: falta "antes"`); continue; }
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
  if(storePatch && Object.keys(storePatch).length){
    fs.writeFileSync(path.join(BACKUP_DIR, '_settings_store.json'), JSON.stringify({ categories: store.categories || null, hiddenCategories: store.hiddenCategories || null, needs: store.needs || null }));
    await db.collection('settings').doc('store').update(storePatch);
    console.log('Ajustes de la tienda actualizados.');
  }
  let changed = 0;
  for(const { c, d } of todo){
    await db.runTransaction(async tx => {
      const cur = await tx.get(d.ref); if(!cur.exists) return;
      const data = cur.data(); const p = planFor(c, data, storeCats);
      if(!Object.keys(p.upd).length) return;
      fs.writeFileSync(path.join(BACKUP_DIR, `${d.id}.json`), JSON.stringify({ id: d.id, sku: c.sku || data.sku || '', name: data.name, price: data.price, cat: data.cat, categories: data.categories || null, needs: data.needs || null }));
      tx.update(d.ref, Object.assign({}, p.upd, { _sync: FieldValue.serverTimestamp() }));
      tx.set(db.collection('adminAuditLog').doc(), {
        action: 'price' in p.upd ? 'cambio_precio' : 'edicion_producto', targetType: 'producto', targetName: data.name || '',
        details: p.notes.join(' · '), targetId: d.id, userEmail: 'Ajuste masivo (Acción de GitHub)', date: new Date().toISOString(),
      });
    });
    changed++;
  }
  console.log(`Productos cambiados: ${changed}`);
  // Pide publicar (petición normal: el catálogo la junta con otras y respeta el tiempo mínimo entre publicaciones).
  if(changed || storePatch) await db.collection('settings').doc('publish').set({ requestedAt: new Date().toISOString(), requestedBy: 'Ajuste masivo (Acción de GitHub)' }, { merge: true });
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
