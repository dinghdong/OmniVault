import { z } from 'zod';
import { logger } from '../logger.js';
import { auditScheduler } from '../services/auditScheduler.js';

const auditRequestSchema = z.object({
  projectId:   z.number().int().positive(),
  deckHash:    z.string().min(1, 'deckHash (keccak256 of pitch deck file) is required'),
  deckUrl:     z.string().url('deckUrl must be a valid URL').optional(),
  projectName: z.string().optional(),
  applicant:   z.string().optional(),
});

export const validateAuditRequest = (req, res, next) => {
  try {
    auditRequestSchema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
      });
    }
    next(error);
  }
};

export const auditController = {
  /**
   * POST /api/v1/audit
   * Manually trigger a pitch deck audit (used for testing / admin override).
   * The normal path is the on-chain listener firing on ProjectSubmitted events.
   */
  async requestAudit(req, res, next) {
    try {
      const { projectId, deckHash, deckUrl, projectName, applicant } = req.body;

      logger.info('Audit request received', { projectId });

      const jobId = await auditScheduler.queueAudit({
        projectId,
        deckHash,
        deckUrl,
        projectName,
        applicant,
        requestedBy: req.ip,
        requestedAt: new Date().toISOString(),
      });

      res.status(202).json({
        success: true,
        jobId,
        message: 'Audit queued — results available at GET /api/v1/audit/:projectId',
        estimatedSeconds: 45,
      });
    } catch (error) {
      next(error);
    }
  },

  async getAuditStatus(req, res, next) {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      const status = await auditScheduler.getAuditStatus(projectId);

      if (!status) {
        return res.status(404).json({ error: 'Audit not found', projectId });
      }

      res.json(status);
    } catch (error) {
      next(error);
    }
  },

  async getAuditHistory(req, res, next) {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      const history = await auditScheduler.getAuditHistory(projectId);

      res.json({ projectId, totalAudits: history.length, audits: history });
    } catch (error) {
      next(error);
    }
  },
};
