/**
 * EPUB packaging — Phase 5. Assembles chapters + templates into a valid `.epub`.
 *
 * Dependency-free: an EPUB is a ZIP whose first entry (`mimetype`) must be *stored*
 * (uncompressed). We store every entry — for text the size cost is negligible and it
 * sidesteps bundling a deflate library (JSZip) into the SillyTavern extension. The
 * structure is the standard OCF layout: `mimetype`, `META-INF/container.xml`, and an
 * `OEBPS/` folder with `content.opf` (metadata/manifest/spine), `toc.ncx` (EPUB2 nav),
 * `nav.xhtml` (EPUB3 nav), `style.css`, and one XHTML per chapter.
 */
import type { Chapter } from './chapters';
import { BOOK_CSS, chapterXhtml, escapeXml, navXhtml, type BookMeta } from './render';
import { buildStyleCss, resolveStyleRules, type StyleConfig } from './style';

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ t[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const u16 = (n: number): Uint8Array => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n: number): Uint8Array => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

/** Build a ZIP with all entries STORED (compression method 0). Filenames are ASCII. */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(name.length), u16(0),
      name, e.data,
    ]);
    locals.push(local);
    central.push(
      concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }

  const centralBytes = concat(central);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(offset), u16(0),
  ]);
  return concat([...locals, centralBytes, end]);
}

function uuid(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function chapterHref(ch: Chapter): string {
  return `chap-${String(ch.index).padStart(4, '0')}.xhtml`;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
}

function contentOpf(chapters: Chapter[], meta: BookMeta, id: string): string {
  const lang = escapeXml(meta.language || 'zh');
  const modified = `${new Date().toISOString().split('.')[0]}Z`;
  const creator = meta.author ? `\n    <dc:creator>${escapeXml(meta.author)}</dc:creator>` : '';
  const coverMeta = meta.cover ? '\n    <meta name="cover" content="cover-image"/>' : '';
  const coverItem = meta.cover
    ? `\n    <item id="cover-image" href="${escapeXml(meta.cover.href)}" media-type="${escapeXml(meta.cover.mediaType)}" properties="cover-image"/>`
    : '';
  const items = chapters
    .map(ch => `    <item id="ch${ch.index}" href="${chapterHref(ch)}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spine = chapters.map(ch => `    <itemref idref="ch${ch.index}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${id}</dc:identifier>
    <dc:title>${escapeXml(meta.title)}</dc:title>
    <dc:language>${lang}</dc:language>${creator}
    <meta property="dcterms:modified">${modified}</meta>${coverMeta}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>${coverItem}
${items}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>`;
}

function tocNcx(chapters: Chapter[], meta: BookMeta, id: string): string {
  const points = chapters
    .map(
      (ch, i) =>
        `    <navPoint id="np${ch.index}" playOrder="${i + 1}"><navLabel><text>${escapeXml(ch.title)}</text></navLabel><content src="${chapterHref(ch)}"/></navPoint>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:${id}"/></head>
  <docTitle><text>${escapeXml(meta.title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>`;
}

/** Assemble chapters + metadata into EPUB bytes. `style` adds typography (presets + custom CSS). */
export function buildEpub(chapters: Chapter[], meta: BookMeta, style?: StyleConfig): Uint8Array {
  const enc = new TextEncoder();
  const id = uuid();
  const text = (name: string, content: string): ZipEntry => ({ name, data: enc.encode(content) });

  const rules = style ? resolveStyleRules(style) : [];
  const styleCss = style ? buildStyleCss(style) : '';
  const css = styleCss ? `${BOOK_CSS}\n${styleCss}\n` : BOOK_CSS;

  const entries: ZipEntry[] = [
    text('mimetype', 'application/epub+zip'), // MUST be first + stored
    text('META-INF/container.xml', containerXml()),
    text('OEBPS/content.opf', contentOpf(chapters, meta, id)),
    text('OEBPS/nav.xhtml', navXhtml(chapters, meta, chapterHref)),
    text('OEBPS/toc.ncx', tocNcx(chapters, meta, id)),
    text('OEBPS/style.css', css),
    ...(meta.cover ? [{ name: `OEBPS/${meta.cover.href}`, data: meta.cover.data }] : []),
    ...chapters.map(ch => text(`OEBPS/${chapterHref(ch)}`, chapterXhtml(ch, meta, rules))),
  ];
  return zipStore(entries);
}
