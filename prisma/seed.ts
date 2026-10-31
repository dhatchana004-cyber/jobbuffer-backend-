import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('123456', 10);
  
  await prisma.user.upsert({
    where: { email: 'admin@mail.com' },
    update: {
      passwordHash,
    },
    create: {
      name: 'System Admin',
      email: 'admin@mail.com',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  console.log('Seed completed: Admin user created/verified');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
