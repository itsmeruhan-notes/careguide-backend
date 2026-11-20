import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import authRoutes from './routes/auth.js';
import noteRoutes from './routes/notes.js';
import postRoutes from './routes/posts.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import { openapi } from './docs/openapi.js';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  if (config.enableDocs) {
    app.use('/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "Ruhan's Notes API" }));
    app.get('/openapi.json', (_req, res) => res.json(openapi));
  }
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    const db = mongoose.connection.readyState === 1 ? 'up' : 'down';
    let ping = false;
    if (db === 'up') ping = Boolean(await mongoose.connection.db.admin().ping().catch(() => false));
    res.status(ping ? 200 : 503).json({ status: ping ? 'ok' : 'degraded', db: ping ? 'up' : 'down', uptime: Math.round(process.uptime()) });
  });

  app.use('/auth', authRoutes);
  app.use('/notes', noteRoutes);
  app.use('/posts', postRoutes);
  app.use('/users', userRoutes);
  app.use('/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
