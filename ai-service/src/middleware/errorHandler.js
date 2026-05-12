import { logger } from '../logger.js';

export const errorHandler = (err, req, res, next) => {
  logger.error(`Unhandled error`, {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // Don't expose internal errors in production
  const isDev = process.env.NODE_ENV === 'development';

  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Internal server error',
    ...(isDev && { stack: err.stack }),
    timestamp: new Date().toISOString()
  });
};