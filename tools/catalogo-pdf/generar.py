#!/usr/bin/env python3
"""Catálogo en PDF de La Casa de los Placeres.

Lee catalogo.json (el mismo que usa la tienda, sin lecturas de Firestore) y arma catalogo.pdf:
portada, índice con enlaces, una sección por categoría con tarjetas (foto, nombre, precio,
promoción) que abren el producto en casaplaceres.com, y una contraportada con cómo pedir.

Solo salen productos visibles y con existencias. Las ofertas relámpago NO salen (duran horas y el
PDF vive días); sí sale el precio de promoción del producto.

Uso:  python3 tools/catalogo-pdf/generar.py [--root .] [--out catalogo.pdf] [--site https://casaplaceres.com]
Requiere: pip install reportlab pillow
"""
import argparse, base64, io, json, os, re, sys, unicodedata
from datetime import datetime, timezone, timedelta

from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 600, 960                      # página vertical pensada para leerse en el celular
M = 34                               # margen
COLS, ROWS = 2, 3
EXCLUIR_CATS = {'Ocultos'}
MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
         'octubre', 'noviembre', 'diciembre']

PLUM = HexColor('#993477'); PLUM_DEEP = HexColor('#521C3E'); ROSE = HexColor('#BC355C')
CORAL = HexColor('#ED7578'); AMBER = HexColor('#F6A030'); GREEN = HexColor('#7AB71A')
TEAL = HexColor('#20B7CA'); NAVY = HexColor('#0A4A5B'); INK = HexColor('#1A1A1A')
INK_SOFT = HexColor('#666666'); BG = HexColor('#F9F6F8'); SOFT = HexColor('#F6E9E6')
BORDER = HexColor('#EBD9D3')
CAT_COLORS = [PLUM, ROSE, NAVY, TEAL, CORAL, AMBER, GREEN]

for name, file in [('P', 'Poppins-Regular'), ('PL', 'Poppins-Light'), ('PM', 'Poppins-Medium'), ('PB', 'Poppins-Bold')]:
    pdfmetrics.registerFont(TTFont(name, os.path.join(HERE, 'fonts', file + '.ttf')))


# ---------- datos (misma lógica que tools/catalogo/seo.js) ----------
def slugify(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower().replace('ñ', 'n')
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:70].rstrip('-')
    return s or 'producto'

def variants(p):
    return [v for v in (p.get('variants') or []) if isinstance(v, dict)]

def in_stock(p):
    vs = variants(p)
    return any(float(v.get('stock') or 0) > 0 for v in vs) if vs else float(p.get('stock') or 0) > 0

def price_info(p):
    price = float(p.get('price') or 0); promo = float(p.get('promoPrice') or 0)
    base = promo if 0 < promo < price else price
    vs = [v for v in variants(p) if float(v.get('stock') or 0) > 0] or variants(p)
    if not vs:
        return base, base, price
    ps = []
    for v in vs:
        lst = float(v.get('priceOverride') or 0) or price
        pv = float(v.get('promoPriceOverride') or 0)
        ps.append(pv if 0 < pv < lst else (lst if float(v.get('priceOverride') or 0) > 0 else base))
    ps = [x for x in ps if x > 0] or [base]
    return min(ps), max(ps), price

def money(n):
    n = round(float(n), 2)
    return '$' + (f'{n:,.0f}' if n == int(n) else f'{n:,.2f}')

def load(root):
    d = json.load(open(os.path.join(root, 'catalogo.json'), encoding='utf-8'))
    prods, s = d.get('products') or [], d.get('settings') or {}
    # slugs estables: mismo orden y desempate que seo.js (por id)
    used, slug_of = set(), {}
    for p in sorted([p for p in prods if p.get('id') and p.get('name') and not p.get('hidden') and not p.get('deletedAt')],
                    key=lambda p: str(p['id'])):
        sl = slugify(p['name'])
        if sl in used: sl = sl + '-' + str(p['id'])[:6].lower()
        used.add(sl); slug_of[p['id']] = sl
    hidden = set(s.get('hiddenCategories') or []) | EXCLUIR_CATS
    best = {i.split('::')[0]: n for n, i in enumerate(s.get('bestSellerProductIds') or [])}
    order = [c for c in (s.get('categories') or []) if c not in hidden]
    by = {}
    for p in prods:
        if p.get('id') not in slug_of or not in_stock(p): continue
        cat = p.get('cat') or ((p.get('categories') or [None])[0])
        if not cat or cat in hidden: continue
        by.setdefault(cat, []).append(p)
    cats = sorted(by, key=lambda c: (order.index(c) if c in order else 999, c))
    for c in cats:
        by[c].sort(key=lambda p: (best.get(p['id'], 999), str(p['name']).lower()))
    return s, cats, by, slug_of


# ---------- imágenes ----------
_img_cache = {}
def product_image(root, p, px=440):
    pid = p['id']
    if pid in _img_cache: return _img_cache[pid]
    out = None
    for src in (p.get('images') or [])[:1]:
        try:
            if src.startswith('data:'):
                raw = base64.b64decode(src.split(',', 1)[1]); im = Image.open(io.BytesIO(raw))
            else:
                f = os.path.join(root, src.lstrip('/'))
                if not os.path.exists(f): continue
                im = Image.open(f)
            im = im.convert('RGBA')
            bg = Image.new('RGB', im.size, (255, 255, 255)); bg.paste(im, mask=im.split()[3]); im = bg
            im.thumbnail((px, px), Image.LANCZOS)
            buf = io.BytesIO(); im.save(buf, 'JPEG', quality=72, optimize=True, progressive=True); buf.seek(0)
            out = (ImageReader(buf), im.size)
        except Exception as e:
            print('foto no legible', pid, e, file=sys.stderr)
    _img_cache[pid] = out
    return out


# ---------- utilidades de dibujo ----------
def wrap(text, font, size, width, max_lines):
    words, lines, cur = str(text).split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if pdfmetrics.stringWidth(t, font, size) <= width: cur = t
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and pdfmetrics.stringWidth(last + '…', font, size) > width: last = last[:-1]
        lines[-1] = last.rstrip() + '…'
    return lines

def qr_code(c, url, x, y, size, color=INK):
    w = qr.QrCodeWidget(url); w.barFillColor = color; w.barStrokeColor = color
    b = w.getBounds(); bw, bh = b[2] - b[0], b[3] - b[1]
    d = Drawing(size, size, transform=[size / bw, 0, 0, size / bh, 0, 0]); d.add(w)
    renderPDF.draw(d, c, x, y)

def pill(c, x, y, text, font, size, fill, color, pad=8, h=None):
    h = h or size + 9
    w = pdfmetrics.stringWidth(text, font, size) + pad * 2
    c.setFillColor(fill); c.roundRect(x, y, w, h, h / 2, stroke=0, fill=1)
    c.setFillColor(color); c.setFont(font, size); c.drawString(x + pad, y + (h - size) / 2 + size * 0.22, text)
    return w

def wa_link(s, text):
    from urllib.parse import quote
    return f"https://wa.me/{re.sub(r'[^0-9]', '', s.get('whatsapp') or '')}?text={quote(text)}"

def footer(c, page_no, site_host):
    c.setStrokeColor(BORDER); c.setLineWidth(0.6); c.line(M, 40, W - M, 40)
    c.setFont('PM', 8.5); c.setFillColor(PLUM); c.drawString(M, 26, 'LA CASA DE LOS PLACERES')
    c.setFont('P', 8.5); c.setFillColor(INK_SOFT)
    c.drawCentredString(W / 2, 26, site_host)
    c.drawRightString(W - M, 26, str(page_no))


# ---------- páginas ----------
def cover(c, root, s, total, cats, fecha, site, site_host):
    c.setFillColor(PLUM); c.rect(0, 0, W, H, stroke=0, fill=1)
    # franja de colores de marca
    seg = W / len(CAT_COLORS)
    for i, col in enumerate([ROSE, CORAL, AMBER, GREEN, TEAL, NAVY, PLUM_DEEP]):
        c.setFillColor(col); c.rect(i * seg, H - 10, seg + 1, 10, stroke=0, fill=1)
    logo = os.path.join(root, 'assets', 'logo.png')
    if os.path.exists(logo):
        im = Image.open(logo).convert('RGB'); im.thumbnail((700, 700))
        b = io.BytesIO(); im.save(b, 'JPEG', quality=88); b.seek(0)
        c.drawImage(ImageReader(b), W / 2 - 150, H - 400, 300, 300)
    c.setFillColor(white)
    c.setFont('PL', 15); c.drawCentredString(W / 2, H - 432, 'L A   C A S A   D E   L O S')
    c.setFont('PB', 54); c.drawCentredString(W / 2, H - 486, 'PLACERES')
    c.setStrokeColor(CORAL); c.setLineWidth(2); c.line(W / 2 - 40, H - 510, W / 2 + 40, H - 510)
    c.setFont('PM', 22); c.drawCentredString(W / 2, H - 548, 'Catálogo')
    c.setFont('PL', 13); c.drawCentredString(W / 2, H - 570, f'{fecha}  ·  {total} productos disponibles')
    # beneficios
    items = ['Empaque discreto, sin marcas', 'Pagas al recibir', 'Atención personal y sin prejuicios']
    y = H - 640
    for t in items:
        c.setFillColor(CORAL); c.circle(W / 2 - 128, y + 4, 3.2, stroke=0, fill=1)
        c.setFillColor(white); c.setFont('P', 12.5); c.drawString(W / 2 - 116, y, t); y -= 26
    # tarjeta inferior con QR
    bx, by, bw, bh = M, 52, W - 2 * M, 150
    c.setFillColor(white); c.roundRect(bx, by, bw, bh, 18, stroke=0, fill=1)
    qr_code(c, site, bx + 18, by + 17, 116, PLUM_DEEP)
    tx = bx + 152
    c.setFillColor(INK); c.setFont('PB', 17); c.drawString(tx, by + bh - 40, 'Compra en línea')
    c.setFont('PB', 15); c.setFillColor(PLUM); c.drawString(tx, by + bh - 64, site_host)
    c.linkURL(site, (tx, by + bh - 70, tx + 220, by + bh - 50))
    c.setFont('P', 10.5); c.setFillColor(INK_SOFT)
    c.drawString(tx, by + bh - 90, 'Toca cualquier producto para verlo y pedirlo.')
    c.drawString(tx, by + bh - 107, s.get('schedule') or 'Lun–Vie 10am–9pm · Sáb 10am–2pm')
    c.drawString(tx, by + bh - 124, 'Ciudad Guzmán, Jalisco · Envío local $35')
    c.showPage()

def index_page(c, cats, by, pages, site_host):
    c.setFillColor(BG); c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(INK); c.setFont('PB', 30); c.drawString(M, H - 90, 'Contenido')
    c.setFillColor(INK_SOFT); c.setFont('P', 11.5)
    c.drawString(M, H - 114, 'Toca una categoría para ir directo a ella.')
    y = H - 170; rh = 52
    for i, cat in enumerate(cats):
        col = CAT_COLORS[i % len(CAT_COLORS)]
        c.setFillColor(white); c.roundRect(M, y - 16, W - 2 * M, rh - 8, 12, stroke=0, fill=1)
        c.setFillColor(col); c.roundRect(M, y - 16, 8, rh - 8, 4, stroke=0, fill=1)
        c.setFillColor(INK); c.setFont('PM', 15); c.drawString(M + 26, y + 2, cat)
        n = len(by[cat])
        c.setFillColor(INK_SOFT); c.setFont('P', 10.5)
        c.drawString(M + 26 + pdfmetrics.stringWidth(cat, 'PM', 15) + 10, y + 3, f'{n} producto{"s" if n != 1 else ""}')
        c.setFillColor(col); c.setFont('PB', 14); c.drawRightString(W - M - 18, y + 2, str(pages[cat]))
        c.linkRect('', 'cat-' + slugify(cat), (M, y - 16, W - M, y - 16 + rh - 8), relative=0)
        y -= rh
    footer(c, 2, site_host)
    c.showPage()

def cat_header(c, cat, color, n, first):
    hh = 118 if first else 64
    c.setFillColor(color); c.rect(0, H - hh, W, hh, stroke=0, fill=1)
    c.setFillColor(white)
    if first:
        c.setFont('PL', 11); c.drawString(M, H - 46, 'CATEGORÍA')
        c.setFont('PB', 32); c.drawString(M, H - 86, cat)
        c.setFont('P', 11); c.drawRightString(W - M, H - 86, f'{n} disponible{"s" if n != 1 else ""}')
    else:
        c.setFont('PM', 15); c.drawString(M, H - 40, cat)
        c.setFont('P', 10); c.drawRightString(W - M, H - 40, 'continuación')
    return H - hh

def card(c, root, p, x, y, w, h, color, url, cat):
    c.setFillColor(white); c.setStrokeColor(BORDER); c.setLineWidth(0.7)
    c.roundRect(x, y, w, h, 14, stroke=1, fill=1)
    pad = 10; iw = w - 2 * pad
    text_h = 92                                  # nombre (2 líneas) + precio + pie de tarjeta
    ih = min(iw * 0.9, h - pad - text_h)
    ix, iy = x + pad, y + h - pad - ih
    c.setFillColor(white); c.rect(ix, iy, iw, ih, stroke=0, fill=1)
    img = product_image(root, p)
    if img:
        r, (pw, ph) = img; sc = min(iw / pw, ih / ph); dw, dh = pw * sc, ph * sc
        c.drawImage(r, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh)
    lo, hi, lst = price_info(p)
    promo = lo < lst and lo == hi
    if promo:
        pct = round((1 - lo / lst) * 100)
        pill(c, ix + 6, iy + ih - 24, f'-{pct}%', 'PB', 9, ROSE, white)
    # nombre
    ty = y + 74
    c.setFillColor(INK); c.setFont('PM', 11)
    for ln in wrap(p['name'], 'PM', 11, iw, 2):
        c.drawString(ix, ty, ln); ty -= 14
    # precio
    py = y + 32
    c.setFont('PB', 16); c.setFillColor(ROSE if promo else INK)
    ptxt = money(lo) if lo == hi else f'{money(lo)} – {money(hi)}'
    c.drawString(ix, py, ptxt)
    if promo:
        px = ix + pdfmetrics.stringWidth(ptxt, 'PB', 16) + 8
        c.setFont('P', 10.5); c.setFillColor(INK_SOFT); t = money(lst); c.drawString(px, py + 1, t)
        tw = pdfmetrics.stringWidth(t, 'P', 10.5); c.setStrokeColor(INK_SOFT); c.setLineWidth(0.8)
        c.line(px - 1, py + 4.6, px + tw + 1, py + 4.6)
    c.setFont('P', 9); c.setFillColor(INK_SOFT)
    c.drawString(ix, y + 16, 'Varias opciones' if len(variants(p)) > 1 else (p.get('sku') or ''))
    c.setFont('PM', 9.5); c.setFillColor(color); c.drawRightString(x + w - pad, y + 16, 'Ver y pedir  ›')
    c.linkURL(url, (x, y, x + w, y + h), relative=0)

def back_page(c, s, site, site_host, page_no):
    c.setFillColor(PLUM_DEEP); c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(white); c.setFont('PB', 30); c.drawString(M, H - 100, '¿Cómo pedir?')
    steps = [('1', 'Elige', 'Toca el producto en este catálogo o entra a ' + site_host + '.'),
             ('2', 'Pide', 'Arma tu carrito y envía tu pedido en un minuto.'),
             ('3', 'Recibe', 'Te lo llevamos en empaque discreto y pagas al recibir.')]
    y = H - 180
    for n, t, d in steps:
        c.setFillColor(CORAL); c.circle(M + 22, y + 6, 22, stroke=0, fill=1)
        c.setFillColor(white); c.setFont('PB', 18); c.drawCentredString(M + 22, y, n)
        c.setFont('PB', 17); c.drawString(M + 62, y + 10, t)
        c.setFont('P', 11.5); c.setFillColor(HexColor('#F3DDEA'))
        for i, ln in enumerate(wrap(d, 'P', 11.5, W - 2 * M - 62, 2)): c.drawString(M + 62, y - 8 - i * 15, ln)
        y -= 96
    bx, by, bw, bh = M, 230, W - 2 * M, 300
    c.setFillColor(white); c.roundRect(bx, by, bw, bh, 18, stroke=0, fill=1)
    qr_code(c, site, bx + bw / 2 - 75, by + bh - 175, 150, PLUM_DEEP)
    c.setFillColor(PLUM); c.setFont('PB', 20); c.drawCentredString(W / 2, by + 88, site_host)
    c.linkURL(site, (bx, by + 80, bx + bw, by + 112))
    c.setFillColor(INK_SOFT); c.setFont('P', 11)
    c.drawCentredString(W / 2, by + 62, 'Precios y existencias al día en la página.')
    c.drawCentredString(W / 2, by + 44, 'Este catálogo se actualiza solo; pide siempre el más reciente.')
    c.setFillColor(white); c.setFont('PM', 12)
    c.drawCentredString(W / 2, 180, s.get('schedule') or 'Lun–Vie 10am–9pm · Sáb 10am–2pm')
    c.setFont('P', 11); c.drawCentredString(W / 2, 160, 'Ciudad Guzmán, Jalisco  ·  Envío local $35  ·  Otras ciudades: cotiza')
    c.drawCentredString(W / 2, 140, 'Instagram  @lacasadelosplaceres')
    c.setFont('PL', 9); c.setFillColor(HexColor('#D9B7CB'))
    c.drawCentredString(W / 2, 70, 'Productos para mayores de 18 años. Precios en pesos mexicanos, sujetos a cambio sin aviso.')
    c.drawCentredString(W / 2, 56, 'Las imágenes son ilustrativas.')
    c.showPage()


def build(root, out, site):
    s, cats, by, slug_of = load(root)
    site = site.rstrip('/'); site_host = re.sub(r'^https?://', '', site)
    total = sum(len(v) for v in by.values())
    now = datetime.now(timezone(timedelta(hours=-6)))
    fecha = f'{MESES[now.month - 1].capitalize()} {now.year}'
    per = COLS * ROWS
    # páginas: 1 portada, 2 índice, luego cada categoría
    pages, pno = {}, 3
    for cat in cats:
        pages[cat] = pno
        pno += max(1, -(-n // per))
    c = canvas.Canvas(out, pagesize=(W, H), pageCompression=1)
    c.setTitle(f'Catálogo La Casa de los Placeres · {fecha}')
    c.setAuthor('La Casa de los Placeres'); c.setSubject('Catálogo de productos')
    cover(c, root, s, total, cats, fecha, site, site_host)
    index_page(c, cats, by, pages, site_host)
    pno = 3
    for ci, cat in enumerate(cats):
        color = CAT_COLORS[ci % len(CAT_COLORS)]
        items = by[cat]
        for start in range(0, len(items), per):
            first = start == 0
            c.setFillColor(BG); c.rect(0, 0, W, H, stroke=0, fill=1)
            if first:
                c.bookmarkPage('cat-' + slugify(cat)); c.addOutlineEntry(cat, 'cat-' + slugify(cat), 0)
            top = cat_header(c, cat, color, len(items), first) - 18
            gap = 14; cw = (W - 2 * M - gap) / COLS
            ch = (top - 54 - gap * (ROWS - 1)) / ROWS
            for k, p in enumerate(items[start:start + per]):
                r, col = divmod(k, COLS)
                x = M + col * (cw + gap); y = top - (r + 1) * ch - r * gap
                card(c, root, p, x, y, cw, ch, color, f"{site}/p/{slug_of[p['id']]}/", cat)
            footer(c, pno, site_host); c.showPage(); pno += 1
    back_page(c, s, site, site_host, pno)
    c.save()
    kb = os.path.getsize(out) // 1024
    print(f'Catálogo PDF: {total} productos en {len(cats)} categorías · {pno} páginas · {kb} KB → {out}')


if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('--root', default=os.path.join(HERE, '..', '..'))
    a.add_argument('--out', default=None)
    a.add_argument('--site', default=os.environ.get('SITE_URL') or 'https://casaplaceres.com')
    o = a.parse_args()
    build(os.path.abspath(o.root), o.out or os.path.join(os.path.abspath(o.root), 'catalogo.pdf'), o.site)
