/**
 * In-memory grant KPI instrumentation.
 *
 * Counters only — no personal information, no email content, no identifiers
 * beyond hashed issuer domains / invoice ids (which is also all the chain
 * ever sees). Reset on process restart; `GET /api/metrics` exposes the JSON
 * and `node scripts/export-metrics.mjs` writes it to a file.
 */

export interface MetricsSnapshot {
  proof_attempts: number;
  proofs_generated: number;
  proofs_failed: number;
  onchain_verifications: number;
  invoices_verified: number;
  issuer_domains: number;
  avg_proof_ms: number | null;
}

class MetricsStore {
  private proofAttempts = 0;
  private proofsGenerated = 0;
  private proofsFailed = 0;
  private onchainVerifications = 0;
  private readonly verifiedInvoiceIds = new Set<string>();
  private readonly issuerDomains = new Set<string>();
  private proofDurationsMs: number[] = [];

  recordProofAttempt(): void {
    this.proofAttempts += 1;
  }

  recordProofSuccess(invoiceIdHash: string, issuerDomainHash: string, durationMs: number): void {
    this.proofsGenerated += 1;
    this.verifiedInvoiceIds.add(invoiceIdHash);
    this.issuerDomains.add(issuerDomainHash);
    this.proofDurationsMs.push(durationMs);
  }

  recordProofFailure(): void {
    this.proofsFailed += 1;
  }

  recordOnchainVerification(): void {
    this.onchainVerifications += 1;
  }

  snapshot(): MetricsSnapshot {
    const durations = this.proofDurationsMs;
    const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    return {
      proof_attempts: this.proofAttempts,
      proofs_generated: this.proofsGenerated,
      proofs_failed: this.proofsFailed,
      onchain_verifications: this.onchainVerifications,
      invoices_verified: this.verifiedInvoiceIds.size,
      issuer_domains: this.issuerDomains.size,
      avg_proof_ms: avg === null ? null : Math.round(avg),
    };
  }
}

const globalForMetrics = globalThis as unknown as { __proofInvoiceMetrics?: MetricsStore };
export const metrics: MetricsStore = globalForMetrics.__proofInvoiceMetrics ?? new MetricsStore();
globalForMetrics.__proofInvoiceMetrics = metrics;
