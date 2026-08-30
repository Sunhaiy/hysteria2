import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SecretCipherService } from './secret-cipher.service';

const secretSettingKeys = [
  'smtp.pass',
  'oauth.google.secret',
  'oauth.github.secret',
  'epay.merchantKey',
];

@Injectable()
export class SecretMigrationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipherService,
  ) {}

  async onModuleInit() {
    if (
      !this.cipher.enabled ||
      process.env.SECRET_MIGRATION_ENABLED !== 'true'
    ) {
      return;
    }
    const [settings, nodes] = await Promise.all([
      this.prisma.setting.findMany({
        where: { key: { in: secretSettingKeys } },
      }),
      this.prisma.node.findMany({
        select: { id: true, trafficApiSecret: true },
      }),
    ]);
    await this.prisma.$transaction([
      ...settings.map((setting) =>
        this.prisma.setting.update({
          where: { key: setting.key },
          data: { value: this.cipher.encrypt(setting.value) },
        }),
      ),
      ...nodes.map((node) =>
        this.prisma.node.update({
          where: { id: node.id },
          data: {
            trafficApiSecret: this.cipher.encrypt(node.trafficApiSecret),
          },
        }),
      ),
    ]);
  }
}

export { secretSettingKeys };
