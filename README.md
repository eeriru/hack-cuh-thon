# SuriaHaze — solar & weather assistant

An IQAir-style air quality app for Malaysian townships, with one extra feature: it
calculates how much rooftop solar power the haze is costing each home, and plans
the battery and household chores around it.

Built for the Sime Darby Property University Hackathon 2026 (*Township of Tomorrow*, Planet pillar:
energy efficiency + climate resilience; People pillar: healthier, safer lives).

## What's inside

A solar and weather assistant for Malaysian townships. Haze is one of several factors (with
clouds, heat and dust) that decide how much power a rooftop makes.

| Page | What it shows |
|---|---|
| **Air quality** | IQAir US AQI + official DOE API, DOE health advice, past 24 h, model forecast, a link to the best time to exercise, **haze source map** (NASA fire hotspots upwind of you), 3D haze view, today's/tomorrow's solar output |
| **Weather & solar** | Weather now (temperature, feels-like, heat index, dew point, UV, wind, rain, cloud) and heat warnings; solar output in kWh for the picked day; a 7-day picker with weather and solar per day; next-24-hour chart; **where the solar goes** (ideal → inverter & wiring → heat → clouds & rain → haze → dust → output); hour-by-hour sunlight with/without haze; 3D view |
| **Planner** | One-glance tiles, then **spare solar** (how many kWh are left over after normal home use, the best hours, and which appliances fit), the **battery & chores plan**, **EV charging planner** (cheapest hours, spare solar first), **best time to exercise** (stricter mode for kids/elderly/asthma) and your home settings |
| **Rankings** | Townships/cities by DOE API, IQAir or tomorrow's solar output; all DOE stations; **township impact board** (kWh, RM saved and CO₂ avoided if N homes in each township have solar) |
| **How it works** | The method, which model is live, data sources, honest limits |

The **EN / BM** switch in the top bar changes the whole app to Bahasa Melayu (remembered in the
browser). Translations live in `src/lib/i18n-ms.js`; any text without a translation falls back to English.

No paid services. Data sources:

- **Headline air quality: IQAir** (US AQI for the nearest IQAir city, the same number as iqair.com
  and the IQAir app). Needs a free IQAir API key — see *Connect IQAir* below. Without a key the app
  simply shows the DOE reading as the headline instead.

- **Current air quality:** the Department of Environment's official Air Pollutant Index, from the
  public MyEQMS hourly feed (`https://eqms.doe.gov.my/api3/publicportalapims/apitablehourly`). The DOE
  server doesn't allow browsers on other sites to call it, so `api/doe.js` is a tiny Vercel server
  function that fetches it and caches it for 10 minutes (`/api/doe`). Locally, `vite.config.js` proxies
  the same path. If the feed is down, the app says so and falls back to the model estimate.
- **Forecasts, haze depth, weather, sunlight:** free [Open-Meteo](https://open-meteo.com) APIs, called
  from the browser. The DOE doesn't publish forecasts, so these are labelled as model estimates. If the network fails during a
demo, the app switches to a clearly labelled simulated haze week.

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
minute and 500 a day, so answers are cached for 15 minutes per location. That is plenty for a demo,
but too few to rank many towns at once, which is why the Rankings page uses DOE readings. Check
IQAir's terms of use for the Community plan and keep the "Air quality: IQAir" credit in the footer.

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
npm test           # core model tests
```

## Made to be easy to read

- Every main page starts with **In short**: two to four plain sentences (what's happening, what to do, what's coming).
- Tap any **ⓘ** for a plain-language explanation of a term (AQI vs API, kWh, haze thickness, heat index…). Texts live in `src/lib/glossary.js`.
- Detail most people don't need (hour-by-hour charts, settings, formulas) is folded away under "More" sections.
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
   haze (AOD, PM2.5), clouds, humidity, temperature and sun angle. Trained on Himawari satellite
   sunlight measurements over Malaysia. Monotonic constraint: more haze never means more sunlight.
3. **Panels:** sunlight × system size, with heat and inverter losses.
4. **Haze loss:** run the model twice (real haze vs normal haze), and the difference is the loss.
5. **Planner:** replays the day under a time-of-use tariff and picks the cheapest combination of
   chore timing, battery reserve and overnight top-up.

Until you deploy a trained model, the app uses a **physics baseline** for step 2 (shown on
the *How it works* page).

### Train the real model (Google Colab, free)

1. Open `training/SuriaHaze_train_model.ipynb` in Colab → *Runtime → Run all* (~10–20 min).
2. Note the printed test result: error **with** haze inputs vs **without**. This is your proof slide.
3. Put the downloaded `model.json` in `public/` and redeploy. The app switches automatically.

Check that the browser reproduces Python exactly:

```bash
python3 training/train_solar_haze_model.py --synthetic --out /tmp/model.json --parity /tmp/parity.json
node tests/parity.test.mjs /tmp/model.json /tmp/parity.json
```

(`--synthetic` is an offline self-test only. Never deploy a model trained with it; the app warns if you do.)

## Honest limits (say these in the pitch)

- Haze/cloud data are ~11–45 km grids, not street level.
- Household demand is simulated (no public Malaysian smart-meter data).
- Rooftop output is estimated from satellite sunlight. **Next step:** a pilot with real inverter
  data from Sime Darby solar homes to calibrate the model.
- Tariff rates and the grid emission factor are editable example values; check current TNB rates.
- The headline reading is the official DOE API; forecasts and pollutant breakdowns are model estimates on the US AQI scale.
- The DOE feed is public but undocumented, so its format could change. The app degrades gracefully if it does.
- The haze source map uses wind near the ground; real smoke paths depend on winds higher up.

## Project layout

```
src/lib/solar.js      sun position, clear sky, panel output (physics)
src/lib/model.js      physics baseline, tree evaluator, haze-loss (run A vs run B)
src/lib/battery.js    battery & chores planner
src/lib/api.js        Open-Meteo calls, data shaping
src/lib/demo.js       offline simulated haze week
src/lib/doe.js        official DOE readings: parsing, bands, nearest station
src/lib/weather.js    heat index, dew point, UV / rain / heat levels
src/lib/losses.js     solar loss breakdown and dust (soiling) estimate
src/lib/outdoor.js    outdoor planner (hourly rating, best slot)
src/lib/ev.js         EV charging planner
src/lib/impact.js     township impact board
src/lib/fires.js      NASA FIRMS hotspots, upwind regions
src/lib/i18n.js       English / Bahasa Melayu switch (text in i18n-ms.js)
src/lib/budget.js     spare solar and which appliances fit
src/lib/forecastDays.js  per-day solar model runs and the battery plan, shared by two pages
api/doe.js            Vercel server function that fetches the DOE feed
api/iqair.js          Vercel server function that calls IQAir with your secret key
api/places.js         Vercel server function: IQAir's country → region → city directory
api/fires.js          Vercel server function: NASA FIRMS fire hotspots (needs FIRMS_MAP_KEY)
src/lib/browse.js     country matching, browsing and backup city list
src/lib/iqair.js      IQAir reading in the browser
src/components/       pages and SVG charts
training/             Colab notebook + training script
tests/                core tests + JS/Python parity test
```
