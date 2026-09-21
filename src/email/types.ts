/** Shapes shared between the email parser, the vlayer client and the server. */

/** Prover input for `ProofInvoiceProver.main` (all of it stays private). */
export interface UnverifiedEmail {
  /** Full raw MIME source of the email. */
  mimeEmail: string;
  /** Address of the deployed ProofInvoiceProver. */
  proverAddress: `0x${string}`;
}
