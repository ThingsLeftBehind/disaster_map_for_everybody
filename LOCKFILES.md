# Locked Files (By Policy)

The files below are **locked by policy** to protect the ingestion pipeline and DB integrity.

Do not edit them in routine feature work.

## Locked
- `packages/db/prisma/schema.prisma`
- `packages/importer/src/index.ts`

## If a change is required (must have a written plan)
1. Reason: what is broken or missing?
2. Impact analysis: data model, importer behavior, runtime impact, and migration needs.
3. Dry run validation: how to validate without risking prod data.
4. Rollback plan: how to revert cleanly.
5. Coordination: owner sign-off and timing.

