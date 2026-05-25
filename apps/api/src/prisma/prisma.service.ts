import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const databaseUrl =
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/hysteria2';

    super({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });
  }

  get enabled() {
    return true;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
