# SuriaHaze — air quality + solar haze loss

An IQAir-style air quality app for Malaysian townships, with one extra feature: it
calculates how much rooftop solar power the haze is costing each home, and plans
the battery and household chores around it.

Built for the Sime Darby Property University Hackathon 2026 (*Township of Tomorrow*, Planet pillar:
energy efficiency + climate resilience; People pillar: healthier, safer lives).

## What's inside

| Page | What it shows |
|---|---|
| **Air quality** | **Official DOE Air Pollutant Index** from the nearest station, its past 24 hours, DOE health advice, haze level, model forecast (24-hour and 5-day), pollutant estimates, today's/tomorrow's solar haze loss |
| **Solar haze loss** | Hour-by-hour sunlight with vs without haze, % and kWh lost, day picker (past ~85 days replay real data, next 4 days forecast), satellite reality check for past days, battery & chores plan, editable home settings |
| **Rankings** | Sime Darby townships or cities ranked by official API or tomorrow's solar loss, all DOE stations ranked, plus township-wide MWh / RM / CO₂ impact |
| **How it works** | The method, which model is live, data sources, honest limits |

No API keys or paid services. Data sources:

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

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # core model tests
```

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

## Project layout

```
src/lib/solar.js      sun position, clear sky, panel output (physics)
src/lib/model.js      physics baseline, tree evaluator, haze-loss (run A vs run B)
src/lib/battery.js    battery & chores planner
src/lib/api.js        Open-Meteo calls, data shaping
src/lib/demo.js       offline simulated haze week
src/lib/doe.js        official DOE readings: parsing, bands, nearest station
api/doe.js            Vercel server function that fetches the DOE feed
src/components/       pages and SVG charts
training/             Colab notebook + training script
tests/                core tests + JS/Python parity test
```
