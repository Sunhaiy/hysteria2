import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionPrincipal } from './auth.types';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionPrincipal => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: SessionPrincipal }>();
    return request.principal as SessionPrincipal;
  },
);
