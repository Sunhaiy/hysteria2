import { Equals, IsString } from 'class-validator';
import { RESTORE_CONFIRMATION } from './backup.types';

export class RestoreBackupDto {
  @IsString()
  @Equals(RESTORE_CONFIRMATION, {
    message: `confirmation must equal ${RESTORE_CONFIRMATION}`,
  })
  confirmation!: string;
}
