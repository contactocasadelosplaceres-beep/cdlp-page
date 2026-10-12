/* Registro público de cuentas (hallazgo H-10). ACCION=revisar solo informa; ACCION=cerrar impide que
   alguien cree una cuenta desde una página: las del personal se siguen creando desde la consola de
   Firebase. No toca cuentas existentes ni el inicio de sesión. */
const admin = require('../diag/node_modules/firebase-admin');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const note = s => console.log('::notice::' + s);
(async () => {
  const { access_token } = await admin.app().options.credential.getAccessToken();
  const H = { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' };
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${sa.project_id}/config`;
  const show = c => `registro público cerrado=${!!(c.client && c.client.permissions && c.client.permissions.disabledUserSignup)} · correo/contraseña=${!!(c.signIn && c.signIn.email && c.signIn.email.enabled)}`;
  const cur = await (await fetch(url, { headers: H })).json();
  note('Antes: ' + show(cur));
  if ((process.env.ACCION || 'revisar') !== 'cerrar') return;
  const r = await fetch(url + '?updateMask=client.permissions.disabledUserSignup', { method: 'PATCH', headers: H, body: JSON.stringify({ client: { permissions: { disabledUserSignup: true } } }) });
  const j = await r.json();
  if (!r.ok) { console.log('::error::No se pudo cerrar el registro: ' + JSON.stringify(j).slice(0, 300)); process.exit(1); }
  note('Después: ' + show(j));
})().catch(e => { console.log('::error::' + e.message); process.exit(1); });
