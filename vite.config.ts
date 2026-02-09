import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Create a plugin for Polymarket API endpoints
function polymarketApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'polymarket-api',
    configureServer(server) {
      // Helper to read request body
      const readBody = async (req: any): Promise<string> => {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
        }
        return body;
      };

      // Debug: log all API requests
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/')) {
          console.log('[API] Request:', req.method, req.url);
        }
        next();
      });

      // Deploy Safe endpoint - uses /submit with SAFE_CREATE type
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/api/safe/deploy' || req.method !== 'POST') {
          return next();
        }

        console.log('[API] Deploy endpoint hit');

        try {
          const body = await readBody(req);
          console.log('[API] Deploy body:', body.substring(0, 200));
          const { eoaAddress, signature, proxyAddress, safeFactoryAddress } = JSON.parse(body);

          // Import server-side modules dynamically
          const { buildHmacSignature } = await import('@polymarket/builder-signing-sdk');

          // Generate headers for the deploy request
          // IMPORTANT: SDK uses timestamp in SECONDS, not milliseconds!
          const timestamp = Math.floor(Date.now() / 1000);
          const requestPath = '/submit'; // Correct endpoint

          // Request body with correct format for SAFE_CREATE
          const requestBody = JSON.stringify({
            from: eoaAddress,
            to: safeFactoryAddress,
            proxyWallet: proxyAddress,
            data: '0x',
            signature,
            signatureParams: {
              paymentToken: '0x0000000000000000000000000000000000000000',
              payment: '0',
              paymentReceiver: '0x0000000000000000000000000000000000000000',
            },
            type: 'SAFE-CREATE',
          });

          console.log('[API] Making request to relayer...', requestPath);
          console.log('[API] Request body:', requestBody);
          console.log('[API] Using credentials - Key:', env.VITE_BUILDER_API_KEY?.substring(0, 10) + '...');
          console.log('[API] Using credentials - Secret:', env.VITE_BUILDER_SECRET?.substring(0, 10) + '...');

          const hmacSignature = buildHmacSignature(
            env.VITE_BUILDER_SECRET || '',
            timestamp,
            'POST',
            requestPath,
            requestBody
          );

          console.log('[API] Generated HMAC signature:', hmacSignature?.substring(0, 30) + '...');
          console.log('[API] Timestamp:', timestamp);

          // Make the actual request to the relayer
          // Note: Headers use underscores as per Polymarket docs
          const response = await fetch('https://relayer-v2.polymarket.com/submit', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'POLY_BUILDER_SIGNATURE': hmacSignature,
              'POLY_BUILDER_TIMESTAMP': timestamp.toString(),
              'POLY_BUILDER_API_KEY': env.VITE_BUILDER_API_KEY || '',
              'POLY_BUILDER_PASSPHRASE': env.VITE_BUILDER_PASSPHRASE || '',
            },
            body: requestBody,
          });

          console.log('[API] Relayer response status:', response.status);
          const resultText = await response.text();
          console.log('[API] Relayer response:', resultText.substring(0, 500));

          res.setHeader('Content-Type', 'application/json');
          if (!response.ok) {
            res.statusCode = response.status;
          }
          res.end(resultText);
        } catch (error: any) {
          console.error('[API] Deploy error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
      });

      // Get nonce endpoint - needed for Safe transactions
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/safe/nonce') || req.method !== 'GET') {
          return next();
        }

        console.log('[API] Nonce endpoint hit:', req.url);

        try {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const address = url.searchParams.get('address');
          const type = url.searchParams.get('type') || 'SAFE';

          if (!address) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing address parameter' }));
            return;
          }

          const response = await fetch(`https://relayer-v2.polymarket.com/nonce?address=${address}&type=${type}`, {
            method: 'GET',
          });

          const resultText = await response.text();
          console.log('[API] Nonce response:', response.status, resultText);

          res.setHeader('Content-Type', 'application/json');
          if (!response.ok) {
            res.statusCode = response.status;
          }
          res.end(resultText);
        } catch (error: any) {
          console.error('[API] Nonce error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
      });

      // Check if Safe is deployed endpoint
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/safe/deployed') || req.method !== 'GET') {
          return next();
        }

        console.log('[API] Deployed endpoint hit:', req.url);

        try {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const address = url.searchParams.get('address');

          if (!address) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing address parameter' }));
            return;
          }

          const response = await fetch(`https://relayer-v2.polymarket.com/deployed?address=${address}`, {
            method: 'GET',
          });

          const resultText = await response.text();
          console.log('[API] Deployed response:', response.status, resultText);

          res.setHeader('Content-Type', 'application/json');
          if (!response.ok) {
            res.statusCode = response.status;
          }
          res.end(resultText);
        } catch (error: any) {
          console.error('[API] Deployed error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
      });

      // Execute transactions endpoint - uses /submit with SAFE type
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/api/safe/execute' || req.method !== 'POST') {
          return next();
        }

        console.log('[API] Execute endpoint hit');

        try {
          const body = await readBody(req);
          console.log('[API] Execute raw body:', body.substring(0, 500));

          const {
            from,
            to,
            proxyWallet,
            data,
            nonce,
            signature,
            signatureParams,
            metadata
          } = JSON.parse(body);

          const { buildHmacSignature } = await import('@polymarket/builder-signing-sdk');

          // IMPORTANT: SDK uses timestamp in SECONDS, not milliseconds!
          const timestamp = Math.floor(Date.now() / 1000);
          const requestPath = '/submit';

          // Format matches SDK's buildSafeTransactionRequest output
          // IMPORTANT: nonce must be a STRING, not a number!
          const requestBody = JSON.stringify({
            from,
            to,
            proxyWallet,
            data,
            nonce: String(nonce), // Must be string per SDK types
            signature,
            signatureParams: signatureParams || {
              gasPrice: '0',
              operation: '0',
              safeTxnGas: '0',
              baseGas: '0',
              gasToken: '0x0000000000000000000000000000000000000000',
              refundReceiver: '0x0000000000000000000000000000000000000000',
            },
            type: 'SAFE',
            metadata: metadata || '',
          });

          console.log('[API] Execute request body:', requestBody);
          console.log('[API] Execute from:', from);
          console.log('[API] Execute to:', to);
          console.log('[API] Execute proxyWallet:', proxyWallet);
          console.log('[API] Execute nonce:', nonce);

          const hmacSignature = buildHmacSignature(
            env.VITE_BUILDER_SECRET || '',
            timestamp,
            'POST',
            requestPath,
            requestBody
          );

          console.log('[API] Execute HMAC:', hmacSignature?.substring(0, 30) + '...');

          const response = await fetch('https://relayer-v2.polymarket.com/submit', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'POLY_BUILDER_SIGNATURE': hmacSignature,
              'POLY_BUILDER_TIMESTAMP': timestamp.toString(),
              'POLY_BUILDER_API_KEY': env.VITE_BUILDER_API_KEY || '',
              'POLY_BUILDER_PASSPHRASE': env.VITE_BUILDER_PASSPHRASE || '',
            },
            body: requestBody,
          });

          const resultText = await response.text();
          console.log('[API] Execute response:', response.status, resultText);

          res.setHeader('Content-Type', 'application/json');
          if (!response.ok) {
            res.statusCode = response.status;
          }
          res.end(resultText);
        } catch (error: any) {
          console.error('[API] Execute error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
      });

      // Poll transaction status endpoint
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/safe/status') || req.method !== 'GET') {
          return next();
        }

        console.log('[API] Status endpoint hit:', req.url);

        try {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const txId = url.searchParams.get('txId');

          if (!txId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing txId parameter' }));
            return;
          }

          const { buildHmacSignature } = await import('@polymarket/builder-signing-sdk');

          // IMPORTANT: SDK uses timestamp in SECONDS, not milliseconds!
          const timestamp = Math.floor(Date.now() / 1000);
          // Include query string in path for HMAC signature
          const requestPath = `/transaction?id=${txId}`;

          const hmacSignature = buildHmacSignature(
            env.VITE_BUILDER_SECRET || '',
            timestamp,
            'GET',
            requestPath,
            ''
          );

          console.log('[API] Status request path for HMAC:', requestPath);

          const response = await fetch(`https://relayer-v2.polymarket.com/transaction?id=${txId}`, {
            method: 'GET',
            headers: {
              // Use underscores like the successful deploy endpoint
              'POLY_BUILDER_SIGNATURE': hmacSignature,
              'POLY_BUILDER_TIMESTAMP': timestamp.toString(),
              'POLY_BUILDER_API_KEY': env.VITE_BUILDER_API_KEY || '',
              'POLY_BUILDER_PASSPHRASE': env.VITE_BUILDER_PASSPHRASE || '',
            },
          });

          const resultText = await response.text();
          // Parse and log the state for debugging
          try {
            const parsed = JSON.parse(resultText);
            const state = Array.isArray(parsed) ? parsed[0]?.state : parsed?.state;
            console.log('[API] Status response:', response.status, 'state:', state);
          } catch {
            console.log('[API] Status response:', response.status, resultText.substring(0, 200));
          }

          res.setHeader('Content-Type', 'application/json');
          if (!response.ok) {
            res.statusCode = response.status;
          }
          res.end(resultText);
        } catch (error: any) {
          console.error('[API] Status error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      nodePolyfills({
        include: ['buffer', 'process', 'util', 'stream', 'events'],
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
      }),
      polymarketApiPlugin(env),
    ],
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
      proxy: {},
    },
  };
});
