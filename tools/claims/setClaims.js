/* Asigna custom claims a las cuentas del personal y REVOCA el de cualquier cuenta que no sea
   personal. Fuente de verdad: coleccion "cashiers" (role: administrador | colaborador | cajero).
     - administrador activo -> { admin: true }
     - colaborador  activo -> { staff: true }
     - cajero / inactivo / cuenta no listada -> sin claim (acceso denegado por las reglas)
   Variables: FIREBASE_SERVICE_ACCOUNT, DRY_RUN (1 = solo reporte, por defecto).
   Correr primero con DRY_RUN=1 y revisar el reporte. */
const admin = require('firebase-admin');

const DRY_RUN = process.env.DRY_RUN !== '0';

// Red de seguridad: estas cuentas SIEMPRE seran admin, pase lo que pase en cashiers.
// Pon aqui tu(s) correo(s) de duenio para no bloquearte nunca.
const contacto.casadelosplaceres@gmail.com = [
  // 'tu-correo-de-la-tienda@ejemplo.com',
].map(e => e.trim().toLowerCase()).filter(Boolean);

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});

const db = admin.firestore();
const auth = admin.auth();

function desiredClaimFor(email, roster) {
  if (contacto.casadelosplaceres@gmail.com.includes(email)) return { admin: true };
  const r = roster.get(email);
  if (!r || !r.active) return null;
  if (r.role === 'administrador') return { admin: true };
  if (r.role === 'colaborador')   return { staff: true };
  return null; // cajero u otro: sin acceso de app
}

// Compara solo las llaves que nos importan, para no reescribir tokens sin necesidad.
function sameClaim(cur, want) {
  const a = { admin: !!(cur && cur.admin), staff: !!(cur && cur.staff) };
  const b = { admin: !!(want && want.admin), staff: !!(want && want.staff) };
  return a.admin === b.admin && a.staff === b.staff;
}

(async () => {
  // 1) Roster desde cashiers (email en minusculas)
  const roster = new Map();
  const snap = await db.collection('cashiers').get();
  snap.forEach(d => {
    const c = d.data();
    const email = (c.email || '').trim().toLowerCase();
    if (email) roster.set(email, { role: c.role || 'cajero', active: c.active !== false });
  });

  // 2) Recorre TODAS las cuentas de Firebase Auth y ajusta/revoca
  let page = await auth.listUsers(1000);
  let changed = 0, kept = 0, revoked = 0, granted = 0;
  while (true) {
    for (const u of page.users) {
      const email = (u.email || '').trim().toLowerCase();
      const want = email ? desiredClaimFor(email, roster) : null;
      const cur = u.customClaims || {};
      if (sameClaim(cur, want)) { kept++; continue; }

      const label = email || u.uid;
      const from = cur.admin ? 'admin' : cur.staff ? 'staff' : 'ninguno';
      const to = want && want.admin ? 'admin' : want && want.staff ? 'staff' : 'ninguno (revocar)';
      console.log(`${DRY_RUN ? '[DRY] ' : ''}${label}: ${from} -> ${to}`);
      changed++;
      if (want && (want.admin || want.staff)) granted++; else revoked++;

      if (!DRY_RUN) {
        // Mantener claims ajenos que no gestionamos; solo tocamos admin/staff.
        const next = { ...cur };
        delete next.admin; delete next.staff;
        if (want && want.admin) next.admin = true;
        if (want && want.staff) next.staff = true;
        await auth.setCustomUserClaims(u.uid, next);
      }
    }
    if (!page.pageToken) break;
    page = await auth.listUsers(1000, page.pageToken);
  }

  console.log(`\nResumen${DRY_RUN ? ' (DRY_RUN, no se cambio nada)' : ''}: ` +
    `${changed} por cambiar (${granted} con acceso, ${revoked} revocados), ${kept} sin cambios.`);
  if (DRY_RUN) console.log('Si el reporte se ve bien, corre de nuevo con DRY_RUN=0.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
