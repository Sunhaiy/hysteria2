import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionPrincipal } from '../common/auth.types';
import { AdminGuard } from '../common/admin.guard';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { PageQuery } from '../common/pagination';
import {
  CreateSupportTicketDto,
  ReplySupportTicketDto,
  UpdateSupportTicketDto,
} from './tickets.dto';
import { TicketsService, type SupportTicketQuery } from './tickets.service';

@Controller('api/portal/tickets')
@UseGuards(JwtAuthGuard)
export class PortalTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Query() query: SupportTicketQuery,
  ) {
    return this.tickets.listMember(principal.sub, query);
  }

  @Post()
  create(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: CreateSupportTicketDto,
  ) {
    return this.tickets.create(principal.sub, body);
  }

  @Get(':id')
  detail(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('id') id: string,
    @Query() query: PageQuery,
  ) {
    return this.tickets.detailMember(principal.sub, id, query);
  }

  @Post(':id/messages')
  reply(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('id') id: string,
    @Body() body: ReplySupportTicketDto,
  ) {
    return this.tickets.replyMember(principal.sub, id, body.body);
  }
}

@Controller('api/admin/tickets')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@Query() query: SupportTicketQuery) {
    return this.tickets.listAdmin(query);
  }

  @Get(':id')
  detail(@Param('id') id: string, @Query() query: PageQuery) {
    return this.tickets.detailAdmin(id, query);
  }

  @Post(':id/messages')
  reply(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('id') id: string,
    @Body() body: ReplySupportTicketDto,
  ) {
    return this.tickets.replyAdmin(principal.sub, id, body.body);
  }

  @Patch(':id')
  update(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Param('id') id: string,
    @Body() body: UpdateSupportTicketDto,
  ) {
    return this.tickets.updateStatus(principal.sub, id, body);
  }
}
