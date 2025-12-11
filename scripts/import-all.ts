import 'dotenv/config';
import { runImport } from '@jp-evac/importer';
import { prisma } from '@jp-evac/db';
import path from 'path';

async function main() {
  const baseDir = path.resolve(process.cwd(), 'data');
  const evacSpaceFile = path.resolve(baseDir, 'evacuation_space_all.csv');
  const evacShelterFile = path.resolve(baseDir, 'evacuation_shelter_all.csv');

  await runImport({
    evacSpaceFile,
    evacShelterFile,
  });
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
