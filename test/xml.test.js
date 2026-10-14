// -----------------------------------------------------------------------------
// The XML parser against tolerant and hostile input.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childOf, decodeEntities, parseXml, textOf } from '../src/fsapi/xml.js';

test('the five entities and numeric references, nothing else', () => {
  assert.equal(
    decodeEntities('Simon &amp; Garfunkel &#233;t&#xE9; &lt;3'),
    'Simon & Garfunkel été <3',
  );
  assert.equal(decodeEntities('&nbsp;&foo; & &#99999999;'), '&nbsp;&foo; & &#99999999;');
  const root = parseXml('<value><c8_array>Rock &amp; Roll</c8_array></value>');
  assert.equal(textOf(root), 'Rock & Roll');
});

test('a DOCTYPE is skipped without expanding its entities', () => {
  const laughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
 <!ENTITY ext SYSTEM "file:///etc/passwd">
]>
<fsapiResponse><status>FS_OK</status><value><c8_array>&lol3;&ext;</c8_array></value></fsapiResponse>`;
  const root = parseXml(laughs);
  assert.equal(textOf(childOf(childOf(root, 'value'), 'c8_array')), '&lol3;&ext;');
});

test('bounded: deep nesting and element floods are refused', () => {
  assert.throws(() => parseXml('<a>'.repeat(100)), /nested too deeply/);
  assert.throws(() => parseXml(`<r>${'<i/>'.repeat(30_000)}</r>`), /too many elements/);
  assert.throws(() => parseXml('just text'), /no XML element/);
  assert.throws(() => parseXml(''), /no XML element/);
});

test('tolerant: a cut answer, a stray closing tag, prefixes, odd attributes', () => {
  const cut = parseXml('<fsapiResponse><status>FS_OK</status><value><c8_array>Hal');
  assert.equal(textOf(childOf(cut, 'status')), 'FS_OK');
  const stray = parseXml('<r><a>1</b></a><c>2</c></r>');
  assert.equal(textOf(childOf(stray, 'c')), '2');
  const prefixed = parseXml(
    '<u:root xmlns:u="urn:x"><u:webfsapi>http://x/fsapi</u:webfsapi></u:root>',
  );
  assert.equal(prefixed.name, 'root');
  assert.equal(textOf(childOf(prefixed, 'webfsapi')), 'http://x/fsapi');
  const item = parseXml('<item __proto__="x" constructor="y" key="1" key="2"/>');
  assert.equal(item.attrs.key, '1');
  assert.equal(Object.getPrototypeOf(item.attrs), null);
  assert.equal(item.attrs['__proto__'], 'x', 'a plain key, not a prototype');
  assert.equal(textOf(parseXml('<a><![CDATA[<b>&amp;</b>]]></a>')), '<b>&amp;</b>');
});
