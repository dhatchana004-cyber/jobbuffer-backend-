import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('123456', 10);
  
  // 1. Admin account
  await prisma.user.upsert({
    where: { email: 'admin@mail.com' },
    update: {
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    create: {
      name: 'System Admin',
      email: 'admin@mail.com',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  // 2. Default Recruiter account
  const recruiterUser = await prisma.user.upsert({
    where: { email: 'recruiter@jobuffer.com' },
    update: {
      passwordHash,
      role: 'RECRUITER',
      status: 'ACTIVE',
    },
    create: {
      name: 'JoBuffer Recruiter',
      email: 'recruiter@jobuffer.com',
      passwordHash,
      role: 'RECRUITER',
      status: 'ACTIVE',
    },
  });

  // Ensure recruiter has company & recruiter profile
  const existingCompany = await prisma.company.findFirst({
    where: { name: 'JoBuffer Enterprise Talent' }
  });
  const company = existingCompany || await prisma.company.create({
    data: {
      name: 'JoBuffer Enterprise Talent',
      industry: 'Technology',
      size: '50-200 employees',
      headquarters: 'Chennai, India'
    }
  });

  await prisma.recruiterProfile.upsert({
    where: { userId: recruiterUser.id },
    update: {
      companyId: company.id,
      designation: 'Senior Talent Acquisition Lead'
    },
    create: {
      userId: recruiterUser.id,
      companyId: company.id,
      designation: 'Senior Talent Acquisition Lead'
    }
  });

  console.log('Seed completed: Admin and Recruiter users created/verified');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
