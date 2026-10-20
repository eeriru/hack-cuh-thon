export default function MethodPage({ engine }) {
  const trained = engine?.kind === 'trained';
  return (
    <>
      <div className="place-title">
        <h1>How it works</h1>
        <span className="sub">A hybrid physics + machine-learning model</span>
      </div>

      <div className="card section" style={{ borderColor: trained ? 'var(--good)' : 'var(--sun)' }}>
        <div className="spread">
          <div>
            <h2>Model in use: {engine ? engine.label : 'loading…'}</h2>
            {trained && engine.trainedOn?.synthetic && (
              <div className="banner">This model.json was trained on SIMULATED self-test data. Retrain on real data before the pitch.</div>
            )}
            {trained ? (
              <p className="lede" style={{ marginBottom: 0 }}>
                Trained on {engine.trainedOn?.rows?.toLocaleString() ?? '?'} daylight hours from{' '}
                {engine.trainedOn?.locations?.join(', ') ?? 'Malaysian locations'} ({engine.trainedOn?.start} to {engine.trainedOn?.end}).
                {engine.metrics && (
                  <>
                    {' '}Held-out test (haze period {engine.metrics.test_period}): error {engine.metrics.mae_with_haze?.toFixed(3)} with haze inputs vs{' '}
                    {engine.metrics.mae_without_haze?.toFixed(3)} without (clear-sky index, mean absolute error).
                  </>
                )}
              </p>
            ) : (
              <p className="lede" style={{ marginBottom: 0 }}>
                No trained model is deployed yet, so the app uses a physics baseline (Beer–Lambert haze attenuation with diffuse-light
                recovery, and the Kasten–Czeplak cloud formula). Run <code>training/train_solar_haze_model.py</code> in Google Colab and
                put the resulting <code>model.json</code> in <code>public/</code> to switch to the trained model automatically.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="card section">
        <div className="steps">
          <div className="step">
            <div>
              <h3>Maximum possible sunlight (physics)</h3>
              <p>
                For every hour, the sun's position is calculated from the date, time and location (NOAA solar equations). The Haurwitz
                clear-sky formula turns that into the sunlight a perfectly clear sky would deliver. Near noon in Selangor that is around
                950 W/m².
              </p>
            </div>
          </div>
          <div className="step">
            <div>
              <h3>How much gets through (AI)</h3>
              <p>The model predicts a ratio rather than raw sunlight, which leaves it only the messy part to learn:</p>
              <div className="formula">clear-sky index = actual sunlight ÷ clear-sky sunlight</div>
              <p>
                Inputs: aerosol optical depth and PM2.5 (haze), low/mid/high cloud cover, humidity, temperature and the sun's angle.
                Training target: sunlight measured by Japan's Himawari satellite over Malaysia, divided by the clear-sky value.
              </p>
            </div>
          </div>
          <div className="step">
            <div>
              <h3>Sunlight to electricity</h3>
              <p>
                Predicted sunlight × system size, minus about 0.4% per °C the panels run above 25 °C (cell temperature from air
                temperature and sunlight) and 14% for inverter, wiring and dirt.
              </p>
            </div>
          </div>
          <div className="step">
            <div>
              <h3>Isolating the haze (the key idea)</h3>
              <p>The model runs twice for the same hours, with identical clouds and weather:</p>
              <div className="formula">
                Run A: real haze forecast&nbsp;&nbsp;·&nbsp;&nbsp;Run B: haze set to a normal level (AOD {engine?.reference?.aod ?? 0.3}, PM2.5{' '}
                {engine?.reference?.pm2_5 ?? 15})<br />
                Solar lost to haze = Run B − Run A
              </div>
              <p>That separates smoke from ordinary cloudiness, so a rainy afternoon is never blamed on haze.</p>
            </div>
          </div>
          <div className="step">
            <div>
              <h3>Battery and chores plan</h3>
              <p>
                The day is replayed hour by hour with the predicted solar output. The planner tries every combination of three levers
                (when to run chores, whether to save the battery for the 2pm–10pm peak, and whether to top up from the grid overnight)
                and keeps the cheapest, so it never does worse than a normal day.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-2 section">
        <div className="card">
          <h2>Data sources (all free)</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Current air quality (headline number): IQAir, US AQI for the nearest IQAir city, the same number as iqair.com</li>
            <li>
              Official reference and past 24 hours: Air Pollutant Index (API) from the Department of Environment's MyEQMS hourly feed,
              nearest station to the chosen place
            </li>
            <li>Haze (aerosol optical depth), pollutant estimates and air-quality forecasts: Open-Meteo Air Quality API (Copernicus CAMS)</li>
            <li>Weather and clouds: Open-Meteo Forecast API</li>
            <li>Measured sunlight: Open-Meteo Satellite Radiation API (JMA/JAXA Himawari)</li>
            <li>Place search: Open-Meteo Geocoding API</li>
          </ul>
          <p className="small muted">
            The headline number comes from IQAir, so it matches the IQAir app. The DOE's official API is shown next to it; the two
            differ because they use different scales (US AQI vs Malaysian API) and IQAir adds its own sensors. The DOE does not publish
            forecasts or haze depth, so forecasts and the solar model use Copernicus model data, shown on the US AQI scale and
            labelled as model estimates.
          </p>
        </div>
        <div className="card">
          <h2>Honest limits</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Haze and cloud data come from ~11–45 km grids, not your street.</li>
            <li>Household demand is simulated; there is no public Malaysian smart-meter data.</li>
            <li>Rooftop output is estimated from satellite sunlight. A pilot with real inverter data from township homes would calibrate it.</li>
            <li>Tariff and grid-emission figures are example values you can edit.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
