/**
 * Canonical ToneDeck preset & profile schemas.
 *
 * Presets are the source of truth (JSON on disk); CamillaDSP YAML is a
 * generated artifact (see camillayaml.ts). The `gain`/`q`/`freq`/`preamp`
 * bounds here are *schema sanity* limits — they reject nonsense. The tighter,
 * per-device "house" limits live in the profile and are enforced by safety.ts.
 */
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

export const BandTypeSchema = z.enum(['lowshelf', 'peaking', 'highshelf'])
export type BandType = z.infer<typeof BandTypeSchema>

export const BandSchema = z.object({
  id: z.string().min(1),
  type: BandTypeSchema,
  freq: z.number().min(20).max(20000),
  q: z.number().min(0.3).max(5),
  gain: z.number().min(-24).max(24),
})
export type Band = z.infer<typeof BandSchema>

export const ProvenanceHistoryEntrySchema = z.object({
  at: z.string().datetime(),
  change: z.string(),
  reason: z.string(),
})
export type ProvenanceHistoryEntry = z.infer<typeof ProvenanceHistoryEntrySchema>

export const ProvenanceSchema = z.object({
  createdBy: z.enum(['claude', 'user', 'builtin']),
  model: z.string().optional(),
  history: z.array(ProvenanceHistoryEntrySchema).default([]),
})
export type Provenance = z.infer<typeof ProvenanceSchema>

export const ArtworkSchema = z.object({
  itunesCollectionId: z.number().optional(),
  url: z.string().optional(),
  cachedFile: z.string().optional(),
})
export type Artwork = z.infer<typeof ArtworkSchema>

const bandsHaveUniqueIds = (bands: Band[]) =>
  new Set(bands.map((b) => b.id)).size === bands.length

export const PresetSchema = z.object({
  schemaVersion: z.literal(1),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase alphanumeric with hyphens')
    .max(64),
  kind: z.enum(['album', 'track', 'genre', 'mood']),
  title: z.string().min(1),
  artist: z.string().optional(),
  profile: z.string(),
  preamp: z.number().min(-24).max(24),
  bands: z
    .array(BandSchema)
    .min(1)
    .refine(bandsHaveUniqueIds, { message: 'band ids must be unique' }),
  intent: z.string(),
  notes: z.string().optional(),
  provenance: ProvenanceSchema,
  artwork: ArtworkSchema.optional(),
  version: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Preset = z.infer<typeof PresetSchema>

export const LimitsSchema = z.object({
  bandGainDb: z.tuple([z.number(), z.number()]),
  preampDb: z.tuple([z.number(), z.number()]),
  q: z.tuple([z.number(), z.number()]),
  freqHz: z.tuple([z.number(), z.number()]),
  clipHeadroomDb: z.number(),
})
export type Limits = z.infer<typeof LimitsSchema>

export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  playbackDeviceName: z.string().min(1),
  captureDeviceName: z.string().default('BlackHole 2ch'),
  bandTemplate: z.array(BandSchema),
  limits: LimitsSchema,
  houseNotes: z.string(),
})
export type Profile = z.infer<typeof ProfileSchema>

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}

export function parsePreset(data: unknown): Preset {
  const result = PresetSchema.safeParse(data)
  if (!result.success) throw new Error(`Invalid preset: ${formatIssues(result.error)}`)
  return result.data
}

export function parseProfile(data: unknown): Profile {
  const result = ProfileSchema.safeParse(data)
  if (!result.success) throw new Error(`Invalid profile: ${formatIssues(result.error)}`)
  return result.data
}

/** Plain JSON-Schema for PresetSchema (future MCP tool schema). */
export function presetJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(PresetSchema) as Record<string, unknown>
}

/** Plain JSON-Schema for ProfileSchema (future MCP tool schema). */
export function profileJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(ProfileSchema) as Record<string, unknown>
}
