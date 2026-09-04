import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CheckoutDto, CommerceRedeemDto } from '../commerce/commerce.dto';
import type { CheckoutInput } from '../commerce/commerce.service';
import { CurrentPrincipal } from '../common/current-principal.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { SessionPrincipal } from '../common/auth.types';
import {
  PurchasePlanDto,
  PurchaseTrafficPackDto,
  AcknowledgeAnnouncementDto,
  RedeemCodeDto,
  RequestPlanOrderDto,
} from '../contracts/http.dto';
import { SettingsService } from '../settings/settings.service';
import { AnniversaryGiftService } from './anniversary-gift.service';
import { PortalService } from './portal.service';

@Controller('api/portal')
@UseGuards(JwtAuthGuard)
export class PortalController {
  constructor(
    private readonly portalService: PortalService,
    private readonly settings: SettingsService,
    private readonly anniversaryGift: AnniversaryGiftService,
  ) {}

  @Get('anniversary-gift')
  getAnniversaryGift(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.anniversaryGift.getStatus(principal.sub);
  }

  @Post('anniversary-gift/claim')
  claimAnniversaryGift(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.anniversaryGift.claim(principal.sub);
  }

  @Get('announcement')
  async getAnnouncement(@CurrentPrincipal() principal: SessionPrincipal) {
    return {
      announcement: await this.settings.getPendingAnnouncement(principal.jti),
    };
  }

  @Get('announcement/current')
  async getCurrentAnnouncement() {
    return {
      announcement: await this.settings.getPublishedAnnouncement(),
    };
  }

  @Post('announcement/acknowledge')
  acknowledgeAnnouncement(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: AcknowledgeAnnouncementDto,
  ) {
    return this.settings.acknowledgeAnnouncement(principal.jti, body.version);
  }

  @Get('subscription')
  getSubscription(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.portalService.getSubscription(principal.sub);
  }

  @Get('plans')
  getPlans() {
    return this.portalService.getPlans();
  }

  @Get('traffic-pack-products')
  getTrafficPackProducts() {
    return this.portalService.getTrafficPackProducts();
  }

  @Get('branding')
  getBranding() {
    return this.portalService.getBranding();
  }

  @Get('usage')
  getUsage(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.portalService.getUsage(principal.sub);
  }

  @Get('orders')
  getOrders(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.portalService.getOrders(principal.sub);
  }

  @Get('access')
  getAccess(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.portalService.getAccess(principal.sub);
  }

  @Post('orders/request')
  requestPlanOrder(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: RequestPlanOrderDto,
  ) {
    return this.portalService.createPlanOrderRequest(
      principal.sub,
      body.planId,
      body.note,
    );
  }

  @Post('redeem')
  redeemCode(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: RedeemCodeDto,
  ) {
    return this.portalService.redeemCode(
      principal.sub,
      body.code,
      body.expectedTrafficPackProductId,
    );
  }

  @Get('wallet')
  getWallet(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.portalService.getWallet(principal.sub);
  }

  @Post('purchase/quote')
  quotePurchase(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: PurchasePlanDto,
  ) {
    return this.portalService.quotePurchase(
      principal.sub,
      body.planId,
      body.discountCode,
    );
  }

  @Post('purchase')
  purchase(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: PurchasePlanDto,
    @Headers('idempotency-key') idempotencyKey = '',
  ) {
    return this.portalService.purchase(
      principal.sub,
      body.planId,
      body.discountCode,
      idempotencyKey,
    );
  }

  @Post('traffic-pack-purchase/quote')
  quoteTrafficPackPurchase(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: PurchaseTrafficPackDto,
  ) {
    return this.portalService.quoteTrafficPackPurchase(
      principal.sub,
      body.productId,
      body.discountCode,
    );
  }

  @Post('traffic-pack-purchase')
  purchaseTrafficPack(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: PurchaseTrafficPackDto,
    @Headers('idempotency-key') idempotencyKey = '',
  ) {
    return this.portalService.purchaseTrafficPack(
      principal.sub,
      body.productId,
      body.discountCode,
      idempotencyKey,
    );
  }

  @Post('commerce/quote')
  quoteCheckout(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: CheckoutDto,
  ) {
    return this.portalService.quoteCheckout(
      principal.sub,
      this.toCheckoutInput(body),
    );
  }

  @Post('commerce/checkout')
  checkout(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: CheckoutDto,
    @Headers('idempotency-key') idempotencyKey = '',
  ) {
    return this.portalService.checkout(
      principal.sub,
      this.toCheckoutInput(body),
      idempotencyKey,
    );
  }

  @Post('commerce/redeem')
  redeem(
    @CurrentPrincipal() principal: SessionPrincipal,
    @Body() body: CommerceRedeemDto,
  ) {
    return this.portalService.redeemCode(
      principal.sub,
      body.code,
      body.expectedTrafficPackProductId,
    );
  }

  private toCheckoutInput(body: CheckoutDto): CheckoutInput {
    if (body.offerId) {
      return { offerId: body.offerId, discountCode: body.discountCode };
    }
    if (!body.kind || !body.productId) {
      throw new BadRequestException(
        'offerId or legacy kind + productId is required',
      );
    }
    return {
      kind: body.kind,
      productId: body.productId,
      discountCode: body.discountCode,
    };
  }
}
