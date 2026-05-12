import { Router } from 'express';
import { auditController } from '../controllers/auditController.js';
import { validateAuditRequest } from '../middleware/validateRequest.js';

const router = Router();

/**
 * POST /api/v1/audit
 * Request AI audit for a project
 */
router.post('/', validateAuditRequest, auditController.requestAudit);

/**
 * GET /api/v1/audit/:projectId
 * Get audit status and result for a project
 */
router.get('/:projectId', auditController.getAuditStatus);

/**
 * GET /api/v1/audit/:projectId/history
 * Get full audit history for a project
 */
router.get('/:projectId/history', auditController.getAuditHistory);

export { router as auditRouter };