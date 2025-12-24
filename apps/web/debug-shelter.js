
const { PrismaClient } = require('@jp-evac/db');
const prisma = new PrismaClient();

async function main() {
    const site = await prisma.evac_sites.findFirst({
        where: { address: { not: null } },
        select: { id: true, name: true, address: true, pref_city: true }
    });
    console.log(JSON.stringify(site, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
