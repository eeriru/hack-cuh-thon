// Plain-language explanations for the terms the app uses. Shown in the ⓘ tips.

export const GLOSSARY = {
  usAqi:
    'US AQI is the air-quality scale IQAir uses. 0–50 is good, 51–100 moderate, 101–150 unhealthy for sensitive people (children, elderly, asthma), 151+ unhealthy for everyone.',
  doeApi:
    "API (Air Pollutant Index) is Malaysia's official scale from the Department of Environment, the number you hear on the news. 0–50 good, 51–100 moderate, 101–200 unhealthy, 201–300 very unhealthy, above 300 hazardous.",
  twoScales:
    'IQAir and the DOE use different scales and different sensors, so their numbers are not the same even when the air is. Look at the colour and the word (Good, Unhealthy…), not just the number.',
  pm25: 'PM2.5 are tiny smoke and dust particles, small enough to get deep into your lungs. They are the main thing in haze.',
  aod:
    'Haze thickness (aerosol optical depth, AOD) measures how much smoke is in the whole sky. Under 0.4 is clear, 0.4–0.8 light haze, 0.8–1.5 thick haze, above 1.5 severe.',
  kwh: '1 kWh is 1 unit on your TNB electricity bill. A typical terrace house uses about 15–25 kWh a day.',
  kwp: 'kWp (kilowatt-peak) is the size of a solar system. A 5 kWp system has roughly 12 panels and makes about 15–25 kWh on a normal Malaysian day.',
  ideal: 'What the panels would make on a perfectly clear day with cool panels and no losses. Real panels never reach it; 60–75% of ideal is a good day.',
  heatIndex: 'How hot it feels in the shade once humidity is counted. Sweat evaporates less in humid air, so your body cools down less.',
  feelsLike: 'How hot it feels, combining temperature, humidity and wind.',
  dewPoint: 'The temperature at which the air would be saturated. Above about 24°C the air feels sticky and muggy.',
  uv: 'UV index: strength of the sun on your skin. 3–5 moderate, 6–7 high, 8–10 very high, 11+ extreme. Malaysia often reaches 10+ at midday.',
  rainChance: 'The chance that it rains at all during that time, not how much.',
  hazeLoss:
    'Compared with the same day without haze: same clouds, same heat, only the smoke removed. So it shows exactly what the haze costs you.',
  dust: 'Dust and smoke settle on the panels and block light. Rain washes them clean, so dust builds up on dry days. This is an estimate.',
  heat: 'Solar panels work less well when hot: about 0.4% less power for every °C above 25 °C. On a Malaysian rooftop panels often reach 55–65 °C.',
  battery: 'The plan moves chores like laundry to the sunniest hours and keeps battery power for the evening, when electricity is more expensive.',
};
