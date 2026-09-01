import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as WorkerPrismaClient } from '@cana/prisma-worker/wasm';

export declare function createRequestScopedPrismaProxy(options: {
  getContext: () => object;
  PrismaClient: typeof WorkerPrismaClient;
  PrismaPg: typeof PrismaPg;
  nodeEnv: string | undefined;
}): WorkerPrismaClient;
