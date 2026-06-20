/**
 * Lightweight check for EPUB packaging. Asserts the ZIP structure + writes a real
 * .epub to a temp path so a follow-up `unzip` can validate it end-to-end.
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/features/chat-export/epub.check.ts
 */
import { crc32, zipStore, buildEpub, chapterHref } from './epub';
import type { Chapter } from './chapters';
import type { BookMeta } from './render';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const enc = new TextEncoder();
const dec = new TextDecoder('latin1'); // byte-exact for scanning ASCII

// CRC32 against the canonical test vector.
check('crc32("123456789") === 0xCBF43926', crc32(enc.encode('123456789')), 0xcbf43926);

// zipStore basics.
const zip = zipStore([{ name: 'mimetype', data: enc.encode('application/epub+zip') }]);
check('zip starts with PK local header', [zip[0], zip[1], zip[2], zip[3]], [0x50, 0x4b, 0x03, 0x04]);

// buildEpub structure.
const meta: BookMeta = { title: '月下的黄石', author: 'Hugo', language: 'zh' };
const chapters: Chapter[] = [
  { index: 1, title: '序章', body: '月光落在松林上。', meta: {} },
  { index: 2, title: '第二章', body: '雪地无声。', meta: { time: '夜' } },
];
const epub = buildEpub(chapters, meta);
const blob = dec.decode(epub);

check('mimetype is the first entry name', dec.decode(epub.slice(30, 38)), 'mimetype');
check('mimetype is stored first, uncompressed', dec.decode(epub.slice(38, 58)), 'application/epub+zip');
check('contains container.xml', blob.includes('META-INF/container.xml'), true);
check('contains content.opf', blob.includes('OEBPS/content.opf'), true);
check('contains toc.ncx', blob.includes('OEBPS/toc.ncx'), true);
check('contains nav.xhtml', blob.includes('OEBPS/nav.xhtml'), true);
check('contains chapter file', blob.includes(`OEBPS/${chapterHref(chapters[0])}`), true);
check('ends with EOCD signature', [epub[epub.length - 22], epub[epub.length - 21]], [0x50, 0x4b]);

const coverEpub = buildEpub(chapters, {
  ...meta,
  cover: { href: 'cover.jpg', mediaType: 'image/jpeg', data: new Uint8Array([1, 2, 3]) },
});
const coverBlob = dec.decode(coverEpub);
check('cover file is included', coverBlob.includes('OEBPS/cover.jpg'), true);
check('cover manifest item is included', coverBlob.includes('id="cover-image" href="cover.jpg" media-type="image/jpeg"'), true);
check('cover metadata is included', coverBlob.includes('<meta name="cover" content="cover-image"/>'), true);

// Write a real file for `unzip` validation.
const fs = require('fs');
const os = require('os');
const path = require('path');
const out = path.join(os.tmpdir(), 'cex-test.epub');
fs.writeFileSync(out, Buffer.from(epub));
console.log(`\nwrote ${out} (${epub.length} bytes)`);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
