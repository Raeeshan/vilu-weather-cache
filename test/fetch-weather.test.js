// Run: node test/fetch-weather.test.js
//
// Static/unit checks for scripts/fetch-weather.js. Never calls the real
// WeatherAPI (no network, no key needed) -- extracts and unit-tests the
// pure to24Hour() helper via vm, and statically verifies the security
// properties that matter most: the key is never logged, never written to
// the output object, and no response body/error text is ever echoed
// verbatim (which could otherwise leak the request URL containing the key).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'scripts', 'fetch-weather.js'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + String(e.message).split('\n').join('\n        ')); process.exitCode = 1; }
}
function section(t) { console.log(`\n# ${t}`); }

// ---------------------------------------------------------------------------
section('to24Hour() -- pure time-format conversion');

function loadTo24Hour() {
  const start = SCRIPT.indexOf('function to24Hour');
  const end = SCRIPT.indexOf('\n}', start) + 2;
  const code = SCRIPT.slice(start, end);
  const ctx = vm.createContext({});
  vm.runInContext(code + ';__out = to24Hour;', ctx);
  return ctx.__out;
}
const to24Hour = loadTo24Hour();

test('"06:02 AM" -> "06:02"', () => assert.equal(to24Hour('06:02 AM'), '06:02'));
test('"06:14 PM" -> "18:14"', () => assert.equal(to24Hour('06:14 PM'), '18:14'));
test('"12:00 AM" (midnight) -> "00:00"', () => assert.equal(to24Hour('12:00 AM'), '00:00'));
test('"12:00 PM" (noon) -> "12:00"', () => assert.equal(to24Hour('12:00 PM'), '12:00'));
test('malformed input never throws, returns null', () => {
  assert.equal(to24Hour('not a time'), null);
  assert.equal(to24Hour(undefined), null);
  assert.equal(to24Hour(null), null);
  assert.equal(to24Hour(123), null);
});

// ---------------------------------------------------------------------------
section('Security properties (static source checks)');

test('reads the key only from process.env.WEATHERAPI_KEY, never a hardcoded literal', () => {
  assert.ok(SCRIPT.includes('process.env.WEATHERAPI_KEY'));
  assert.ok(!/WEATHERAPI_KEY\s*=\s*['"][A-Za-z0-9]{10,}['"]/.test(SCRIPT), 'must not contain a hardcoded literal key assignment');
});
test('the persisted output object never includes a key/secret field', () => {
  const outMatch = SCRIPT.match(/const out = \{[\s\S]*?\n\s*\};/);
  assert.ok(outMatch, 'could not find the persisted output object literal');
  assert.ok(!/\bkey\b\s*:/i.test(outMatch[0]), 'output object must never include a "key" field');
});
test('fail() and the catch-all handler never interpolate a caught error\'s message (which could contain the request URL/key)', () => {
  // Every catch block must pass a fixed string literal to fail(), never `e.message`/`e.stack`/`e` itself.
  const catchBlocks = SCRIPT.match(/catch\s*\([^)]*\)\s*\{[^}]*\}/g) || [];
  assert.ok(catchBlocks.length > 0, 'expected at least one catch block');
  for (const block of catchBlocks) {
    assert.ok(!/fail\([^)]*\be\.(message|stack)\b/.test(block) && !/fail\(\s*e\s*\)/.test(block), `a catch block passes the raw error to fail(): ${block}`);
  }
});
test('output is written with fs.writeFileSync only after an explicit self-check that the serialized JSON excludes the key and the provider URL', () => {
  assert.ok(SCRIPT.includes("serialized.includes(key)"), 'must self-check the key is not present before writing');
  assert.ok(SCRIPT.includes("serialized.includes('api.weatherapi.com')"), 'must self-check the provider URL is not present before writing');
  const selfCheckIndex = SCRIPT.indexOf('serialized.includes(key)');
  const writeIndex = SCRIPT.indexOf('fs.writeFileSync');
  assert.ok(selfCheckIndex > 0 && writeIndex > selfCheckIndex, 'the self-check must run before the file write');
});
test('the final console.log on success prints only the location name, never the key or the request URL', () => {
  const logMatch = SCRIPT.match(/console\.log\('fetch-weather: wrote[^;]*;/);
  assert.ok(logMatch, 'could not find the success log line');
  assert.ok(!logMatch[0].includes('key'), 'success log must not reference the key variable');
  assert.ok(!logMatch[0].includes('url'), 'success log must not reference the request url variable');
});

// ---------------------------------------------------------------------------
section('Location verification (Maamigili / Maldives resolution requirement)');

test('refuses to publish when the resolved location does not mention Maldives', () => {
  assert.ok(SCRIPT.includes("region.includes('maldives')"), 'must check the resolved location string for "maldives"');
  assert.ok(SCRIPT.indexOf("region.includes('maldives')") < SCRIPT.indexOf('fs.writeFileSync'), 'the location check must run before any file write');
});
test('uses the sourced Maamigili coordinates, not a text place-name query (avoids ambiguous resolution)', () => {
  assert.ok(SCRIPT.includes("'3.475,72.8375'"), 'must query by the sourced lat,lon coordinates');
});

console.log(`\n${passed}/${passed + failed} fetch-weather assertions passed${failed ? ` — ${failed} FAILED` : ''}`);
