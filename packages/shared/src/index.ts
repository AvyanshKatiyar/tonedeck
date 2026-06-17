/**
 * @tonedeck/shared — schema, DSP math, safety rails, vibe mappings, and the
 * CamillaDSP YAML emitter. The foundation every other ToneDeck component
 * (daemon, CLI, UI, Claude skill) derives from.
 */

export const VERSION = '0.1.0'

export * from './preset.js'
export * from './slug.js'
export * from './biquad.js'
export * from './safety.js'
export * from './vibes.js'
export * from './camillayaml.js'
export * from './catalog.js'
export * from './cluster.js'
