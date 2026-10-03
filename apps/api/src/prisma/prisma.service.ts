import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { InjectConfig } from '../config/config.module.js';
import type { AppConfig } from '../config/env.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(@InjectConfig() config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        connectionTimeoutMillis: 5_000,
      }),
    });
  }

  /** The last shutdown phase: the worker finishes its jobs in `beforeApplicationShutdown`. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
