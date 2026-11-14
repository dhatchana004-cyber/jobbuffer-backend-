import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import app from './app';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

const PORT = Number(process.env.PORT) || 5008;
const SECONDARY_PORT = PORT === 5008 ? 5000 : 5008;

async function bootstrap() {
  try {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Primary server running on port ${PORT}`);
    });

    server.on('error', (err: any) => {
      console.error(`❌ Primary server listen error on port ${PORT}:`, err);
    });

    // Dual-port listener: also listen on secondary port (5000/5008) for backward compatibility
    if (SECONDARY_PORT !== PORT) {
      try {
        const secondaryServer = app.listen(SECONDARY_PORT, '0.0.0.0', () => {
          console.log(`⚡ Secondary compatibility listener running on port ${SECONDARY_PORT}`);
        });
        secondaryServer.on('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`ℹ️ Secondary port ${SECONDARY_PORT} already in use, primary port ${PORT} active.`);
          } else {
            console.warn(`⚠️ Secondary listener warning on port ${SECONDARY_PORT}:`, err.message);
          }
        });
      } catch (secErr) {
        console.warn(`⚠️ Could not bind secondary port ${SECONDARY_PORT}:`, secErr);
      }
    }

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
