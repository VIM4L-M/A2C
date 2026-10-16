/**
 * Core domain types shared by the extension, the inference proxy and tests.
 * Runtime validation lives in schemas.ts; these types are inferred from it
 * where the data crosses a trust boundary.
 */

/** Deterministic risk category assigned locally before any AI call. */
export type RiskCategory = 'green' | 'amber' | 'red' | 'gray';

export type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox';

/** Raw, local-only signals used to classify a field. Never sent to the model. */
export interface FieldSignals {
  kind: FieldKind | 'unsupported';
  inputType?: string;
  autocomplete?: string;
  name?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  ariaDescription?: string;
  nearbyText?: string;
  inputMode?: string;
  maxLength?: number;
  optionLabels?: string[];
}

export interface Classification {
  risk: RiskCategory;
  reason: string;
  rule: string;
}

export type MemoryPermission = 'auto' | 'ask' | 'never';
export type MemorySensitivity = 'standard' | 'private';
export type MemoryCategory = 'identity' | 'contact' | 'education' | 'work' | 'links' | 'skills' | 'other';
export type ProvenanceSource = 'manual' | 'onboarding' | 'form_approved' | 'document_approved';

export interface MemoryFact {
  key: string;
  label: string;
  value: string;
  category: MemoryCategory;
  permission: MemoryPermission;
  sensitivity: MemorySensitivity;
  /** Domains where an "ask" fact may be pre-approved (site allowlist). */
  allowedSites: string[];
  provenance: {
    source: ProvenanceSource;
    /** Domain only (no path / query) when the fact was learned from a form. */
    domain?: string;
    createdAt: string;
    updatedAt: string;
  };
}

/** Status of one field in the review list. */
export type FillStatus =
  | 'ready'
  | 'review'
  | 'missing'
  | 'blocked'
  | 'unsupported'
  | 'skipped'
  | 'completed'
  | 'failed';

export type MappingSource = 'gemma' | 'specialist' | 'mock' | 'rules' | 'user';

export type AIMode = 'gemma' | 'mock';
