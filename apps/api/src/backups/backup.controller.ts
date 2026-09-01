import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { AdminGuard } from '../common/admin.guard';
import type { SessionPrincipal } from '../common/auth.types';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { BackupService, backupRootDirectory } from './backup.service';
import { RestoreBackupDto } from './backup.dto';

const uploadStorage = diskStorage({
  destination: (_request, _file, callback) => {
    const directory = join(backupRootDirectory(), '.uploads');
    mkdirSync(directory, { recursive: true });
    callback(null, directory);
  },
  filename: (_request, _file, callback) => {
    callback(null, `${Date.now()}-${randomUUID()}.upload`);
  },
});

@Controller('api/admin/backups')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  overview() {
    return this.backups.overview();
  }

  @Post()
  create() {
    return this.backups.createBackup('manual');
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: {
        files: 1,
        fileSize: Number(process.env.BACKUP_UPLOAD_MAX_BYTES) || 8 * 1024 ** 3,
      },
    }),
  )
  import(@UploadedFile() file?: Express.Multer.File) {
    return this.backups.importArchive(file);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() response: Response) {
    const backup = await this.backups.resolveDownload(id);
    response.setHeader('Cache-Control', 'no-store');
    response.download(backup.path, basename(backup.filename));
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.ACCEPTED)
  requestRestore(
    @Param('id') id: string,
    @Body() _body: RestoreBackupDto,
    @CurrentPrincipal() principal: SessionPrincipal,
  ) {
    return this.backups.requestRestore(id, principal.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.backups.deleteBackup(id);
  }
}
