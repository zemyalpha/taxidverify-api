export type TaxIdType = "EIN" | "VAT" | "GST" | "ABN" | "GSTIN";
export type JobStatus = "pending" | "processing" | "complete" | "failed";
export type ApiKeyTier = "free" | "business" | "pro" | "enterprise";
export type BillingCycle = "monthly" | "annual";

export interface ValidationResult {
  job_id: string;
  status: JobStatus;
  valid: boolean;
  id: string;
  country: string;
  type: TaxIdType;
  format_normalized: string;
  registered?: boolean;
  business_name?: string;
  registered_address?: string;
  registration_date?: string;
  fraud_risk_score: number;
  data_source?: "live_vies" | "simulated";
  error?: string;
  checked_at: string;
}

export interface BatchItemInput {
  ref: string;
  id: string;
  country: string;
  type: TaxIdType;
}

export interface BatchResult {
  ref: string;
  valid: boolean;
  fraud_risk_score: number;
  data_source?: "live_vies" | "simulated";
  error?: string;
  registered?: boolean;
  business_name?: string;
}

export interface BatchJob {
  batch_id: string;
  status: JobStatus;
  count: number;
  completed: number;
  webhook_url?: string;
  created_at: string;
  results: BatchResult[];
}

export interface ApiKey {
  key_id: string;
  key_hash: string;
  tier: ApiKeyTier;
  daily_limit: number;
  daily_used: number;
  overage_used: number;
  reset_at: string;
  webhook_secret: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_cycle: BillingCycle;
  alert_threshold: number | null;
  alert_webhook_url: string | null;
  created_at: string;
}

export interface ValidateInput {
  id: string;
  country: string;
  type: TaxIdType;
}

export interface VerifyInput extends ValidateInput {
  webhook_url?: string;
}

// Hono context variable map — kept declaration-merging-friendly for the routes
declare module "hono" {
  interface ContextVariableMap {
    apiKey: ApiKey;
    rawKey: string;
    requestId: string;
  }
}
