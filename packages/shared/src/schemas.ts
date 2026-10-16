import { z } from 'zod';

// Extension pages forbid eval (MV3 CSP); keep Zod off its JIT path everywhere.
z.config({ jitless: true });

/**
 * Zod schemas for every message that crosses a trust boundary:
 *   content script <-> side panel, side panel <-> proxy, proxy <-> model.
 * Objects are strict: unknown keys (e.g. "selector", "script") are rejected.
 */

export const FIELD_ID_RE = /^f_[a-z0-9]{6,32}$/;
export const MEMORY_KEY_RE = /^[a-z][a-z0-9_]{0,47}$/;

export const FieldIdSchema = z.string().regex(FIELD_ID_RE, 'invalid field id');
export const MemoryKeySchema = z.string().regex(MEMORY_KEY_RE, 'invalid memory key');

export const FieldKindSchema = z.enum([
  'text',
  'email',
  'tel',
  'url',
  'number',
  'date',
  'textarea',
  'select',
  'radio',
  'checkbox',
]);

export const RiskCategorySchema = z.enum(['green', 'amber', 'red', 'gray']);

export const FieldOptionSchema = z.strictObject({
  value: z.string().max(200),
  label: z.string().max(200),
});

/** A field as reported by the content script (no values, no selectors). */
export const ScannedFieldSchema = z.strictObject({
  id: FieldIdSchema,
  kind: FieldKindSchema,
  label: z.string().max(200),
  hint: z.string().max(120),
  section: z.string().max(120),
  autocomplete: z.string().max(60),
  required: z.boolean(),
  multiple: z.boolean(),
  maxLength: z.number().int().positive().optional(),
  options: z.array(FieldOptionSchema).max(100),
  /** Only computed for non-red fields. The value itself is never reported. */
  hasExistingValue: z.boolean(),
  risk: RiskCategorySchema,
  riskReason: z.string().max(200),
  rule: z.string().max(60),
});

export const ScanResultSchema = z.strictObject({
  scanId: z.string().regex(/^s_[a-z0-9]{6,32}$/),
  origin: z.string().max(300),
  fields: z.array(ScannedFieldSchema).max(300),
  stats: z.strictObject({
    ignoredHiddenOrDisabled: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// AI mapping contract
// ---------------------------------------------------------------------------

/** What the model is allowed to see about one field. */
export const AIFieldSchema = z.strictObject({
  id: FieldIdSchema,
  label: z.string().max(200),
  type: FieldKindSchema,
  hint: z.string().max(120).default(''),
  section: z.string().max(120).default(''),
  required: z.boolean().default(false),
  options: z.array(z.string().max(200)).max(100).default([]),
});

export const MemoryKeyDescriptorSchema = z.strictObject({
  key: MemoryKeySchema,
  description: z.string().max(160),
  /** false = catalog key the user has not filled in yet (app will ask). */
  hasValue: z.boolean(),
});

export const FieldMappingRequestSchema = z.strictObject({
  fields: z.array(AIFieldSchema).min(1).max(150),
  availableMemoryKeys: z.array(MemoryKeyDescriptorSchema).max(120),
});

export const MappingActionSchema = z.enum(['use_memory', 'draft', 'ask_user', 'skip']);
export const TransformSchema = z.enum(['none', 'first_name', 'last_name']);

export const FieldMappingSchema = z.strictObject({
  fieldId: z.string().max(40),
  action: MappingActionSchema,
  memoryKey: z.string().max(48).nullable().default(null),
  transform: TransformSchema.default('none'),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300).default(''),
});

export const FieldMappingResponseSchema = z.strictObject({
  mappings: z.array(FieldMappingSchema).max(300),
});

export const DraftFactSchema = z.strictObject({
  key: MemoryKeySchema,
  label: z.string().max(80),
  value: z.string().max(1000),
});

export const DraftRequestSchema = z.strictObject({
  fieldId: FieldIdSchema,
  question: z.string().min(1).max(300),
  maxLength: z.number().int().min(50).max(4000).default(800),
  facts: z.array(DraftFactSchema).max(15),
});

export const DraftResponseSchema = z.strictObject({
  draft: z.string().max(4000),
  usedKeys: z.array(z.string().max(48)).max(15).default([]),
  missingFacts: z.array(z.string().max(120)).max(10).default([]),
});

// ---------------------------------------------------------------------------
// Side panel <-> content script messages
// ---------------------------------------------------------------------------

export const FillInstructionSchema = z.strictObject({
  fieldId: FieldIdSchema,
  /** Text value, a single option value, or several option values for checkbox groups. */
  value: z.union([z.string().max(4000), z.array(z.string().max(200)).max(50)]),
  allowOverwrite: z.boolean(),
});

export const ContentRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('CF_PING') }),
  z.strictObject({ type: z.literal('CF_SCAN') }),
  z.strictObject({
    type: z.literal('CF_FILL'),
    scanId: z.string().max(40),
    origin: z.string().max(300),
    fills: z.array(FillInstructionSchema).max(300),
  }),
  z.strictObject({ type: z.literal('CF_CLEAR_HIGHLIGHTS') }),
]);

export const FillResultSchema = z.strictObject({
  fieldId: z.string().max(40),
  status: z.enum(['filled', 'skipped', 'failed']),
  reason: z.string().max(200),
});

export const FillResponseSchema = z.strictObject({
  ok: z.boolean(),
  error: z.string().max(300).optional(),
  results: z.array(FillResultSchema).max(300),
});

export const PingResponseSchema = z.strictObject({ ok: z.literal(true), version: z.string() });

export type FieldOption = z.infer<typeof FieldOptionSchema>;
export type ScannedField = z.infer<typeof ScannedFieldSchema>;
export type ScanResult = z.infer<typeof ScanResultSchema>;
export type AIField = z.input<typeof AIFieldSchema>;
export type MemoryKeyDescriptor = z.infer<typeof MemoryKeyDescriptorSchema>;
export type FieldMappingRequest = z.input<typeof FieldMappingRequestSchema>;
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type FieldMappingResponse = z.infer<typeof FieldMappingResponseSchema>;
export type DraftFact = z.infer<typeof DraftFactSchema>;
export type DraftRequest = z.input<typeof DraftRequestSchema>;
export type DraftResponse = z.infer<typeof DraftResponseSchema>;
export type FillInstruction = z.infer<typeof FillInstructionSchema>;
export type ContentRequest = z.infer<typeof ContentRequestSchema>;
export type FillResult = z.infer<typeof FillResultSchema>;
export type FillResponse = z.infer<typeof FillResponseSchema>;
export type MappingAction = z.infer<typeof MappingActionSchema>;
export type Transform = z.infer<typeof TransformSchema>;
