/* Activa el segundo factor (codigo de 6 digitos / TOTP) de Firebase Authentication.
   Requiere que el proyecto este actualizado a "Firebase Auth con Identity Platform"
   (plan Spark sirve). Solo toca la configuracion de Auth, no lee Firestore.
   DRY_RUN=1 -> solo muestra la configuracion actual · DRY_RUN=0 -> activa TOTP.
   Siempre muestra quien del equipo (claim admin/staff) ya tiene el codigo y quien no. */
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const DRY = String(process.env.DRY_RUN || '1') !== '0';
const QUITAR = String(process.env.QUITAR_A || '').trim().toLowerCase();

(async () => {
  if (QUITAR) {
    // Rescate: si alguien perdio el celular, se le quita el codigo para que pueda entrar y registrarlo de nuevo.
    const u = await admin.auth().getUserByEmail(QUITAR);
    const n = ((u.multiFactor || {}).enrolledFactors || []).length;
    console.log(QUITAR, 'tiene', n, 'app(s) de autenticacion registradas.');
    if (!n) return;
    if (DRY) { console.log('DRY_RUN=1: no se quito nada. Corre con dry_run = 0 para quitarlas.'); return; }
    await admin.auth().updateUser(u.uid, { multiFactor: { enrolledFactors: null } });
    console.log('OK: se quito el codigo de 6 digitos de', QUITAR, '. Ya puede entrar solo con contrasena y volver a activarlo.');
    return;
  }
  // Reporte (S-04): quién del equipo ya tiene el código. Las reglas lo exigen para leer o escribir datos.
  let page, sin = [], con = [];
  do {
    const r = await admin.auth().listUsers(1000, page);
    r.users.forEach(u => {
      const c = u.customClaims || {};
      if (c.admin !== true && c.staff !== true) return;
      const n = ((u.multiFactor || {}).enrolledFactors || []).length;
      (n ? con : sin).push(`${u.email || u.uid} (${c.admin ? 'admin' : 'staff'})`);
    });
    page = r.pageToken;
  } while (page);
  console.log(`::notice::Equipo con código de 6 dígitos (${con.length}): ${con.join(', ') || 'nadie'}`);
  console.log(`::${sin.length ? 'warning' : 'notice'}::Equipo SIN código (${sin.length}): ${sin.join(', ') || 'nadie — listo para publicar las reglas'}`);
  const mgr = admin.auth().projectConfigManager();
  const cur = await mgr.getProjectConfig();
  console.log('Configuracion actual de MFA:', JSON.stringify(cur.multiFactorConfig || null));
  const providers = ((cur.multiFactorConfig || {}).providerConfigs || []);
  const on = providers.some(p => p.state === 'ENABLED' && p.totpProviderConfig);
  if (on) { console.log('OK: el codigo de 6 digitos (TOTP) YA esta activado. No hay nada que hacer.'); return; }
  if (DRY) { console.log('DRY_RUN=1: TOTP no esta activado. Corre de nuevo con dry_run = 0 para activarlo.'); return; }
  await mgr.updateProjectConfig({
    multiFactorConfig: { providerConfigs: [{ state: 'ENABLED', totpProviderConfig: { adjacentIntervals: 5 } }] }
  });
  const after = await mgr.getProjectConfig();
  console.log('OK: TOTP activado. Configuracion nueva:', JSON.stringify(after.multiFactorConfig || null));
})().then(() => process.exit(0)).catch(e => {
  console.error('ERROR:', e && (e.message || e));
  if (String(e && e.message).match(/identity platform|not enabled|CONFIGURATION_NOT_FOUND|billing/i))
    console.error('Revisa que el proyecto este actualizado a "Firebase Auth con Identity Platform".');
  process.exit(1);
});
