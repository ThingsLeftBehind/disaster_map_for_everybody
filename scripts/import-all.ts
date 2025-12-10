import 'dotenv/config';
import { runImport } from '@jp-evac/importer';
import { prisma } from '@jp-evac/db';

async function main() {
  await runImport();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
