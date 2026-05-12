/**
 * In-memory audit storage
 * In production, replace with PostgreSQL/Redis
 */
class AuditStorage {
  constructor() {
    // Map<projectId, AuditRecord[]>
    this.audits = new Map();
  }

  async save(audit) {
    const projectId = audit.projectId;
    if (!this.audits.has(projectId)) {
      this.audits.set(projectId, []);
    }
    const records = this.audits.get(projectId);
    records.unshift(audit); // Add to beginning (most recent first)

    // Keep only last 100 audits per project
    if (records.length > 100) {
      records.pop();
    }

    return audit;
  }

  async getByProjectId(projectId) {
    return this.audits.get(projectId) || [];
  }

  async getByJobId(jobId) {
    for (const audits of this.audits.values()) {
      const audit = audits.find(a => a.jobId === jobId);
      if (audit) return audit;
    }
    return null;
  }

  async getLatestByProjectId(projectId) {
    const records = this.audits.get(projectId);
    return records?.[0] || null;
  }
}

export const auditStorage = new AuditStorage();