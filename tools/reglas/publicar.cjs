/* Publica tools/reglas/firestore.rules en Firebase (solo si las pruebas del emulador pasaron, ver
   .github/workflows/reglas.yml). Imprime el conjunto de reglas anterior para poder regresar a él:
   correr la Acción con regresar_a = ese nombre. */
const admin = require('../diag/node_modules/firebase-admin'); const fs = require('fs'); const path = require('path');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const note = s => console.log('::notice::' + s);
(async () => {
  const { access_token } = await admin.app().options.credential.getAccessToken();
  const H = { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' };
  const base = `https://firebaserules.googleapis.com/v1/projects/${sa.project_id}`;
  const relName = `projects/${sa.project_id}/releases/cloud.firestore`;
  const cur = await (await fetch(`${base}/releases/cloud.firestore`, { headers: H })).json();
  note('Reglas publicadas antes de este cambio: ' + cur.rulesetName + ' (' + cur.updateTime + ')');
  let target = (process.env.REGRESAR_A || '').trim();
  if (!target) {
    const content = fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8');
    const rs = await (await fetch(`${base}/rulesets`, { method: 'POST', headers: H, body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content }] } }) })).json();
    if (!rs.name) { console.log('::error::No se pudo crear el conjunto de reglas: ' + JSON.stringify(rs).slice(0, 400)); process.exit(1); }
    target = rs.name;
  }
  const r = await fetch(`https://firebaserules.googleapis.com/v1/${relName}`, { method: 'PATCH', headers: H, body: JSON.stringify({ release: { name: relName, rulesetName: target } }) });
  const j = await r.json();
  if (!r.ok) { console.log('::error::No se pudo publicar: ' + JSON.stringify(j).slice(0, 400)); process.exit(1); }
  note('Reglas publicadas: ' + j.rulesetName + ' (' + j.updateTime + ')');
})().catch(e => { console.log('::error::' + e.message); process.exit(1); });
