import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { logger } from './logger.js';
import { auditRouter } from './routes/audit.js';
import { healthRouter } from './routes/health.js';
import { errorHandler } from './middleware/errorHandler.js';
import { onChainListener } from './services/onChainListener.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

app.use('/health', healthRouter);
app.use('/api/v1/audit', auditRouter);
app.use(errorHandler);

const server = app.listen(PORT, async () => {
  logger.info(`OmniVault AI Service running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start on-chain event listener (gracefully skips if env vars not set)
  await onChainListener.start();
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  onChainListener.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export default app;
