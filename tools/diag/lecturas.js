/* AUDITORÍA (rama audit/*): Lighthouse contra el sitio publicado (solo lectura, 1 visita por página). */
const { execSync } = require('child_process'); const fs = require('fs');
const note = s => console.log('::notice::' + s);
const BASE = 'https://contactocasadelosplaceres-beep.github.io/cdlp-page/';
const runs = [['tienda celular', BASE, 'mobile'], ['tienda computadora', BASE, 'desktop'], ['admin (login) celular', BASE + 'admin.html', 'mobile']];
const out = [];
for (const [name, url, ff] of runs) {
  try {
    execSync(`npx -y lighthouse@12.2.1 "${url}" --quiet --output=json --output-path=lh.json --form-factor=${ff} ${ff === 'desktop' ? '--preset=desktop' : ''} --only-categories=performance,accessibility,best-practices,seo --chrome-flags="--headless=new --no-sandbox"`, { stdio: 'pipe', timeout: 240000 });
    const r = JSON.parse(fs.readFileSync('lh.json', 'utf8'));
    const c = r.categories, a = r.audits;
    const sc = k => Math.round((c[k] && c[k].score || 0) * 100);
    const m = k => a[k] ? a[k].displayValue : '?';
    const opp = Object.values(a).filter(x => x.details && x.details.type === 'opportunity' && x.numericValue > 300).sort((x, y) => y.numericValue - x.numericValue).slice(0, 3).map(x => `${x.title} (${Math.round(x.numericValue)} ms)`);
    const fails = Object.values(a).filter(x => x.score === 0 && x.scoreDisplayMode === 'binary').map(x => x.id).slice(0, 12);
    out.push(`${name}: Rend ${sc('performance')} · Acces ${sc('accessibility')} · Buenas prác ${sc('best-practices')} · SEO ${sc('seo')} · FCP ${m('first-contentful-paint')} · LCP ${m('largest-contentful-paint')} · TBT ${m('total-blocking-time')} · CLS ${m('cumulative-layout-shift')} · peso ${m('total-byte-weight')} · oportunidades: ${opp.join('; ') || '—'} · fallas: ${fails.join(', ')}`);
  } catch (e) { out.push(`${name}: error ${String(e.message).slice(0, 200)}`); }
}
out.forEach(note);
