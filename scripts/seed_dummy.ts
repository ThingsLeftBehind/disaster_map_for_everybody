
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const commonId = 'dummy-itabashi-001';
    console.log('Seeding dummy data...');

    await prisma.evac_sites.upsert({
        where: { common_id: commonId },
        update: {
            pref_code: '13',
            muni_code: '13119',
            pref_city: '東京都板橋区',
            name: '板橋区役所（ダミー）',
            address: '東京都板橋区板橋2-66-1',
        },
        create: {
            common_id: commonId,
            name: '板橋区役所（ダミー）',
            address: '東京都板橋区板橋2-66-1',
            lat: 35.7508,
            lon: 139.7082,
            pref_city: '東京都板橋区',
            hazards: { flood: false, landslide: false },
            is_same_address_as_shelter: false,
            pref_code: '13',
            muni_code: '13119',
        },
    });

    console.log('Dummy data seeded.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
