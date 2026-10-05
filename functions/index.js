/* La Casa de los Placeres — descuento seguro de inventario para pedidos de la tienda.
 *
 * Se ejecuta en los servidores de Firebase cada vez que se crea un documento en "orders".
 * La tienda (clientas) NO necesita permiso para tocar "products": solo crea el pedido y este código,
 * que corre con permisos de administrador, descuenta el stock en UNA transacción (o todo o nada).
 * Cancelar / reactivar / eliminar pedidos lo sigue haciendo el panel de administración.
 *
 * IMPORTANTE: REGION debe ser la misma región de tu base de datos Firestore
 * (Firebase → Firestore Database → pestaña Datos: aparece "Ubicación").
 *   nam5 (Estados Unidos)  → "us-central1"
 *   nam7                   → "us-east1"
 *   southamerica-east1     → "southamerica-east1"
 */
const REGION = 'us-central1';

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const MAX_LINES = 40, MAX_QTY = 50;

function earliestExpiry(batches) {
  const d = (batches || []).filter(b => (b.qty || 0) > 0 && b.expirationDate).map(b => b.expirationDate).sort();
  return d[0] || '';
}
// Primero en caducar, primero en salir (igual que el panel)
function fefoConsume(batches, qty) {
  const list = (batches || []).map(b => ({ ...b }));
  const order = list.map((_, i) => i).sort((a, b) => String(list[a].expirationDate || '9999-99-99').localeCompare(String(list[b].expirationDate || '9999-99-99')));
  let left = qty;
  for (const i of order) { if (left <= 0) break; const take = Math.min(list[i].qty || 0, left); list[i].qty = (list[i].qty || 0) - take; left -= take; }
  return list.filter(b => (b.qty || 0) > 0);
}
function totalStock(p) { return p.stockByCenter ? Object.values(p.stockByCenter).reduce((s, n) => s + (n || 0), 0) : (p.stock || 0); }

exports.descontarInventarioPedido = onDocumentCreated({ document: 'orders/{orderId}', region: REGION }, async (event) => {
  const orderRef = event.data.ref;
  const centersSnap = await db.collection('centers').get();
  const center = centersSnap.docs.find(d => (d.data() || {}).isDefault) || centersSnap.docs[0];
  const centerId = center ? center.id : null;

  await db.runTransaction(async (tx) => {
    const os = await tx.get(orderRef);
    if (!os.exists) return;
    const o = os.data() || {};
    if (o.stockDeducted || o.source === 'pos' || o.status === 'Cancelado') return;

    // Solo líneas válidas: id de producto, cantidad entera 1..MAX_QTY (evita pedidos manipulados)
    const lines = (Array.isArray(o.items) ? o.items : []).slice(0, MAX_LINES)
      .filter(it => it && typeof it.id === 'string' && it.id !== 'promo_buyxpayy' && Number.isInteger(it.qty) && it.qty > 0 && it.qty <= MAX_QTY);

    const prods = new Map();   // id -> datos modificables
    const touched = new Set();
    const load = async (ids) => {
      const need = [...new Set(ids)].filter(id => !prods.has(id));
      if (!need.length) return;
      const snaps = await tx.getAll(...need.map(id => db.collection('products').doc(id)));
      snaps.forEach(s => prods.set(s.ref.id, s.exists ? s.data() : null));
    };
    await load(lines.map(l => l.id));
    // componentes de kits
    const compIds = [];
    lines.forEach(l => { const p = prods.get(l.id); if (p && p.isKit) (p.kitItems || []).forEach(ki => compIds.push(ki.productId)); });
    await load(compIds);
    // kits afectados por esos componentes (para recalcular su stock)
    const affectedKitsSnap = await tx.get(db.collection('products').where('isKit', '==', true));
    affectedKitsSnap.docs.forEach(d => { if (!prods.has(d.id)) prods.set(d.id, d.data()); });

    const plain = (p, id, qty) => {
      p.stockByCenter = { ...(p.stockByCenter || {}) };
      if (centerId) p.stockByCenter[centerId] = Math.max(0, (p.stockByCenter[centerId] || 0) - qty);
      p.stock = Math.max(0, (p.stock || 0) - qty);
      if (Array.isArray(p.batches) && p.batches.length) { p.batches = fefoConsume(p.batches, qty); p.expirationDate = earliestExpiry(p.batches); }
      touched.add(id);
    };
    const moves = [];
    for (const it of lines) {
      const p = prods.get(it.id); if (!p) continue;
      if (p.isKit) {
        for (const ki of (p.kitItems || [])) {
          const c = prods.get(ki.productId); if (!c) continue;
          const q = (ki.qty || 1) * it.qty;
          plain(c, ki.productId, q); moves.push([ki.productId, q]);
        }
      } else if (it.variantId) {
        p.variants = (p.variants || []).map(v => v.id === it.variantId ? { ...v, stock: Math.max(0, (v.stock || 0) - it.qty) } : v);
        p.stock = Math.max(0, (p.stock || 0) - it.qty);
        if (Array.isArray(p.batches) && p.batches.length) { p.batches = fefoConsume(p.batches, it.qty); p.expirationDate = earliestExpiry(p.batches); }
        touched.add(it.id); moves.push([it.id, it.qty]);
      } else {
        plain(p, it.id, it.qty); moves.push([it.id, it.qty]);
      }
    }
    // recalcular kits que usan algún componente tocado
    prods.forEach((p, id) => {
      if (!p || !p.isKit || touched.has(id)) return;
      if (!(p.kitItems || []).some(ki => touched.has(ki.productId))) return;
      let min = Infinity;
      (p.kitItems || []).forEach(ki => { const c = prods.get(ki.productId); const avail = c ? Math.floor(totalStock(c) / (ki.qty || 1)) : 0; if (avail < min) min = avail; });
      p.stock = min === Infinity ? 0 : Math.max(0, min); touched.add(id);
    });

    touched.forEach(id => {
      const p = prods.get(id); if (!p) return;
      const upd = { stock: p.stock };
      if (p.stockByCenter) upd.stockByCenter = p.stockByCenter;
      if (p.variants) upd.variants = p.variants;
      if (p.batches) { upd.batches = p.batches; upd.expirationDate = p.expirationDate || ''; }
      tx.update(db.collection('products').doc(id), upd);
    });
    const when = new Date().toISOString();
    moves.forEach(([pid, q]) => tx.set(db.collection('stockMovements').doc(), {
      productId: pid, type: 'pedido_tienda', qtyChange: -q, note: `Pedido #${o.orderNumber || ''} (automático)`, centerId, date: when, userEmail: 'servidor'
    }));
    tx.update(orderRef, { stockDeducted: true, stockCenterId: centerId, stockDeductedBy: 'servidor' });
  });
});
