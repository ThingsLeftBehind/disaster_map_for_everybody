import { prisma } from '@jp-evac/db'; async function main(){ const c = await prisma.evac_sites.count(); console.log('TOTAL:', c); await prisma.(); } main();
