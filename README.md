# vilu-weather-cache

A small, dedicated, zero-cost automation that keeps one JSON file
(`weather-cache.json`) refreshed with real Maamigili (South Ari Atoll,
Maldives) weather, for the "Destination Now" component on
[viluresidence.net](https://viluresidence.net/). It exists only to keep
that automation fully separate from the main
[vilu-residence](https://github.com/Raeeshan/vilu-residence) application
repository and its `main` branch, which this repo never touches.

## How it works

```
WeatherAPI.com (free tier)
    → scheduled GitHub Action, every ~20 minutes (scripts/fetch-weather.js)
    → weather-cache.json, committed to this repo's main branch
    → fetched directly by viluresidence.net from GitHub's public raw-content CDN
```

No server, no paid infrastructure, no database. Cost: **$0/month**.
`WEATHERAPI_KEY` is stored only as a GitHub Actions repository secret
(Settings → Secrets and variables → Actions) — never committed, logged,
or written into `weather-cache.json`.

## Public cache URL

```
https://raw.githubusercontent.com/Raeeshan/vilu-weather-cache/main/weather-cache.json
```

## Cache file contract

`weather-cache.json` contains only normalized, public-safe fields — no
key, no request URL, no account/billing information:

```json
{
  "updated_at": "2026-09-06T14:20:00.000Z",
  "location": "Maamigili, Alif Dhaal Atoll, Maldives",
  "temperature_c": 29.4,
  "condition": { "code": 1003, "text": "Partly cloudy" },
  "is_day": 1,
  "sunrise": "06:02",
  "sunset": "18:14",
  "forecast": [
    { "date": "2026-09-06", "max_c": 30, "min_c": 26, "condition": { "code": 1000, "text": "Sunny" } },
    { "date": "2026-09-07", "max_c": 29, "min_c": 26, "condition": { "code": 1003, "text": "Partly cloudy" } },
    { "date": "2026-09-08", "max_c": 28, "min_c": 25, "condition": { "code": 1063, "text": "Patchy rain possible" } }
  ]
}
```

## Failure behavior

`scripts/fetch-weather.js` exits non-zero (visible as a failed run in
this repo's Actions tab) without ever writing an incomplete or fake
record if the provider call fails, times out, returns malformed data, or
resolves to a location outside the Maldives. When that happens the
previously-published `weather-cache.json` is simply left in place; the
production frontend has its own ~90-minute staleness check and shows an
honest "Live conditions temporarily unavailable" message rather than
serving very old data as if it were current.

## Tests

`node test/fetch-weather.test.js` — static/unit checks (no network, no
key needed): time-format conversion, key non-exposure, the pre-write
self-check, and the Maldives location-verification requirement.

## Manual run

Actions tab → "Weather cache refresh" → "Run workflow" — useful for
testing without waiting for the 20-minute schedule.

## Setup

1. Add a free WeatherAPI.com account key as the repository secret
   `WEATHERAPI_KEY` (Settings → Secrets and variables → Actions → New
   repository secret).
2. Run the workflow once manually to confirm it succeeds.
