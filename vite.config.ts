import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { buildHmacSignature } from '@polymarket/builder-signing-sdk';

export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          trade: resolve(__dirname, 'trade.html'),
          app: resolve(__dirname, 'app.html'),
        },
      },
    },
    server: {
      // Add custom middleware for the signing endpoint
      proxy: {},
    },
    // Configure server middleware for signing endpoint
    configureServer(server) {
      server.middlewares.use('/api/polymarket/sign', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        // Read body
        let body = '';
        for await (const chunk of req) {
          body += chunk;
        }

        try {
          const { method, path, body: requestBody } = JSON.parse(body);

          const sigTimestamp = Date.now().toString();

          const signature = buildHmacSignature(
            env.POLYMARKET_BUILDER_SECRET,
            parseInt(sigTimestamp),
            method,
            path,
            requestBody
          );

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            POLY_BUILDER_SIGNATURE: signature,
            POLY_BUILDER_TIMESTAMP: sigTimestamp,
            POLY_BUILDER_API_KEY: env.POLYMARKET_BUILDER_API_KEY,
            POLY_BUILDER_PASSPHRASE: env.POLYMARKET_BUILDER_PASSPHRASE,
          }));
        } catch (error: any) {
          console.error('Signing error:', error);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    },
  };
});
