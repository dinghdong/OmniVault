import { logger } from '../logger.js';
import { MultiAgentOrchestrator } from '../agents/multiAgentOrchestrator.js';
import { auditStorage } from './auditStorage.js';

class AuditScheduler {
  constructor() {
    this.orchestrator = new MultiAgentOrchestrator();
    this.pendingJobs = new Map();
    this.processingJobs = new Map();
  }

  async queueAudit(auditRequest) {
    const jobId = this._generateJobId();

    const job = {
      id: jobId,
      status: 'queued',
      request: auditRequest,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
    };

    this.pendingJobs.set(jobId, job);
    logger.info('Audit job queued', { jobId, projectId: auditRequest.projectId });

    // Process asynchronously — do not await
    this._processJob(jobId).catch(err => {
      logger.error('Job processing failed', { jobId, error: err.message });
    });

    return jobId;
  }

  async getAuditStatus(projectId) {
    const audits = await auditStorage.getByProjectId(projectId);
    if (!audits || audits.length === 0) return null;

    const latest = audits[0];
    return {
      projectId,
      jobId: latest.jobId,
      status: latest.status,
      score: latest.score,
      scoreLow: latest.scoreLow,
      scoreHigh: latest.scoreHigh,
      reportHash: latest.reportHash,
      recommendation: latest.recommendation,
      completedAt: latest.completedAt,
      agentsUsed: latest.agentsUsed,
    };
  }

  async getAuditHistory(projectId) {
    return await auditStorage.getByProjectId(projectId);
  }

  async _processJob(jobId) {
    const job = this.pendingJobs.get(jobId);
    if (!job) {
      logger.warn('Job not found', { jobId });
      return;
    }

    this.pendingJobs.delete(jobId);
    this.processingJobs.set(jobId, job);
    job.status = 'processing';
    job.startedAt = new Date().toISOString();

    logger.info('Processing audit job', { jobId, projectId: job.request.projectId });

    try {
      const result = await this.orchestrator.runAudit({
        deckHash: job.request.deckHash,
        deckUrl: job.request.deckUrl,
        projectId: job.request.projectId,
        projectName: job.request.projectName,
        applicant: job.request.applicant,
      });

      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.result = result;

      await auditStorage.save({
        jobId,
        projectId: job.request.projectId,
        status: 'completed',
        score: result.score,
        scoreLow: result.scoreLow,
        scoreHigh: result.scoreHigh,
        reportHash: result.reportHash,
        recommendation: result.report ? JSON.parse(result.report)?.summary?.recommendation : null,
        completedAt: job.completedAt,
        agentsUsed: result.agentsUsed,
      });

      logger.info('Audit job completed', {
        jobId,
        projectId: job.request.projectId,
        score: result.score,
      });

      // Notify on-chain listener if registered
      if (typeof job.request.onComplete === 'function') {
        await job.request.onComplete(result);
      }

    } catch (err) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = err.message;

      await auditStorage.save({
        jobId,
        projectId: job.request.projectId,
        status: 'failed',
        error: err.message,
        completedAt: job.completedAt,
      });

      logger.error('Audit job failed', {
        jobId,
        projectId: job.request.projectId,
        error: err.message,
      });
    } finally {
      this.processingJobs.delete(jobId);
    }
  }

  _generateJobId() {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export const auditScheduler = new AuditScheduler();
