"""
SuriaHaze — train the solar haze model.

Runs in Google Colab (free) or any Python 3.9+ machine. No API keys, no cost.

    !pip install requests pandas scikit-learn        # already present in Colab
    !python train_solar_haze_model.py                 # downloads data, trains, writes model.json

Then copy model.json into the web app's `public/` folder and redeploy on Vercel.
The app picks it up automatically (the "How it works" page shows which model is live).

What it does
------------
1. Downloads hourly data for several Malaysian locations (all free, from Open-Meteo):
   - measured sunlight from the Himawari satellite          (target)
   - aerosol optical depth + PM2.5 from Copernicus CAMS      (haze inputs)
   - low/mid/high cloud, humidity, temperature from archived
     weather-model forecasts (the same kind of input the app
     gets live, so training and use match)                   (weather inputs)
2. Computes clear-sky sunlight with EXACTLY the same physics as the app
   (src/lib/solar.js) and turns the target into a clear-sky index (0–1.15).
3. Trains gradient-boosted trees (scikit-learn's HistGradientBoostingRegressor,
   the same algorithm family as LightGBM/XGBoost) with a monotonic constraint:
   more haze can never mean more sunlight.
4. Tests on a haze period the model never saw and reports error WITH haze inputs
   vs an identical model trained WITHOUT them — the number to show the judges.
5. Exports the trees to model.json for the browser.

Options
-------
    --start 2023-01-01 --end 2026-10-10        training window (CAMS history starts Aug 2022)
    --test-start 2023-09-20 --test-end 2023-10-15   held-out haze period
    --out model.json
    --synthetic        offline self-test with simulated data (no internet needed)
    --parity tests/parity_cases.json   also write cases to check the JS evaluator
"""

import argparse
import json
import math
import sys
import time
from datetime import date, timedelta

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error

FEATURES = ["cos_zenith", "aod", "pm2_5", "cloud_low", "cloud_mid", "cloud_high", "rh", "temp"]
# -1 = prediction may only go DOWN as the feature goes up (haze and cloud block light)
MONOTONIC = {"aod": -1, "pm2_5": -1, "cloud_low": -1}
KC_MAX = 1.15

LOCATIONS = [
    ("Shah Alam", 3.073, 101.518),
    ("Kuala Lumpur", 3.139, 101.687),
    ("Seremban", 2.726, 101.938),
    ("Klang", 3.045, 101.445),
    ("Melaka", 2.196, 102.249),
    ("Johor Bahru", 1.492, 103.741),
    ("Ipoh", 4.597, 101.090),
    ("Kuching", 1.553, 110.359),
]

# ---------------------------------------------------------------------------
# Physics — a line-for-line copy of src/lib/solar.js. Keep them identical.
# ---------------------------------------------------------------------------
RAD = math.pi / 180
DEG = 180 / math.pi


def solar_cos_zenith(unix_seconds, lat, lon):
    jd = unix_seconds / 86400 + 2440587.5
    T = (jd - 2451545) / 36525
    L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    Mr = M * RAD
    C = (math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
         + math.sin(2 * Mr) * (0.019993 - 0.000101 * T)
         + math.sin(3 * Mr) * 0.000289)
    omega = 125.04 - 1934.136 * T
    lam = L0 + C - 0.00569 - 0.00478 * math.sin(omega * RAD)
    eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60
    eps = eps0 + 0.00256 * math.cos(omega * RAD)
    decl = math.asin(math.sin(eps * RAD) * math.sin(lam * RAD))
    y = math.tan((eps / 2) * RAD) ** 2
    L0r = L0 * RAD
    eq_time = 4 * DEG * (y * math.sin(2 * L0r) - 2 * e * math.sin(Mr)
                         + 4 * e * y * math.sin(Mr) * math.cos(2 * L0r)
                         - 0.5 * y * y * math.sin(4 * L0r) - 1.25 * e * e * math.sin(2 * Mr))
    minutes_utc = ((unix_seconds / 60) % 1440 + 1440) % 1440
    true_solar_time = ((minutes_utc + eq_time + 4 * lon) % 1440 + 1440) % 1440
    hour_angle = true_solar_time / 4 - 180
    lat_r = lat * RAD
    cos_z = (math.sin(lat_r) * math.sin(decl)
             + math.cos(lat_r) * math.cos(decl) * math.cos(hour_angle * RAD))
    return max(-1.0, min(1.0, cos_z))


def clear_sky_ghi(cos_z):
    if cos_z <= 0:
        return 0.0
    return 1098 * cos_z * math.exp(-0.057 / cos_z)


def hour_geometry(hour_end_unix, lat, lon):
    """Mean cos(zenith) and clear-sky sunlight over the hour ENDING at hour_end_unix."""
    cos_sum = 0.0
    ghi_sum = 0.0
    for k in range(6):
        t = hour_end_unix - (55 - 10 * k) * 60
        cz = solar_cos_zenith(t, lat, lon)
        cos_sum += max(0.0, cz)
        ghi_sum += clear_sky_ghi(cz)
    return cos_sum / 6, ghi_sum / 6


# ---------------------------------------------------------------------------
# Data download
# ---------------------------------------------------------------------------
SAT_URL = "https://satellite-api.open-meteo.com/v1/archive"
AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WX_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"


def _get(url, params, tries=4):
    import requests

    for attempt in range(tries):
        r = requests.get(url, params=params, timeout=120)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429:  # rate limited — wait and retry
            time.sleep(20 * (attempt + 1))
            continue
        raise RuntimeError(f"{url} -> HTTP {r.status_code}: {r.text[:300]}")
    raise RuntimeError(f"{url}: too many retries")


def _chunks(start, end, days=180):
    s = date.fromisoformat(start)
    e = date.fromisoformat(end)
    while s <= e:
        c = min(e, s + timedelta(days=days - 1))
        yield s.isoformat(), c.isoformat()
        s = c + timedelta(days=1)


def _frame(js, mapping):
    h = js["hourly"]
    df = pd.DataFrame({"t": h["time"]})
    for src, dst in mapping.items():
        df[dst] = h.get(src)
    return df


def download_location(name, lat, lon, start, end):
    parts = []
    for s, e in _chunks(start, end):
        common = dict(latitude=lat, longitude=lon, start_date=s, end_date=e, timeformat="unixtime", timezone="GMT")
        sat = _get(SAT_URL, {**common, "hourly": "shortwave_radiation", "models": "satellite_radiation_seamless"})
        aq = _get(AQ_URL, {**common, "hourly": "aerosol_optical_depth,pm2_5"})
        wx = _get(WX_URL, {**common, "hourly": "cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,temperature_2m"})
        df = _frame(sat, {"shortwave_radiation": "ghi"})
        df = df.merge(_frame(aq, {"aerosol_optical_depth": "aod", "pm2_5": "pm2_5"}), on="t", how="left")
        df = df.merge(_frame(wx, {"cloud_cover_low": "cloud_low", "cloud_cover_mid": "cloud_mid",
                                  "cloud_cover_high": "cloud_high", "relative_humidity_2m": "rh",
                                  "temperature_2m": "temp"}), on="t", how="left")
        parts.append(df)
        print(f"  {name}: {s} → {e}  ({len(df)} hours)")
        time.sleep(1)
    df = pd.concat(parts, ignore_index=True)
    df["location"] = name
    df["lat"] = lat
    df["lon"] = lon
    return df


def build_rows(df):
    """Turn raw hourly data into model rows (same rule as dayModelHours in src/lib/api.js)."""
    out = []
    for name, g in df.groupby("location", sort=False):
        g = g.sort_values("t").reset_index(drop=True)
        lat, lon = g["lat"].iloc[0], g["lon"].iloc[0]
        # inputs = average of the readings at the start and end of each hour
        for col in ["aod", "pm2_5", "cloud_low", "cloud_mid", "cloud_high", "rh", "temp"]:
            prev = g[col].shift(1)
            g[col + "_avg"] = pd.concat([prev, g[col]], axis=1).mean(axis=1)
        geo = [hour_geometry(int(t), lat, lon) for t in g["t"]]
        g["cos_zenith"] = [c for c, _ in geo]
        g["clear_ghi"] = [x for _, x in geo]
        rows = pd.DataFrame({
            "t": g["t"], "location": name, "cos_zenith": g["cos_zenith"], "clear_ghi": g["clear_ghi"],
            "ghi": g["ghi"],
            **{c: g[c + "_avg"] for c in ["aod", "pm2_5", "cloud_low", "cloud_mid", "cloud_high", "rh", "temp"]},
        })
        out.append(rows)
    rows = pd.concat(out, ignore_index=True)
    rows = rows[(rows["clear_ghi"] > 50) & rows["ghi"].notna()].copy()
    rows["kc"] = (rows["ghi"] / rows["clear_ghi"]).clip(0, KC_MAX)
    rows["date"] = pd.to_datetime(rows["t"], unit="s", utc=True).dt.tz_convert("Asia/Kuala_Lumpur").dt.date.astype(str)
    return rows


# ---------------------------------------------------------------------------
# Offline self-test data (simulated; for checking the pipeline only)
# ---------------------------------------------------------------------------
def synthetic_rows(n_days=400, seed=7):
    rng = np.random.default_rng(seed)
    recs = []
    start = int(pd.Timestamp("2023-01-01", tz="UTC").timestamp())
    for name, lat, lon in LOCATIONS[:3]:
        for d in range(n_days):
            haze = 1.4 * math.exp(-(((d % 365) - 270) / 12) ** 2)  # a haze season each Sept/Oct
            for hr in range(24):
                t = start + d * 86400 + hr * 3600
                cz, cg = hour_geometry(t, lat, lon)
                if cg <= 50:
                    continue
                aod = max(0.05, 0.3 + haze + rng.normal(0, 0.1))
                low = float(np.clip(rng.beta(1.2, 2.0) * 100, 0, 100))
                mid = float(np.clip(rng.beta(1.0, 3.0) * 100, 0, 100))
                high = float(np.clip(rng.beta(1.0, 2.0) * 100, 0, 100))
                cloud = 1 - (1 - low / 100) * (1 - 0.75 * mid / 100) * (1 - 0.4 * high / 100)
                m = 1 / max(cz, 0.08)
                beam = 0.8 * (1 - cloud * cloud)
                trans = lambda a: 1 - beam + beam * math.exp(-0.9 * a * m) + beam * 0.45 * (1 - math.exp(-0.9 * a * m))
                kc = (1 - 0.75 * cloud ** 3.4) * trans(aod) / trans(0.25) + rng.normal(0, 0.05)
                recs.append(dict(t=t, location=name, cos_zenith=cz, clear_ghi=cg, ghi=kc * cg, aod=aod,
                                 pm2_5=10 + 60 * (aod - 0.3) + rng.normal(0, 4), cloud_low=low, cloud_mid=mid,
                                 cloud_high=high, rh=float(rng.uniform(55, 95)), temp=float(rng.uniform(24, 34))))
    rows = pd.DataFrame(recs)
    rows["kc"] = (rows["ghi"] / rows["clear_ghi"]).clip(0, KC_MAX)
    rows["date"] = pd.to_datetime(rows["t"], unit="s", utc=True).dt.tz_convert("Asia/Kuala_Lumpur").dt.date.astype(str)
    # a few gaps, like real data
    rows.loc[rows.sample(frac=0.02, random_state=1).index, "aod"] = np.nan
    return rows


# ---------------------------------------------------------------------------
# Training, evaluation, export
# ---------------------------------------------------------------------------
def make_model(features):
    return HistGradientBoostingRegressor(
        max_iter=250,
        learning_rate=0.06,
        max_leaf_nodes=20,
        min_samples_leaf=40,
        l2_regularization=1.0,
        monotonic_cst=[MONOTONIC.get(f, 0) for f in features],
        random_state=0,
    )


def export_trees(model, features):
    trees = []
    for stage in model._predictors:  # scikit-learn internals, stable since 1.0
        nodes = stage[0].nodes
        if np.any(nodes["is_categorical"]):
            raise RuntimeError("categorical splits are not supported by the JS evaluator")
        trees.append({
            "f": nodes["feature_idx"].astype(int).tolist(),
            # JSON has no Infinity; ±1e308 compares the same way against any real reading
            "t": [float(np.clip(x, -1e308, 1e308)) for x in nodes["num_threshold"]],
            "l": nodes["left"].astype(int).tolist(),
            "r": nodes["right"].astype(int).tolist(),
            "m": nodes["missing_go_to_left"].astype(int).tolist(),
            "leaf": nodes["is_leaf"].astype(int).tolist(),
            "v": [float(x) for x in nodes["value"]],
        })
    return {"type": "hgb-trees", "features": features, "baseline": float(np.ravel(model._baseline_prediction)[0]), "trees": trees}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="2023-01-01")
    ap.add_argument("--end", default=(date.today() - timedelta(days=3)).isoformat())
    ap.add_argument("--test-start", default="2023-09-20")
    ap.add_argument("--test-end", default="2023-10-15")
    ap.add_argument("--out", default="model.json")
    ap.add_argument("--synthetic", action="store_true", help="offline self-test with simulated data")
    ap.add_argument("--parity", default=None, help="write JS parity test cases to this path")
    ap.add_argument("--save-csv", default=None, help="also save the training table as CSV")
    args = ap.parse_args()

    if args.synthetic:
        print("Using SIMULATED data (pipeline self-test only — do not deploy this model).")
        rows = synthetic_rows()
        args.test_start, args.test_end = "2023-09-15", "2023-10-15"
    else:
        print(f"Downloading {len(LOCATIONS)} locations, {args.start} → {args.end} …")
        raw = pd.concat([download_location(n, la, lo, args.start, args.end) for n, la, lo in LOCATIONS], ignore_index=True)
        rows = build_rows(raw)
    if args.save_csv:
        rows.to_csv(args.save_csv, index=False)
    print(f"{len(rows):,} daylight hours")

    test_mask = (rows["date"] >= args.test_start) & (rows["date"] <= args.test_end)
    train, test = rows[~test_mask], rows[test_mask]
    if len(test) < 50:
        print("Warning: almost no data in the test period; using a random 15% instead.")
        test = rows.sample(frac=0.15, random_state=0)
        train = rows.drop(test.index)

    with_haze = make_model(FEATURES).fit(train[FEATURES], train["kc"])
    no_haze_feats = [f for f in FEATURES if f not in ("aod", "pm2_5")]
    without_haze = make_model(no_haze_feats).fit(train[no_haze_feats], train["kc"])

    pred_h = np.clip(with_haze.predict(test[FEATURES]), 0, KC_MAX)
    pred_n = np.clip(without_haze.predict(test[no_haze_feats]), 0, KC_MAX)
    mae_h = mean_absolute_error(test["kc"], pred_h)
    mae_n = mean_absolute_error(test["kc"], pred_n)
    hazy = test["aod"] > test["aod"].quantile(0.75)
    print(f"\nHeld-out test ({args.test_start} → {args.test_end}, {len(test):,} hours)")
    print(f"  clear-sky index error WITH haze inputs:    {mae_h:.4f}")
    print(f"  clear-sky index error WITHOUT haze inputs: {mae_n:.4f}")
    print(f"  improvement: {100 * (1 - mae_h / mae_n):.1f}%")
    if hazy.sum() > 20:
        mh = mean_absolute_error(test.loc[hazy, "kc"], pred_h[hazy.values])
        mn = mean_absolute_error(test.loc[hazy, "kc"], pred_n[hazy.values])
        print(f"  on the haziest quarter of hours: {mh:.4f} vs {mn:.4f}")

    # Final model on all data
    final = make_model(FEATURES).fit(rows[FEATURES], rows["kc"])
    export = export_trees(final, FEATURES)
    export["reference"] = {
        "aod": round(float(rows["aod"].median()), 3),  # haze is episodic, so the median is a normal day
        "pm2_5": round(float(rows["pm2_5"].median()), 1),
    }
    export["metrics"] = {
        "test_period": f"{args.test_start} to {args.test_end}",
        "test_hours": int(len(test)),
        "mae_with_haze": round(float(mae_h), 4),
        "mae_without_haze": round(float(mae_n), 4),
    }
    export["trained_on"] = {
        "rows": int(len(rows)),
        "locations": sorted(rows["location"].unique().tolist()),
        "start": str(rows["date"].min()),
        "end": str(rows["date"].max()),
        "synthetic": bool(args.synthetic),
    }
    with open(args.out, "w") as f:
        json.dump(export, f, separators=(",", ":"), allow_nan=False)
    print(f"\nWrote {args.out} ({len(export['trees'])} trees). Reference levels: {export['reference']}")

    if args.parity:
        sample = rows.sample(n=min(300, len(rows)), random_state=3)
        X = sample[FEATURES].copy()
        X.iloc[:10, FEATURES.index("aod")] = np.nan  # exercise the missing-value path
        cases = {
            "features": FEATURES,
            "rows": [[None if pd.isna(v) else float(v) for v in r] for r in X.itertuples(index=False)],
            "expected": final.predict(X).tolist(),
            "sun": [
                {"t": int(t), "lat": la, "lon": lo, "cos_zenith": solar_cos_zenith(int(t), la, lo),
                 "hour_cos": hour_geometry(int(t), la, lo)[0], "hour_clear": hour_geometry(int(t), la, lo)[1]}
                for t, la, lo in [(1792036800 + k * 3700, 3.1 + 0.01 * k, 101.5 + 0.05 * k) for k in range(40)]
            ],
        }
        with open(args.parity, "w") as f:
            json.dump(cases, f, allow_nan=False)
        print(f"Wrote parity cases to {args.parity}")


if __name__ == "__main__":
    sys.exit(main())
