# SuriaMF — solar, weather & energy planner

A solar, weather and energy planner for Malaysian homes. It forecasts how much rooftop solar a
home will make (and what clouds, rain, heat, haze and dust take away), shows the air quality and
weather, and plans how to use the solar: spare solar, the battery, chores and EV charging.

**Live demo:** [suriamf.vercel.app](https://suriamf.vercel.app)

Built for the Sime Darby Property University Hackathon 2026 (*Township of Tomorrow*, Planet pillar:
energy efficiency + climate resilience; People pillar: healthier, safer lives).

> **Status: working prototype.** The main features below work today. SuriaMF gives advice; the
> owner acts on it (runs chores, sets the car's timer, sets the battery). It does not yet control
> any inverter, battery or charger.

## What's inside

Four pages, in English or Bahasa Melayu.

| Page | What it shows |
|---|---|
| **Air quality** | IQAir US AQI and the official DOE Air Pollutant Index side by side, health advice, the past 24 hours, a 3D view of the sky with today's weather, and a **haze source map** (NASA fire hotspots upwind of you) |
| **Weather & solar** | Weather now (temperature, feels-like, heat index, UV, wind, rain, cloud) and heat warnings; tomorrow at a glance; the next 24 hours of weather and solar; **where the solar goes** (ideal → inverter & wiring → heat → clouds & rain → haze → dust → output); a 3D view where you can try different weather and haze levels |
| **Planner** | Asks for your home details on the first visit. Then: one-glance tiles (spare solar, battery & chores savings, EV savings), a 7-day solar picker, **spare solar** (how much, the best hours, which appliances it could run), **ideas for the day**, the **battery & chores plan** (a normal day next to the cheapest day) and the **EV charging planner** |
| **How it works** | The method, which model is live and how it tested, data sources, honest limits |

The **EN / BM** switch in the top bar changes the whole app to Bahasa Melayu (remembered in the
browser). Translations live in `src/lib/i18n-ms.js`; any text without a translation falls back to English.

## How the Planner works

### Home settings

Set on the first visit to the Planner (or keep the example values) and remembered in the browser.

| Setting | Default |
|---|---|
| Solar size | 5 kWp |
| Daily household use | 22 kWh (plus 3 kWh of flexible chores over 2 hours) |
| Battery | 7.5 kWh, 92% efficient; charges at half its size per hour (min 2.5 kW); starts each day at 20% |
| Tariff | Flat RM 0.40/kWh. Optional time-of-use: RM 0.45 peak (2pm–10pm, weekdays), RM 0.30 off-peak; weekends off-peak all day |
| Grid emissions | 0.7 kg CO₂ per kWh |
| EV (optional) | 40 km a day, 15 kWh/100 km, 7 kW wall charger, leaves 8am, home 6pm, 90% charging efficiency |

All values are editable examples. Check your own bill for the rates.

### Spare solar, hour by hour

1. **Solar output** = system size × (sunlight ÷ 1000) × heat factor × 0.86 (inverter, wiring) × (1 − dust).
   Heat factor = 1 − 0.004 × (panel temperature − 25 °C).
2. **Home use** = daily use × that hour's share of a typical Malaysian terrace-home day. Daytime use
   rises by up to 30% on haze days (aircon, purifiers). Planned chores are added in their hours.
3. **Surplus** = solar − home use. The **battery** takes what it can first.
4. **Spare solar** = what the house and battery can't use (otherwise exported to the grid).
   If an EV is set up, its solar charging comes off first, and the Planner shows what is left.

### Battery & chores plan (`src/lib/battery.js`)

Replays the day hour by hour and tries every combination of three levers, keeping the cheapest:
chore timing (sunniest hours, usual evening, or after the peak), keeping the battery for the peak
window, and an overnight off-peak top-up when haze means the battery won't fill. The last two only
apply on a time-of-use tariff. It can never do worse than the normal day.

### EV charging planner (`src/lib/ev.js`)

Charge needed = km per day × kWh per 100 km ÷ 0.9. The car takes spare solar first (only while
it's parked at home), then the cheapest grid hours while plugged in. Among equally cheap hours it
charges in one block that ends just before the car leaves. This is compared with plugging in as
soon as you get home.

Order of use: **home → battery → car → grid**. The battery powers the home; it is not used to charge the car.

## Data sources (all free)

- **Headline air quality: IQAir** (US AQI for the nearest IQAir city, the same number as iqair.com
  and the IQAir app). Needs a free IQAir API key — see *Connect IQAir* below. Without a key the app
  shows the DOE reading as the headline instead.
- **Official air quality:** the Department of Environment's Air Pollutant Index, from the public
  MyEQMS hourly feed (`https://eqms.doe.gov.my/api3/publicportalapims/apitablehourly`). The DOE
  server doesn't allow browsers on other sites to call it, so `api/doe.js` is a small Vercel server
  function that fetches it and caches it for 10 minutes (`/api/doe`). Locally, `vite.config.js` proxies
  the same path. If the feed is down, the app says so.
- **Haze, pollutant estimates, weather, sunlight and the 7-day forecast:** free
  [Open-Meteo](https://open-meteo.com) APIs (Copernicus CAMS, Himawari satellite sunlight), called
  from the browser. These are labelled as model estimates. If the network fails during a demo, the
  app switches to a clearly labelled simulated haze week.
- **Fire hotspots:** NASA FIRMS (VIIRS satellites).
- **Place search:** Open-Meteo Geocoding and IQAir's city directory.

## Deploy to Vercel (free)

1. Push this folder to a GitHub repo.
2. On vercel.com → **Add New → Project** → import the repo. Vercel detects Vite; keep the defaults
   (build `npm run build`, output `dist`).
3. Click **Deploy**. Done.

Or from a terminal: `npm i -g vercel && vercel`.

## Location search

Type a town (any country) to search by name, or type a **country** (e.g. "Indonesia", "Singapura",
"Thailand") to browse it region by region, then city by city — the same directory IQAir uses
(`api/places.js`, cached for a day). If the IQAir directory is unavailable, major Southeast Asian
cities are listed from a built-in list instead.

## Connect IQAir (free, 5 minutes)

1. Sign up at [dashboard.iqair.com](https://dashboard.iqair.com) and create an API key on the free
   **Community** plan. (If self-sign-up isn't offered, request it from the
   [IQAir API page](https://www.iqair.com/air-pollution-data-api).)
2. In Vercel: **Project → Settings → Environment Variables** → add `IQAIR_API_KEY` = your key → **Redeploy**.
3. Locally: create `.env.local` containing `IQAIR_API_KEY=your-key` (it's git-ignored, never commit it).

The key stays on the server (`api/iqair.js`); the browser never sees it. The free plan allows 5 calls a
minute and 500 a day, so answers are cached for 15 minutes per location (30 minutes in the browser).
Check IQAir's terms of use for the Community plan and keep the "Air quality: IQAir" credit in the footer.

## Connect NASA FIRMS for the haze source map (free, 2 minutes)

1. Get a free MAP_KEY at [firms.modaps.eosdis.nasa.gov/api/map_key](https://firms.modaps.eosdis.nasa.gov/api/map_key/) (just an email address).
2. In Vercel: **Project → Settings → Environment Variables** → add `FIRMS_MAP_KEY` = your key → **Redeploy**.
3. Locally: add `FIRMS_MAP_KEY=your-key` to `.env.local`.

`api/fires.js` fetches VIIRS fire hotspots for Sumatra, Borneo and the peninsula (last 2 days) and
caches them for an hour. Without a key the map still shows the wind direction and says the key is missing.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # core model tests (33 tests)
```

## Made to be easy to read

- Every main page starts with **In short**: two to four plain sentences (what's happening, what to do, what's coming).
- Tap any **ⓘ** for a plain-language explanation of a term (AQI vs API, kWh, kWp, haze thickness, heat index…). Texts live in `src/lib/glossary.js`.
- Detail most people don't need (hour-by-hour charts, formulas) is folded away under "More" sections.
- First-time visitors get a short welcome card (dismissed once, remembered in the browser).
- The summary sentences are generated in `src/lib/summary.js` and covered by tests.

## Weather calculations (`src/lib/weather.js`)

- Heat index: NOAA (Rothfusz) from temperature and humidity; heat-stress bands from NOAA.
- Dew point: Magnus formula. UV: WHO categories. Rain: daily totals (light < 10 mm, heavy ≥ 30 mm).

## Solar loss breakdown (`src/lib/losses.js`)

Each step is the difference between two full model runs, so the steps add up exactly and the haze
step equals the haze figure shown everywhere else:

ideal (perfect, cool panel, clear sky) − inverter & wiring (~14%) − heat (−0.4%/°C above 25 °C) −
clouds & rain − haze − dust on panels (estimate: ~1% after rain + 0.4%/dry day + 0.5% on smoky days,
max 6%) = forecast output.

## The model

1. **Physics:** sun position (NOAA equations) → clear-sky sunlight (Haurwitz).
2. **AI:** gradient-boosted trees predict the *clear-sky index* (actual ÷ clear-sky sunlight) from
   haze (AOD, PM2.5), clouds, humidity, temperature and sun angle. Monotonic constraint: more haze
   never means more sunlight.
3. **Panels:** sunlight × system size, with heat, inverter and dust losses.
4. **Haze loss:** run the model twice (real haze vs normal haze); the difference is the loss.
5. **Planner:** uses the hazy forecast to plan spare solar, the battery, chores and EV charging (see above).

**Model in use:** `public/model.json` is a trained model: 126,882 daylight hours of Himawari
satellite sunlight from 8 Malaysian locations (Ipoh, Johor Bahru, Klang, Kuala Lumpur, Kuching,
Melaka, Seremban, Shah Alam), 2023-01-01 to 2026-10-15. Its held-out test results are shown on the
*How it works* page. Without `model.json`, the app falls back to a physics baseline.

### Retrain the model (Google Colab, free)

1. Open `training/SuriaHaze_train_model.ipynb` in Colab → *Runtime → Run all* (~10–20 min).
2. Note the printed test result: error **with** haze inputs vs **without**.
3. Put the downloaded `model.json` in `public/` and redeploy. The app switches automatically.

Check that the browser reproduces Python exactly:

```bash
python3 training/train_solar_haze_model.py --synthetic --out /tmp/model.json --parity /tmp/parity.json
node tests/parity.test.mjs /tmp/model.json /tmp/parity.json
```

(`--synthetic` is an offline self-test only. Never deploy a model trained with it; the app warns if you do.)

## Honest limits

- SuriaMF gives advice only; it does not control inverters, batteries or chargers yet.
- Haze and cloud data are ~11–45 km grids, not street level.
- Household demand is simulated (no public Malaysian smart-meter data).
- Each day is planned on its own: the battery starts every day at 20% and spare solar doesn't carry over.
- Rooftop output is estimated from satellite sunlight. **Next step:** a pilot with real inverter
  data from township solar homes to calibrate the model.
- Tariff rates and the grid emission factor are editable example values; check current TNB rates.
- Forecasts and pollutant breakdowns are model estimates on the US AQI scale; the DOE reading is the official one.
- The DOE feed is public but undocumented, so its format could change. The app degrades gracefully if it does.
- The haze source map uses wind near the ground; real smoke paths depend on winds higher up.

## Roadmap

1. **Done:** working app with solar forecast, Planner and air quality, in English and BM.
2. **Months 1–3:** pilot with solar homes; compare forecasts with real meter readings and tune the model.
3. **Months 4–9:** link smart meters and inverters so the plan runs on live data; add haze alerts.
4. **Year 1+:** partner with solar installers so every new rooftop gets SuriaMF from day one.

## Project layout

```
src/App.jsx              page tabs, saved settings, location
src/components/          pages, cards and SVG charts
  AirQualityPage.jsx     Air quality page
  ForecastPage.jsx       Weather & solar page
  PlannerPage.jsx        Planner page
  MethodPage.jsx         How it works page
  HomeSetup.jsx          first-visit home details (uses HomeSettings.jsx)
  SolarBudgetCard.jsx    spare solar card
  TipsCard.jsx           ideas for the day
  PlanCard.jsx           battery & chores plan
  EvCard.jsx             EV charging planner
src/lib/solar.js         sun position, clear sky, panel output (physics)
src/lib/model.js         physics baseline, tree evaluator, haze loss (run A vs run B)
src/lib/forecastDays.js  per-day model runs, dust, home settings and the day's plan
src/lib/battery.js       battery & chores planner, home defaults, tariff
src/lib/budget.js        spare solar budget and which appliances fit
src/lib/tips.js          ideas for the day, built from the plan
src/lib/ev.js            EV charging planner
src/lib/losses.js        solar loss breakdown and dust (soiling) estimate
src/lib/weather.js       heat index, dew point, UV / rain / heat levels
src/lib/api.js           Open-Meteo calls, data shaping
src/lib/demo.js          offline simulated haze week
src/lib/doe.js           official DOE readings: parsing, bands, nearest station
src/lib/iqair.js         IQAir reading in the browser
src/lib/aqi.js           US AQI bands and advice
src/lib/fires.js         NASA FIRMS hotspots, upwind regions
src/lib/places.js        default township locations
src/lib/browse.js        country matching, browsing and backup city list
src/lib/summary.js       "In short" sentences
src/lib/glossary.js      ⓘ explanations
src/lib/i18n.js          English / Bahasa Melayu switch (text in i18n-ms.js)
api/doe.js               Vercel server function: DOE feed
api/iqair.js             Vercel server function: IQAir with your secret key
api/places.js            Vercel server function: IQAir's country → region → city directory
api/fires.js             Vercel server function: NASA FIRMS fire hotspots (needs FIRMS_MAP_KEY)
public/model.json        trained solar model
training/                Colab notebook + training script
tests/                   core tests + JS/Python parity test
```

### In the code but not shown in the app yet

These are built but not linked into any page: township impact board (`ImpactBoard.jsx`,
`lib/impact.js`, inside `RankingsPage.jsx`), outdoor activity planner (`OutdoorCard.jsx`,
`lib/outdoor.js`), panel cleaning reminder (`CleaningCard.jsx`, `lib/cleaning.js`), a separate
settings page (`SettingsPage.jsx`), `AirNow.jsx`, and a `?demo` mode (`lib/demoMode.js`).
