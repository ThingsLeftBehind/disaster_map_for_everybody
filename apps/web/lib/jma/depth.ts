import {
  normalizeQuakeDepthKm as normalizeQuakeDepthKmImpl,
  formatQuakeDepth as formatQuakeDepthImpl,
} from './depth-core.mjs';

export const normalizeQuakeDepthKm: (raw: unknown) => number | null =
  normalizeQuakeDepthKmImpl as (raw: unknown) => number | null;

export const formatQuakeDepth: (raw: unknown, unknownLabel?: string) => string =
  formatQuakeDepthImpl as (raw: unknown, unknownLabel?: string) => string;
