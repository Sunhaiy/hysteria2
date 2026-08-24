import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminPermission } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_PERMISSION_KEY } from './admin-permission.decorator';
import type { SessionPrincipal } from './auth.types';

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const permission = this.reflector.getAllAndOverride<AdminPermission>(
      ADMIN_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) return true;
    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: SessionPrincipal }>();
    if (!request.principal || request.principal.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
    const grant = await this.prisma.adminPermissionGrant.findUnique({
      where: {
        userId_permission: {
          userId: request.principal.sub,
          permission,
        },
      },
      select: { id: true },
    });
    if (!grant) throw new ForbiddenException('Admin permission required');
    return true;
  }
}
