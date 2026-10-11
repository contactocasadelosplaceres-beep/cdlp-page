/* RESCATE: asigna admin:true SOLO al duenio, usando unicamente la API de Auth
   (no lee Firestore, asi funciona aunque la cuota de Firestore este agotada). */
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });

const EMAIL = 'contacto.casadelosplaceres@gmail.com';

(async () => {
  const user = await admin.auth().getUserByEmail(EMAIL);
  const claims = Object.assign({}, user.customClaims || {}, { admin: true });
  await admin.auth().setCustomUserClaims(user.uid, claims);
  console.log('OK: admin=true asignado a', EMAIL, '· uid:', user.uid);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
