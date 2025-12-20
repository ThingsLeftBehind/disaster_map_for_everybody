import type { AtomEntry } from './types';
import { parseAtomFeed as parseAtomFeedImpl } from './atom-core.mjs';

export const parseAtomFeed: (xml: string) => { updated: string | null; entries: AtomEntry[] } =
  parseAtomFeedImpl as any;
