import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // During `npm run dev`, stand in for the Vercel function in api/doe.js
    proxy: {
      '/api/doe': {
        target: 'https://eqms.doe.gov.my',
        changeOrigin: true,
        rewrite: () => '/api3/publicportalapims/apitablehourly',
      },
    },
  },
});
