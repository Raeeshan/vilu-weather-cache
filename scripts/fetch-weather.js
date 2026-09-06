#!/usr/bin/env node
// vilu-weather-cache — zero-cost weather refresh for viluresidence.net's
// Live Destination Experience component (Phase 20).
//
// Run on a schedule by .github/workflows/weather-cache.yml (every ~20
// minutes, well inside WeatherAPI.com's documented 60-minute current-
// conditions cache limit). Calls WeatherAPI.com's free tier once, writes
// the result to weather-cache.json on this repo's own default branch.
// The production site (viluresidence.net, a separate repository) fetches
// this file directly from GitHub's public raw-content CDN -- this repo
// never touches vilu-residence's origin/main, never deploys anything,
// and contains nothing but this one automation.
//
// WEATHERAPI_KEY is read from the environment (a GitHub Actions
// repository secret) and is never written to weather-cache.json, never
// logged, never included in any error message this script produces.
//
// On any failure, this script exits non-zero WITHOUT touching the
// existing weather-cache.json -- the workflow step that would commit it
// simply never runs, so a previously-published valid cache is preserved
// and the production frontend's own staleness check (>90 min) is what
// eventually shows the honest "unavailable" state, never this script
// publishing a partial or fake record.

const fs = require('fs');
const path = require('path');

const MAAMIGILI_QUERY = '3.475,72.8375'; // Maamigili, Alif Dhaal Atoll -- sourced coordinates
const FORECAST_DAYS = 3; // Free-tier limit. Do not raise without a paid-plan decision.
const OUTPUT_FILE = path.join(__dirname, '..', 'weather-cache.json');

function fail(message) {
  // Never interpolate raw provider error bodies or the key itself here --
  // only fixed, safe strings and HTTP status codes.
  console.error('fetch-weather: ' + message);
  process.exit(1);
}

async function main() {
  const key = process.env.WEATHERAPI_KEY;
  if (!key) fail('WEATHERAPI_KEY secret is not set -- refusing to run with no key.');

  const url = 'https://api.weatherapi.com/v1/forecast.json?key=' + encodeURIComponent(key) +
    '&q=' + encodeURIComponent(MAAMIGILI_QUERY) + '&days=' + FORECAST_DAYS + '&aqi=no&alerts=no';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    fail('network error or timeout calling the weather provider.'); // never log e.message: could echo the request URL/key on some Node versions' error text
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    // Free-plan overage/suspension surfaces here as 401/403/429 -- never
    // billed on the pure free plan; treated as an ordinary failure.
    fail('weather provider returned HTTP ' + res.status + ' ' + res.statusText);
  }

  let json;
  try {
    json = await res.json();
  } catch (e) {
    fail('weather provider response was not valid JSON.');
  }

  if (!json || !json.current || !json.location || !json.forecast || !Array.isArray(json.forecast.forecastday)) {
    fail('weather provider response is missing expected fields.');
  }
  if (json.forecast.forecastday.length < 1) {
    fail('weather provider response has zero forecast days.');
  }

  // Sanity-check the resolved location is genuinely Maamigili/Maldives,
  // not a mis-resolved query -- required verification before this data
  // is ever trusted in production.
  const region = ((json.location.country || '') + ' ' + (json.location.region || '') + ' ' + (json.location.name || '')).toLowerCase();
  if (!region.includes('maldives')) {
    fail('resolved location does not appear to be in the Maldives -- refusing to publish possibly-wrong data.');
  }

  const today = json.forecast.forecastday[0];
  const sunrise = today.astro ? to24Hour(today.astro.sunrise) : null;
  const sunset = today.astro ? to24Hour(today.astro.sunset) : null;
  const tempC = typeof json.current.temp_c === 'number' ? json.current.temp_c : null;
  const conditionCode = json.current.condition && typeof json.current.condition.code === 'number' ? json.current.condition.code : null;

  if (tempC === null || conditionCode === null || !sunrise || !sunset) {
    fail('normalized fields incomplete -- refusing to publish an incomplete record.');
  }

  const forecast = json.forecast.forecastday.slice(0, FORECAST_DAYS).map(function (d) {
    return {
      date: d.date || null,
      max_c: d.day && typeof d.day.maxtemp_c === 'number' ? d.day.maxtemp_c : null,
      min_c: d.day && typeof d.day.mintemp_c === 'number' ? d.day.mintemp_c : null,
      condition: {
        code: d.day && d.day.condition && typeof d.day.condition.code === 'number' ? d.day.condition.code : null,
        text: (d.day && d.day.condition && d.day.condition.text) || null
      }
    };
  });
  for (const d of forecast) {
    if (d.max_c === null || d.min_c === null || d.condition.code === null) {
      fail('a forecast day is missing required fields -- refusing to publish an incomplete record.');
    }
  }

  const out = {
    updated_at: new Date().toISOString(),
    location: [json.location.name, json.location.region, json.location.country].filter(Boolean).join(', '),
    temperature_c: tempC,
    condition: { code: conditionCode, text: json.current.condition.text || null },
    is_day: json.current.is_day === 1 ? 1 : 0,
    sunrise: sunrise,
    sunset: sunset,
    forecast: forecast
  };

  // Belt-and-suspenders: refuse to write anything that happens to contain
  // the key itself or the raw provider URL, even though neither is ever
  // assigned into `out` above -- a guard against a future accidental change
  // reintroducing exposure here, not because this can currently happen.
  const serialized = JSON.stringify(out, null, 2) + '\n';
  if (serialized.includes(key) || serialized.includes('api.weatherapi.com')) {
    fail('internal safety check failed: normalized output unexpectedly referenced the key or provider URL.');
  }

  fs.writeFileSync(OUTPUT_FILE, serialized);
  console.log('fetch-weather: wrote ' + OUTPUT_FILE + ' for "' + out.location + '"'); // location name only -- never the key, never the request URL
}

// WeatherAPI astro times are "hh:mm AM/PM" -- converted to 24-hour "HH:MM".
// Returns null (never a guessed/fake time) if the input doesn't match.
function to24Hour(t) {
  if (typeof t !== 'string') return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3].toUpperCase();
  if (ampm === 'AM' && h === 12) h = 0;
  if (ampm === 'PM' && h !== 12) h += 12;
  return String(h).padStart(2, '0') + ':' + min;
}

main().catch(function () { fail('unexpected internal error.'); }); // never log e/e.stack here -- avoid any chance of echoing request internals
