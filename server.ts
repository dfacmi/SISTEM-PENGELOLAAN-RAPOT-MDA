import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import app, { createApiApp } from './server/app.ts';

export { app, createApiApp };
export default app;

async function startStandaloneServer() {
  // Dev Vite middleware vs Production static serving (local / non-Vercel environments)
  const PORT = Number(process.env.PORT || 3000);
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const cwdDist = path.resolve(process.cwd(), 'dist');
    const localDist = path.resolve(import.meta.dirname, 'dist');
    const distDir = fs.existsSync(cwdDist) ? cwdDist : localDist;
    const indexHtmlPath = path.join(distDir, 'index.html');

    app.use(express.static(distDir, { index: 'index.html' }));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
        return;
      }
      if (!fs.existsSync(indexHtmlPath)) {
        res
          .status(503)
          .send('Build frontend (dist/index.html) belum tersedia. Jalankan npm run build terlebih dahulu.');
        return;
      }
      res.sendFile(indexHtmlPath);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MDA Rapor Digital server running on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startStandaloneServer().catch((err) => {
    console.error('Failed to start MDA server:', err);
    process.exit(1);
  });
}
