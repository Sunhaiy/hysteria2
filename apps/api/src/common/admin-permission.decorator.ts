import { SetMetadata } from '@nestjs/common';
import type { AdminPermission } from '@prisma/client';

export const ADMIN_PERMISSION_KEY = 'admin_permission';
export const RequireAdminPermission = (permission: AdminPermission) =>
  SetMetadata(ADMIN_PERMISSION_KEY, permission);
