import { Router } from 'express';

const router = Router();

/**
 * GET /health
 * Health check endpoint
 */
router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

/**
 * GET /health/ready
 * Readiness check (includes dependencies)
 */
router.get('/ready', async (req, res) => {
  const checks = {
    openai: false,
    anthropic: false,
    blockchain: false
  };

  try {
    // Check OpenAI
    if (process.env.OPENAI_API_KEY) {
      checks.openai = true;
    }

    // Check Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      checks.anthropic = true;
    }

    const allHealthy = Object.values(checks).every(v => v);

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export { router as healthRouter };