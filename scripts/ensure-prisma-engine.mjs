import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const engineFile = 'libquery_engine-rhel-openssl-3.0.x.so.node';

const candidates = [
  path.join(rootDir, 'packages/db/node_modules/@prisma/client', engineFile),
  path.join(rootDir, 'packages/db/node_modules/.prisma/client', engineFile),
  path.join(rootDir, 'node_modules/prisma', engineFile),
];

const destinations = [
  path.join(rootDir, 'apps/web/node_modules/@prisma/client', engineFile),
  path.join(rootDir, 'apps/web/.prisma/client', engineFile),
];

async function findFirstExisting(paths) {
  for (const candidate of paths) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return null;
}

const source = await findFirstExisting(candidates);

if (!source) {
  console.error(
    `Prisma engine not found. Checked:\n${candidates.map((p) => `- ${p}`).join('\n')}`,
  );
  process.exit(1);
}

await Promise.all(
  destinations.map(async (dest) => {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(source, dest);
  }),
);
