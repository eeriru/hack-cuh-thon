// AI layer: predicts the clear-sky index (share of clear-sky sunlight that actually
// reaches the ground) from haze, cloud and weather. Two interchangeable engines:
//   1. A trained gradient-boosted tree model loaded from /model.json
//      (produced by training/train_solar_haze_model.py in Google Colab).
//   2. A physics baseline used until a trained model is deployed.
// The haze loss is always computed the same way: run the model twice for the same
// hours, once with the real haze and once with haze set to a normal level.

import { hourGeometry, pvEnergyKwh, DEFAULT_SYSTEM } from './solar.js';

export const FEATURES = [
  'cos_zenith',
  'aod',
  'pm2_5',
  'cloud_low',
  'cloud_mid',
  'cloud_high',
  'rh',
  'temp',
];

// Typical non-haze levels for the Klang Valley. A trained model.json overrides
// these with values measured from the training locations.
export const DEFAULT_REFERENCE = { aod: 0.3, pm2_5: 15 };

const KC_MIN = 0;
const KC_MAX = 1.15;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------- Physics baseline ----------

/** Combined cloud fraction (0–1). Low cloud blocks the most light, high cloud the least. */
export function cloudFraction(low, mid, high) {
  const l = clamp((low ?? 0) / 100, 0, 1);
  const m = clamp((mid ?? 0) / 100, 0, 1);
  const h = clamp((high ?? 0) / 100, 0, 1);
  return 1 - (1 - l) * (1 - 0.75 * m) * (1 - 0.4 * h);
}

/**
 * Share of clear-sky light that passes through an aerosol layer of optical depth `aod`.
 * Haze removes part of the direct beam (Beer–Lambert), but about half of what it
 * scatters still reaches the ground as diffuse light that panels can use.
 */
export function aerosolTransmission(aod, cosZenith, cloud) {
  const m = 1 / Math.max(cosZenith, 0.08); // air mass, capped near the horizon
  const beamShare = 0.8 * (1 - cloud * cloud); // under thick cloud there is little direct beam left to lose
  const beamKept = Math.exp(-0.9 * Math.max(0, aod) * m);
  const forwardScatter = 0.45;
  return 1 - beamShare + beamShare * beamKept + beamShare * forwardScatter * (1 - beamKept);
}

const HAURWITZ_AOD = 0.25; // aerosol level already built into the clear-sky formula

export function physicsKc(x) {
  const cloud = cloudFraction(x.cloud_low, x.cloud_mid, x.cloud_high);
  const kcCloud = 1 - 0.75 * Math.pow(cloud, 3.4);
  const haze =
    aerosolTransmission(x.aod ?? HAURWITZ_AOD, x.cos_zenith, cloud) /
    aerosolTransmission(HAURWITZ_AOD, x.cos_zenith, cloud);
  return clamp(kcCloud * haze, KC_MIN, KC_MAX);
}

// ---------- Trained tree model ----------

/** Evaluate one exported tree ensemble on a feature row (array in FEATURES order). */
export function evalTrees(model, row) {
  let sum = model.baseline;
  for (const tree of model.trees) {
    let i = 0;
    while (!tree.leaf[i]) {
      const v = row[tree.f[i]];
      const goLeft = v === null || v === undefined || Number.isNaN(v) ? tree.m[i] === 1 : v <= tree.t[i];
      i = goLeft ? tree.l[i] : tree.r[i];
    }
    sum += tree.v[i];
  }
  return sum;
}

export function rowFromFeatures(model, x) {
  return model.features.map((name) => {
    const v = x[name];
    return v === undefined || v === null ? NaN : v;
  });
}

export const PHYSICS_ENGINE = {
  kind: 'physics',
  label: 'Physics baseline',
  reference: DEFAULT_REFERENCE,
  predictKc: physicsKc,
};

export function makeTreeEngine(model) {
  if (!model || model.type !== 'hgb-trees' || !Array.isArray(model.trees)) {
    throw new Error('model.json is not a SuriaMF tree model');
  }
  return {
    kind: 'trained',
    label: `Trained model (${model.trees.length} trees)`,
    reference: { ...DEFAULT_REFERENCE, ...(model.reference || {}) },
    metrics: model.metrics,
    trainedOn: model.trained_on,
    predictKc: (x) => clamp(evalTrees(model, rowFromFeatures(model, x)), KC_MIN, KC_MAX),
  };
}

let enginePromise = null;
/** Loads /model.json if it was deployed, otherwise falls back to the physics baseline. */
export function loadEngine() {
  if (!enginePromise) {
    enginePromise = fetch('/model.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => (json ? makeTreeEngine(json) : PHYSICS_ENGINE))
      .catch(() => PHYSICS_ENGINE);
  }
  return enginePromise;
}

// ---------- Haze loss for a set of hours ----------

/**
 * hours: [{ t (unix, end of hour), aod, pm2_5, cloud_low, cloud_mid, cloud_high, rh, temp }]
 * Returns per-hour energy with haze (run A) and without haze (run B).
 */
export function computeHazeLoss(hours, { lat, lon, engine = PHYSICS_ENGINE, system = DEFAULT_SYSTEM }) {
  const ref = engine.reference;
  const rows = hours.map((h) => {
    const { cosZenith, clearGhi } = hourGeometry(h.t, lat, lon);
    if (clearGhi <= 1) {
      return { ...h, cosZenith, clearGhi: 0, ghiHaze: 0, ghiClean: 0, kwhHaze: 0, kwhClean: 0, lossKwh: 0 };
    }
    const base = {
      cos_zenith: cosZenith,
      cloud_low: h.cloud_low,
      cloud_mid: h.cloud_mid,
      cloud_high: h.cloud_high,
      rh: h.rh,
      temp: h.temp,
    };
    const actualAod = h.aod ?? ref.aod;
    const actualPm = h.pm2_5 ?? ref.pm2_5;
    // Run A: the real forecast. Run B: identical, but haze no worse than normal.
    const kcHaze = engine.predictKc({ ...base, aod: actualAod, pm2_5: actualPm });
    const kcCleanRaw = engine.predictKc({
      ...base,
      aod: Math.min(actualAod, ref.aod),
      pm2_5: Math.min(actualPm, ref.pm2_5),
    });
    // Removing haze can never make a sky darker; guard against model noise.
    const kcClean = Math.max(kcCleanRaw, kcHaze);
    const ghiHaze = kcHaze * clearGhi;
    const ghiClean = kcClean * clearGhi;
    const kwhHaze = pvEnergyKwh(ghiHaze, h.temp, system);
    const kwhClean = pvEnergyKwh(ghiClean, h.temp, system);
    return {
      ...h,
      cosZenith,
      clearGhi,
      kcHaze,
      kcClean,
      ghiHaze,
      ghiClean,
      kwhHaze,
      kwhClean,
      lossKwh: Math.max(0, kwhClean - kwhHaze),
    };
  });
  const kwhHaze = rows.reduce((s, r) => s + r.kwhHaze, 0);
  const kwhClean = rows.reduce((s, r) => s + r.kwhClean, 0);
  const lossKwh = Math.max(0, kwhClean - kwhHaze);
  const sunHours = rows.filter((r) => r.clearGhi > 50);
  const mean = (arr, k) => (arr.length ? arr.reduce((s, r) => s + (r[k] ?? 0), 0) / arr.length : 0);
  return {
    rows,
    kwhHaze,
    kwhClean,
    lossKwh,
    lossPct: kwhClean > 0 ? (lossKwh / kwhClean) * 100 : 0,
    meanAod: mean(sunHours, 'aod'),
    meanPm25: mean(sunHours, 'pm2_5'),
    meanCloud: mean(
      sunHours.map((r) => ({ c: cloudFraction(r.cloud_low, r.cloud_mid, r.cloud_high) * 100 })),
      'c'
    ),
  };
}
