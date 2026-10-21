import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { parseFirmsCsv, REGION_BBOX } from './src/lib/fires.js';

// Local stand-in for api/fires.js (NASA FIRMS fire hotspots). Put FIRMS_MAP_KEY=... in .env.local.
function firesDevApi(env) {
  return {
    name: 'fires-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/fires', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (!env.FIRMS_MAP_KEY) {
          res.statusCode = 501;
          return res.end(JSON.stringify({ error: 'FIRMS_MAP_KEY is not set in .env.local', notConfigured: true }));
        }
        const { west, south, east, north } = REGION_BBOX;
        try {
          const r = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/${west},${south},${east},${north}/2`);
          const text = await r.text();
          if (!text.startsWith('latitude')) throw new Error(text.slice(0, 120));
          res.end(JSON.stringify({ fires: parseFirmsCsv(text), source: 'NASA FIRMS VIIRS S-NPP', days: 2 }));
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
      });
    },
  };
}

// During `npm run dev`, these proxies stand in for the Vercel functions in api/.
// For IQAir locally, put IQAIR_API_KEY=... in a file called .env.local (never commit it).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), firesDevApi(env)],
    server: {
      proxy: {
        '/api/doe': {
          target: 'https://eqms.doe.gov.my',
          changeOrigin: true,
          rewrite: () => '/api3/publicportalapims/apitablehourly',
        },
        '/api/places': {
          target: 'https://api.airvisual.com',
          changeOrigin: true,
          rewrite: (path) => {
            const q = new URLSearchParams(path.split('?')[1] || '');
            const type = q.get('type') === 'cities' ? 'cities' : 'states';
            q.delete('type');
            q.set('key', env.IQAIR_API_KEY || '');
            return `/v2/${type}?${q.toString()}`;
          },
          selfHandleResponse: true,
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes, req, res) => {
              let body = '';
              proxyRes.on('data', (c) => (body += c));
              proxyRes.on('end', () => {
                res.setHeader('Content-Type', 'application/json');
                try {
                  const j = JSON.parse(body);
                  if (j.status !== 'success') throw new Error(j.data?.message || 'IQAir error');
                  res.end(JSON.stringify({ items: j.data.map((d) => d.state || d.city) }));
                } catch (e) {
                  res.statusCode = 502;
                  res.end(JSON.stringify({ error: String(e.message) }));
                }
              });
            });
          },
        },
        '/api/iqair': {
          target: 'https://api.airvisual.com',
          changeOrigin: true,
          rewrite: (path) => {
            const q = new URLSearchParams(path.split('?')[1] || '');
            return `/v2/nearest_city?lat=${q.get('lat')}&lon=${q.get('lon')}&key=${encodeURIComponent(env.IQAIR_API_KEY || '')}`;
          },
          // Reshape IQAir's raw answer the same way api/iqair.js does
          selfHandleResponse: true,
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes, req, res) => {
              let body = '';
              proxyRes.on('data', (c) => (body += c));
              proxyRes.on('end', () => {
                res.setHeader('Content-Type', 'application/json');
                try {
                  const j = JSON.parse(body);
                  if (j.status !== 'success') throw new Error(j.data?.message || 'IQAir error');
                  const d = j.data;
                  const p = d.current.pollution;
                  const w = d.current.weather;
                  res.end(JSON.stringify({
                    city: d.city, state: d.state, country: d.country,
                    lat: d.location.coordinates[1], lon: d.location.coordinates[0],
                    aqius: p.aqius, mainus: p.mainus, ts: p.ts,
                    weather: { tempC: w.tp, humidity: w.hu, windMs: w.ws, windDir: w.wd, icon: w.ic, ts: w.ts },
                  }));
                } catch (e) {
                  res.statusCode = env.IQAIR_API_KEY ? 502 : 501;
                  res.end(JSON.stringify({ error: env.IQAIR_API_KEY ? String(e.message) : 'IQAIR_API_KEY is not set in .env.local' }));
                }
              });
            });
          },
        },
      },
    },
  };
});
