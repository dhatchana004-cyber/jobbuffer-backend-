import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import app from './app';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

const PORT = process.env.PORT || 5008;

async function bootstrap() {
  try {
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    server.on('error', (err: any) => {
      console.error(`❌ Server listen error on port ${PORT}:`, err);
    });

    // Test DB Connection
    try {
      await prisma.$connect();
      console.log('✅ Database connected successfully');
    } catch (dbError) {
      console.error('⚠️ Database connection warning:', dbError);
    }
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();
