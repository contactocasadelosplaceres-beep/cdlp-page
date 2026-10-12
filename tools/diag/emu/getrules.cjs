const admin = require('../node_modules/firebase-admin'); const fs = require('fs');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
(async () => {
  const { access_token } = await admin.app().options.credential.getAccessToken();
  const H = { Authorization: 'Bearer ' + access_token };
  const rel = await (await fetch(`https://firebaserules.googleapis.com/v1/projects/${sa.project_id}/releases/cloud.firestore`, { headers: H })).json();
  const rs = await (await fetch(`https://firebaserules.googleapis.com/v1/${rel.rulesetName}`, { headers: H })).json();
  fs.writeFileSync(__dirname + '/firestore.rules', (rs.source.files || []).map(f => f.content).join('\n'));
  console.log('reglas publicadas listas para el emulador');
})();
