import { Global, Module } from '@nestjs/common';
import { SecretCipherService } from './secret-cipher.service';
import { SecretMigrationService } from './secret-migration.service';

@Global()
@Module({
  providers: [SecretCipherService, SecretMigrationService],
  exports: [SecretCipherService],
})
export class SecurityModule {}
