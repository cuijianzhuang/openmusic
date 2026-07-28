import fs from 'fs';

const src = fs.readFileSync(
  new URL('../../client/src/lib/randomNickname.ts', import.meta.url),
  'utf8',
);
const m = src.match(/const PREFIXES = \[([\s\S]*?)\];/);
if (!m) {
  console.error('PREFIXES not found');
  process.exit(1);
}
const items = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
const dartItems = items
  .map((s) => `  '${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`)
  .join('\n');

const out = `/// Ported from \`client/src/lib/randomNickname.ts\`.
library;

const _nickPrefixes = <String>[
${dartItems}
];

String createRandomNickname() {
  if (_nickPrefixes.isEmpty) return '访客';
  final i = DateTime.now().microsecondsSinceEpoch.abs() % _nickPrefixes.length;
  return _nickPrefixes[i];
}
`;

fs.writeFileSync(new URL('../lib/core/random_nickname.dart', import.meta.url), out);
console.log(`wrote ${items.length} nicknames`);
