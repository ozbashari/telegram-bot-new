import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForDb = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
};

// Create a connection pool only once and reuse it across compilations in development
const pool = globalForDb.pool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
});

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool;
}

const adapter = new PrismaPg(pool);

export const prisma =
  globalForDb.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : [],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.prisma = prisma;
}
