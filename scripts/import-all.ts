import 'dotenv/config';
import { prisma } from '@jp-evac/db';
import { runImport } from '@jp-evac/importer';

async function main() {
  await runImport();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
