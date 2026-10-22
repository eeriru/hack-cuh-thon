import { tr } from '../lib/i18n.js';
import { HowFlow, More } from './Friendly.jsx';

// One step of the method: an icon and a one-line summary, with the full explanation folded away.
function Step({ icon, title, short, children }) {
  return (
    <details className="mstep">
      <summary>
        <span className="mstep-icon" aria-hidden="true">{icon}</span>
        <span>
          <b>{tr(title)}</b>
          <small>{tr(short)}</small>
        </span>
        <span className="more-chev" aria-hidden="true">⌄</span>
      </summary>
      <div className="mstep-body">{children}</div>
    </details>
  );
}

const P = ({ t, vars }) => <p>{tr(t, vars)}</p>;

export default function MethodPage({ engine }) {
  const trained = engine?.kind === 'trained';
  return (
    <>
      <div className="place-title">
        <h1>{tr('How it works')}</h1>
      </div>

      <div className="card section">
        <HowFlow />
      </div>

      <div className="card section model-card" style={{ borderColor: trained ? 'var(--good)' : 'var(--sun)' }}>
        <span className="mstep-icon" aria-hidden="true">{trained ? '🧠' : '📐'}</span>
        <div>
          <div className="small muted">{tr('Model in use:')}</div>
          <b>{engine ? tr(engine.label) : tr('loading…')}</b>
          {trained && engine.trainedOn?.synthetic && (
            <div className="banner">{tr('This model.json was trained on SIMULATED self-test data. Retrain on real data before the pitch.')}</div>
          )}
          {trained && engine.metrics && (
            <div className="small muted">
              {tr('Held-out test (haze period {period}): error {a} with haze inputs vs {b} without (clear-sky index, mean absolute error).', {
                period: engine.metrics.test_period,
                a: engine.metrics.mae_with_haze?.toFixed(3),
                b: engine.metrics.mae_without_haze?.toFixed(3),
              })}
            </div>
          )}
        </div>
      </div>

      <h2 className="section-title">{tr('Tap a step to learn more')}</h2>
      <div className="mstep-grid">
        <Step icon="🌞" title="Maximum possible sunlight (physics)" short="Sun position → clear-sky sunlight">
          <P t="For every hour, the sun's position is calculated from the date, time and location (NOAA solar equations). The Haurwitz clear-sky formula turns that into the sunlight a perfectly clear sky would deliver. Near noon in Selangor that is around 950 W/m²." />
        </Step>
        <Step icon="🧠" title="How much gets through (AI)" short="Haze + clouds → share of sunlight left">
          <P t="The model predicts a ratio rather than raw sunlight, which leaves it only the messy part to learn:" />
          <div className="formula">{tr('clear-sky index = actual sunlight ÷ clear-sky sunlight')}</div>
          <P t="Inputs: aerosol optical depth and PM2.5 (haze), low/mid/high cloud cover, humidity, temperature and the sun's angle. Training target: sunlight measured by Japan's Himawari satellite over Malaysia, divided by the clear-sky value." />
          {trained ? (
            <P
              t="Trained on {rows} daylight hours from {places} ({start} to {end})."
              vars={{
                rows: engine.trainedOn?.rows?.toLocaleString() ?? '?',
                places: engine.trainedOn?.locations?.join(', ') ?? tr('Malaysian locations'),
                start: engine.trainedOn?.start,
                end: engine.trainedOn?.end,
              }}
            />
          ) : (
            <P t="No trained model is deployed yet, so the app uses a physics baseline (Beer–Lambert haze attenuation with diffuse-light recovery, and the Kasten–Czeplak cloud formula). Run training/train_solar_haze_model.py in Google Colab and put the resulting model.json in public/ to switch to the trained model automatically." />
          )}
        </Step>
        <Step icon="⚡" title="Sunlight to electricity" short="Panel size, heat & inverter losses">
          <P t="Predicted sunlight × system size, minus about 0.4% per °C the panels run above 25 °C (cell temperature from air temperature and sunlight) and 14% for inverter, wiring and dirt." />
        </Step>
        <Step icon="🌫️" title="Isolating the haze (the key idea)" short="Run twice: real haze vs normal haze">
          <P t="The model runs twice for the same hours, with identical clouds and weather:" />
          <div className="formula">
            {tr('Run A: real haze forecast')}&nbsp;&nbsp;·&nbsp;&nbsp;
            {tr('Run B: haze set to a normal level (AOD {aod}, PM2.5 {pm})', { aod: engine?.reference?.aod ?? 0.3, pm: engine?.reference?.pm2_5 ?? 15 })}
            <br />
            {tr('Solar lost to haze = Run B − Run A')}
          </div>
          <P t="That separates smoke from ordinary cloudiness, so a rainy afternoon is never blamed on haze." />
        </Step>
        <Step icon="📉" title="Where the solar goes (full loss breakdown)" short="Ideal → each loss → your output">
          <P t="Each day's output is traced from the ideal down to the forecast, step by step, so the steps always add up:" />
          <div className="formula">
            {tr('Ideal (perfect, cool panel, clear sky) − inverter & wiring (~14%) − heat (0.4% per °C above 25 °C) − clouds & rain − haze − dust on panels = what your panels make')}
          </div>
          <P t="Dust is an estimate: about 1% after rain, plus ~0.4% per dry day and 0.5% on smoky days, up to 6%. Rain washes the panels clean, so the app counts dry days since the last rain of 2 mm or more." />
        </Step>
        <Step icon="🌦️" title="Weather forecast and calculations" short="7 days: heat, rain, UV, wind">
          <P t="7-day forecast (temperature, rain amount and chance, wind, UV, sunshine) from Open-Meteo's weather models. The app calculates the heat index (NOAA), dew point (Magnus formula), heat-stress warnings, UV and rain levels, and the solar output for each forecast day." />
        </Step>
        <Step icon="🔋" title="Battery and chores plan" short="Cheapest time for chores & battery">
          <P t="The day is replayed hour by hour with the predicted solar output. The planner tries every combination of three levers (when to run chores, whether to save the battery for the 2pm–10pm peak, and whether to top up from the grid overnight) and keeps the cheapest, so it never does worse than a normal day." />
        </Step>
        <Step icon="🚗" title="EV charging planner" short="Spare solar first, then cheap hours">
          <P t="Daily driving × the car's energy use gives the charge needed. Solar the house and battery can't use goes to the car first; the rest comes from the grid at the cheapest hours the car is plugged in. This is compared with plugging in as soon as you get home." />
        </Step>
        <Step icon="🧽" title="Panel cleaning reminder" short="Wash now, or let the rain do it">
          <P t="Uses the same dust estimate as the loss breakdown. It compares the week's output if the panels stay dusty with washing them today, and says to wait when rain in the next two days will wash them for free." />
        </Step>
        <Step icon="🏃" title="Outdoor planner" short="Best 2 hours to be outside">
          <P t="Each coming hour is rated from the air-quality forecast (US AQI), the heat index, UV and rain, with stricter air limits for children, elderly people and asthma. The best two-hour slot of each day is shown." />
        </Step>
        <Step icon="🔥" title="Haze source map" short="Fires upwind of you">
          <P t="Fire hotspots from NASA's VIIRS satellites (last 2 days) are compared with the wind direction. Fires inside a 70° wedge pointing upwind, within 1,500 km, are the likely sources; they are grouped by region (e.g. Riau, Jambi, Central Kalimantan). Wind near the ground is a rough guide: smoke also travels higher up." />
        </Step>
        <Step icon="🏘️" title="Township impact board" short="Your township's solar, in RM & CO₂">
          <P t="Tomorrow's forecast output for one home is multiplied by the number of solar homes in each township, then turned into money saved (your tariff), CO₂ avoided (grid factor) and simple comparisons (trees, car kilometres)." />
        </Step>
      </div>

      <More title="Data sources (all free)" hint="IQAir · DOE · Open-Meteo · Himawari · NASA FIRMS">
        <div className="card">
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>{tr('Current air quality (headline number): IQAir, US AQI for the nearest IQAir city, the same number as iqair.com')}</li>
            <li>{tr("Official reference and past 24 hours: Air Pollutant Index (API) from the Department of Environment's MyEQMS hourly feed, nearest station to the chosen place")}</li>
            <li>{tr('Haze (aerosol optical depth), pollutant estimates and air-quality forecasts: Open-Meteo Air Quality API (Copernicus CAMS)')}</li>
            <li>{tr('Weather, clouds, rain, UV and the 7-day forecast: Open-Meteo Forecast API')}</li>
            <li>{tr('Measured sunlight: Open-Meteo Satellite Radiation API (JMA/JAXA Himawari)')}</li>
            <li>{tr('Fire hotspots: NASA FIRMS (VIIRS satellites)')}</li>
            <li>{tr('Place search: Open-Meteo Geocoding API')}</li>
          </ul>
          <p className="small muted">
            {tr(
              "The headline number comes from IQAir, so it matches the IQAir app. The DOE's official API is shown next to it; the two differ because they use different scales (US AQI vs Malaysian API) and IQAir adds its own sensors. The DOE does not publish forecasts or haze depth, so forecasts and the solar model use Copernicus model data, shown on the US AQI scale and labelled as model estimates."
            )}
          </p>
        </div>
      </More>

      <More title="Honest limits" hint="What the model can't see">
        <div className="card">
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>{tr('Haze and cloud data come from ~11–45 km grids, not your street.')}</li>
            <li>{tr('Household demand is simulated; there is no public Malaysian smart-meter data.')}</li>
            <li>{tr('Rooftop output is estimated from satellite sunlight. A pilot with real inverter data from township homes would calibrate it.')}</li>
            <li>{tr('Tariff and grid-emission figures are example values you can edit.')}</li>
            <li>{tr('The haze source map uses wind near the ground; real smoke paths depend on winds higher up.')}</li>
          </ul>
        </div>
      </More>
    </>
  );
}
