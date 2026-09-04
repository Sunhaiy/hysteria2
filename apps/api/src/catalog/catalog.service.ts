import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingPeriod,
  CatalogProductKind,
  CatalogProductSeries,
  CatalogProductStatus,
  Prisma,
  QuotaCadence,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateAccessProfileDto,
  CreatePlanOfferDto,
  UpdateAccessProfileDto,
  UpdateHomepageProductsDto,
  UpdatePlanOfferDto,
  SaveCatalogProductDto,
} from './catalog.dto';

const portalCatalogCacheKey = 'catalog:portal:v3';
const ultraAccessProfileId = 'catalog-ultra-shared';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getAdminCatalog() {
    const [plans, trafficPacks, accessProfiles, products, nodes] =
      await Promise.all([
        this.prisma.plan.findMany({
          include: {
            offers: {
              orderBy: [{ billingPeriod: 'asc' }, { priceCents: 'asc' }],
            },
            accessProfile: {
              include: {
                nodeBindings: {
                  include: { node: true },
                  orderBy: { priority: 'asc' },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.trafficPackProduct.findMany({
          include: { accessProfile: true },
          orderBy: [{ archivedAt: 'asc' }, { priceCents: 'asc' }],
        }),
        this.prisma.accessProfile.findMany({
          include: {
            nodeBindings: {
              where: { node: { retiredAt: null } },
              include: { node: true },
              orderBy: { priority: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.loadUnifiedProducts(),
        this.prisma.node.findMany({
          where: { retiredAt: null },
          include: { server: true },
          orderBy: [{ serverId: 'asc' }, { createdAt: 'asc' }],
        }),
      ]);
    return {
      products,
      plans: plans.map((plan) => ({
        id: plan.id,
        slug: plan.slug,
        name: plan.name,
        description: plan.description,
        active: plan.active,
        monthlyTrafficBytes: Number(plan.trafficBytes),
        accent: plan.accent,
        accessProfileId: plan.accessProfileId,
        accessProfile: plan.accessProfile
          ? this.presentAccessProfile(plan.accessProfile)
          : null,
        offers: plan.offers.map((offer) => this.presentOffer(offer)),
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
      })),
      trafficPacks: trafficPacks.map((product) => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description,
        active: product.active,
        trafficBytes: Number(product.trafficBytes),
        validityDays: product.validityDays,
        priceCents: product.priceCents,
        accent: product.accent,
        accessProfileId: product.accessProfileId,
        accessProfileName: product.accessProfile?.name ?? null,
        archivedAt: product.archivedAt?.toISOString() ?? null,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
      })),
      accessProfiles: accessProfiles.map((profile) =>
        this.presentAccessProfile(profile),
      ),
      servers: this.groupAvailableNodes(nodes),
    };
  }

  async getPortalCatalog(userId?: string) {
    const cached = await this.cache.get(portalCatalogCacheKey);
    let result: Awaited<ReturnType<CatalogService['buildPortalCatalog']>>;
    if (cached) {
      try {
        result = JSON.parse(cached) as Awaited<
          ReturnType<CatalogService['buildPortalCatalog']>
        >;
      } catch {
        await this.cache.del(portalCatalogCacheKey);
        result = await this.buildPortalCatalog();
        await this.cache.set(
          portalCatalogCacheKey,
          JSON.stringify(result),
          300,
        );
      }
    } else {
      result = await this.buildPortalCatalog();
      await this.cache.set(portalCatalogCacheKey, JSON.stringify(result), 300);
    }
    return userId ? this.addPurchaseEligibility(result, userId) : result;
  }

  async getPublicCatalog() {
    const catalog = await this.getPortalCatalog();
    return {
      products: catalog.products
        .filter((product) => product.kind === 'plan')
        .map((product) => ({
          id: product.id,
          slug: product.slug,
          name: product.name,
          description: product.description,
          accent: product.accent,
          featured: product.featured,
          homepageVisible: product.homepageVisible,
          series: (product.series ?? 'standard').toLowerCase(),
          quotaCadence: (product.quotaCadence ?? 'monthly_reset').toLowerCase(),
          purchaseLimitPerUser: product.purchaseLimitPerUser,
          trafficReset: product.trafficReset,
          access: {
            speedUpMbps: product.access.speedUpMbps,
            speedDownMbps: product.access.speedDownMbps,
            deviceLimit: product.access.deviceLimit,
            availableServerCount: product.access.servers.filter((server) =>
              server.nodes.some((node) => node.serviceable),
            ).length,
            availableNodeCount: product.access.servers.reduce(
              (count, server) =>
                count + server.nodes.filter((node) => node.serviceable).length,
              0,
            ),
          },
          offers: product.offers
            .filter((offer) => offer.active && !offer.archivedAt)
            .map((offer) => ({
              id: offer.id,
              name: offer.name,
              billingPeriod: offer.billingPeriod,
              intervalMonths: offer.intervalMonths,
              legacyDurationDays: offer.legacyDurationDays,
              trafficBytes: offer.trafficBytes,
              priceCents: offer.priceCents,
              currency: offer.currency,
              active: offer.active,
              isDefault: offer.isDefault,
              archivedAt: offer.archivedAt,
            })),
        })),
    };
  }

  private async buildPortalCatalog() {
    const catalog = await this.getAdminCatalog();
    const profiles = new Map(
      catalog.accessProfiles.map((profile) => [profile.id, profile]),
    );
    return {
      products: catalog.products
        .filter(
          (product) =>
            product.status === 'active' &&
            product.offers.some((offer) => offer.active && !offer.archivedAt) &&
            product.access.servers.some((server) =>
              server.nodes.some((node) => node.serviceable),
            ),
        )
        .map(({ defaultTrafficMultiplier, ...product }) => {
          void defaultTrafficMultiplier;
          return product;
        }),
      plans: catalog.plans
        .filter((plan) => plan.active)
        .map((plan) => ({
          ...plan,
          offers: plan.offers.filter(
            (offer) => offer.active && !offer.archivedAt,
          ),
        }))
        .filter(
          (plan) =>
            plan.accessProfile?.active &&
            plan.accessProfile.nodes.some((node) => node.active) &&
            plan.offers.length > 0,
        ),
      trafficPacks: catalog.trafficPacks.filter((pack) => {
        const profile = pack.accessProfileId
          ? profiles.get(pack.accessProfileId)
          : null;
        return (
          pack.active &&
          !pack.archivedAt &&
          (pack.validityDays === null || pack.validityDays > 0) &&
          Boolean(profile?.active) &&
          Boolean(profile?.nodes.some((node) => node.active))
        );
      }),
    };
  }

  async createProduct(input: SaveCatalogProductDto, actorId?: string) {
    const id = await this.prisma.$transaction(async (tx) => {
      const productId = randomUUID();
      const series = this.toProductSeries(input.series);
      const profile = await this.resolveProductAccessProfile(
        tx,
        input,
        productId,
        series,
        undefined,
        actorId,
      );
      const kind = this.toProductKind(input.kind);
      const defaultMultiplierBasisPoints = this.multiplierBasisPoints(
        input.defaultTrafficMultiplier,
      );
      const defaultOffer =
        input.offers.find((offer) => offer.isDefault) ?? input.offers[0];
      const primaryOffer =
        input.offers.find((offer) => offer.billingPeriod === 'monthly') ??
        defaultOffer;
      let legacyPlanId: string | undefined;
      let legacyTrafficPackProductId: string | undefined;
      const legacyOfferIds = new Map<BillingPeriod, string>();

      if (kind === CatalogProductKind.PLAN) {
        const plan = await tx.plan.create({
          data: {
            slug: `v2-${input.slug.trim()}`,
            name: input.name.trim(),
            description: input.description?.trim(),
            active: input.status === 'active',
            trafficBytes: BigInt(primaryOffer.trafficBytes),
            durationDays: 30,
            speedUpMbps: input.speedUpMbps,
            speedDownMbps: input.speedDownMbps,
            deviceLimit: profile.deviceLimit,
            priceCents: primaryOffer.priceCents,
            accent: input.accent ?? 'green',
            accessProfileId: profile.id,
          },
        });
        legacyPlanId = plan.id;
        for (const offer of input.offers) {
          const period = this.toBillingPeriod(offer.billingPeriod);
          const legacy = await tx.planOffer.create({
            data: {
              planId: plan.id,
              slug: `v2-${offer.slug.trim()}`,
              name: offer.name.trim(),
              active: offer.active,
              isDefault: offer.isDefault ?? offer === defaultOffer,
              billingPeriod: period,
              intervalMonths: this.intervalMonths(period),
              priceCents: offer.priceCents,
            },
          });
          legacyOfferIds.set(period, legacy.id);
        }
      } else {
        const product = await tx.trafficPackProduct.create({
          data: {
            slug: `v2-${input.slug.trim()}`,
            name: input.name.trim(),
            description: input.description?.trim(),
            active: input.status === 'active',
            trafficBytes: BigInt(defaultOffer.trafficBytes),
            validityDays: null,
            priceCents: defaultOffer.priceCents,
            accent: input.accent ?? 'teal',
            accessProfileId: profile.id,
          },
        });
        legacyTrafficPackProductId = product.id;
      }

      const product = await tx.catalogProduct.create({
        data: {
          id: productId,
          legacyPlanId,
          legacyTrafficPackProductId,
          slug: input.slug.trim(),
          kind,
          series,
          status: this.toProductStatus(input.status),
          name: input.name.trim(),
          description: input.description?.trim(),
          storeUrl: this.normalizeStoreUrl(input.storeUrl),
          quotaCadence:
            kind === CatalogProductKind.PLAN ||
            series === CatalogProductSeries.ULTRA
              ? QuotaCadence.MONTHLY_RESET
              : QuotaCadence.ONE_TIME,
          accessProfileId: profile.id,
          speedUpMbps:
            series === CatalogProductSeries.ULTRA ? 300 : input.speedUpMbps,
          speedDownMbps:
            series === CatalogProductSeries.ULTRA ? 300 : input.speedDownMbps,
          defaultTrafficMultiplierBasisPoints:
            series === CatalogProductSeries.ULTRA
              ? 10_000
              : defaultMultiplierBasisPoints,
          featured: input.featured ?? false,
          purchaseLimitPerUser:
            series === CatalogProductSeries.ULTRA
              ? null
              : input.purchaseLimitPerUser,
          purchaseLimitKey:
            series === CatalogProductSeries.ULTRA
              ? 'ultra-series'
              : input.purchaseLimitPerUser
                ? input.purchaseLimitKey?.trim() || input.slug.trim()
                : null,
          requiresActivePlan:
            kind === CatalogProductKind.TRAFFIC_PACK
              ? (input.requiresActivePlan ?? false)
              : false,
          referralEligible:
            kind === CatalogProductKind.PLAN
              ? (input.referralEligible ?? true)
              : false,
          accent:
            input.accent ??
            (kind === CatalogProductKind.PLAN ? 'green' : 'teal'),
          sortOrder: input.sortOrder ?? 0,
          offers: {
            create: input.offers.map((offer) => {
              const period = this.toBillingPeriod(offer.billingPeriod);
              return {
                legacyPlanOfferId: legacyOfferIds.get(period),
                slug: offer.slug.trim(),
                name: offer.name.trim(),
                billingPeriod: period,
                intervalMonths: this.intervalMonths(period),
                trafficBytes: BigInt(offer.trafficBytes),
                priceCents: offer.priceCents,
                storeUrl: this.normalizeStoreUrl(offer.storeUrl),
                active: offer.active,
                isDefault: offer.isDefault ?? offer === defaultOffer,
              };
            }),
          },
        },
      });
      return product.id;
    });
    await this.invalidatePortalCatalog();
    return this.getUnifiedProduct(id);
  }

  async updateHomepageProducts(input: UpdateHomepageProductsDto) {
    await this.prisma.$transaction(async (tx) => {
      const selected = input.productIds.length
        ? await tx.catalogProduct.findMany({
            where: {
              id: { in: input.productIds },
              kind: CatalogProductKind.PLAN,
              series: CatalogProductSeries.STANDARD,
              status: CatalogProductStatus.ACTIVE,
              systemManaged: false,
              offers: {
                some: {
                  active: true,
                  archivedAt: null,
                },
              },
            },
            select: { id: true },
          })
        : [];
      if (selected.length !== input.productIds.length) {
        throw new BadRequestException(
          'Homepage products must be purchasable active standard plans',
        );
      }

      await tx.catalogProduct.updateMany({
        where: { homepageVisible: true },
        data: { homepageVisible: false },
      });
      if (input.productIds.length) {
        await tx.catalogProduct.updateMany({
          where: { id: { in: input.productIds } },
          data: { homepageVisible: true },
        });
      }
    });
    await this.invalidatePortalCatalog();
    return this.getAdminCatalog();
  }

  async updateProduct(
    id: string,
    input: SaveCatalogProductDto,
    actorId?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.catalogProduct.findUnique({
        where: { id },
        include: {
          offers: true,
          legacyPlan: true,
          legacyTrafficPackProduct: true,
        },
      });
      if (!existing) throw new NotFoundException('Catalog product not found');
      if (existing.systemManaged) {
        throw new BadRequestException(
          'System-managed products cannot be edited',
        );
      }
      const kind = this.toProductKind(input.kind);
      const series = existing.series;
      if (
        input.series &&
        this.toProductSeries(input.series) !== existing.series
      ) {
        throw new BadRequestException('Product series cannot be changed');
      }
      if (existing.kind !== kind) {
        throw new BadRequestException('Product kind cannot be changed');
      }
      const profile = await this.resolveProductAccessProfile(
        tx,
        input,
        id,
        series,
        existing.accessProfileId,
        actorId,
      );
      const defaultMultiplierBasisPoints = this.multiplierBasisPoints(
        input.defaultTrafficMultiplier,
      );
      const defaultOffer =
        input.offers.find((offer) => offer.isDefault) ?? input.offers[0];
      const retainedIds: string[] = [];

      for (const offer of input.offers) {
        const period = this.toBillingPeriod(offer.billingPeriod);
        const current = offer.id
          ? existing.offers.find((item) => item.id === offer.id)
          : existing.offers.find((item) => item.billingPeriod === period);
        if (offer.id && !current) {
          throw new BadRequestException('Offer does not belong to product');
        }
        let legacyPlanOfferId = current?.legacyPlanOfferId ?? undefined;
        if (existing.legacyPlanId) {
          const legacyData = {
            name: offer.name.trim(),
            active: offer.active,
            isDefault: offer.isDefault ?? offer === defaultOffer,
            billingPeriod: period,
            intervalMonths: this.intervalMonths(period),
            priceCents: offer.priceCents,
            archivedAt: null,
          };
          if (legacyPlanOfferId) {
            await tx.planOffer.update({
              where: { id: legacyPlanOfferId },
              data: legacyData,
            });
          } else {
            const legacy = await tx.planOffer.create({
              data: {
                ...legacyData,
                planId: existing.legacyPlanId,
                slug: `v2-${offer.slug.trim()}`,
              },
            });
            legacyPlanOfferId = legacy.id;
          }
        }
        const saved = current
          ? await tx.catalogOffer.update({
              where: { id: current.id },
              data: {
                legacyPlanOfferId,
                slug: offer.slug.trim(),
                name: offer.name.trim(),
                billingPeriod: period,
                intervalMonths: this.intervalMonths(period),
                trafficBytes: BigInt(offer.trafficBytes),
                priceCents: offer.priceCents,
                storeUrl: this.normalizeStoreUrl(offer.storeUrl),
                active: offer.active,
                isDefault: offer.isDefault ?? offer === defaultOffer,
                archivedAt: null,
              },
            })
          : await tx.catalogOffer.create({
              data: {
                productId: id,
                legacyPlanOfferId,
                slug: offer.slug.trim(),
                name: offer.name.trim(),
                billingPeriod: period,
                intervalMonths: this.intervalMonths(period),
                trafficBytes: BigInt(offer.trafficBytes),
                priceCents: offer.priceCents,
                storeUrl: this.normalizeStoreUrl(offer.storeUrl),
                active: offer.active,
                isDefault: offer.isDefault ?? offer === defaultOffer,
              },
            });
        retainedIds.push(saved.id);
      }

      await tx.catalogOffer.updateMany({
        where: { productId: id, id: { notIn: retainedIds } },
        data: { active: false, isDefault: false, archivedAt: new Date() },
      });
      await tx.catalogProduct.update({
        where: { id },
        data: {
          slug: input.slug.trim(),
          status: this.toProductStatus(input.status),
          name: input.name.trim(),
          description: input.description?.trim(),
          storeUrl: this.normalizeStoreUrl(input.storeUrl),
          accessProfileId: profile.id,
          speedUpMbps:
            series === CatalogProductSeries.ULTRA ? 300 : input.speedUpMbps,
          speedDownMbps:
            series === CatalogProductSeries.ULTRA ? 300 : input.speedDownMbps,
          defaultTrafficMultiplierBasisPoints:
            series === CatalogProductSeries.ULTRA
              ? 10_000
              : defaultMultiplierBasisPoints,
          featured: input.featured,
          purchaseLimitPerUser:
            series === CatalogProductSeries.ULTRA
              ? null
              : input.purchaseLimitPerUser === undefined
                ? existing.purchaseLimitPerUser
                : input.purchaseLimitPerUser,
          purchaseLimitKey:
            series === CatalogProductSeries.ULTRA
              ? 'ultra-series'
              : input.purchaseLimitPerUser === undefined
                ? existing.purchaseLimitKey
                : input.purchaseLimitPerUser
                  ? input.purchaseLimitKey?.trim() || input.slug.trim()
                  : null,
          requiresActivePlan:
            kind === CatalogProductKind.TRAFFIC_PACK
              ? input.requiresActivePlan
              : false,
          referralEligible:
            kind === CatalogProductKind.PLAN ? input.referralEligible : false,
          accent: input.accent,
          sortOrder: input.sortOrder,
        },
      });
      const primary =
        input.offers.find((offer) => offer.billingPeriod === 'monthly') ??
        defaultOffer;
      if (existing.legacyPlanId) {
        await tx.plan.update({
          where: { id: existing.legacyPlanId },
          data: {
            name: input.name.trim(),
            description: input.description?.trim(),
            active: input.status === 'active',
            trafficBytes: BigInt(primary.trafficBytes),
            speedUpMbps: input.speedUpMbps,
            speedDownMbps: input.speedDownMbps,
            deviceLimit: profile.deviceLimit,
            priceCents: primary.priceCents,
            accent: input.accent,
            accessProfileId: profile.id,
          },
        });
      }
      if (existing.legacyTrafficPackProductId) {
        await tx.trafficPackProduct.update({
          where: { id: existing.legacyTrafficPackProductId },
          data: {
            name: input.name.trim(),
            description: input.description?.trim(),
            active: input.status === 'active',
            trafficBytes: BigInt(defaultOffer.trafficBytes),
            validityDays:
              defaultOffer.billingPeriod === 'one_time'
                ? null
                : this.intervalMonths(
                    this.toBillingPeriod(defaultOffer.billingPeriod),
                  )! * 30,
            priceCents: defaultOffer.priceCents,
            accent: input.accent,
            accessProfileId: profile.id,
            archivedAt: input.status === 'archived' ? new Date() : null,
          },
        });
      }
      if (series !== CatalogProductSeries.ULTRA) {
        await tx.entitlementGrant.updateMany({
          where: {
            productId: id,
            status: 'ACTIVE',
            endsAt: { gt: new Date() },
          },
          data: {
            accessProfileId: profile.id,
            speedUpMbpsSnapshot: input.speedUpMbps,
            speedDownMbpsSnapshot: input.speedDownMbps,
            deviceLimitSnapshot: profile.deviceLimit,
          },
        });
      }
      if (kind === CatalogProductKind.PLAN) {
        await tx.subscription.updateMany({
          where: {
            status: 'ACTIVE',
            endsAt: { gt: new Date() },
            entitlementGrant: { productId: id, status: 'ACTIVE' },
          },
          data: {
            speedUpMbpsSnapshot: input.speedUpMbps,
            speedDownMbpsSnapshot: input.speedDownMbps,
            deviceLimitSnapshot: profile.deviceLimit,
          },
        });
        await tx.accessAccount.updateMany({
          where: {
            entitlementGrants: {
              some: {
                productId: id,
                kind: 'PLAN',
                status: 'ACTIVE',
                endsAt: { gt: new Date() },
              },
            },
          },
          data: {
            trafficMultiplierBasisPoints: defaultMultiplierBasisPoints,
          },
        });
      }
      if (existing.legacyTrafficPackProductId) {
        await tx.trafficPack.updateMany({
          where: {
            trafficPackProductId: existing.legacyTrafficPackProductId,
            status: 'ACTIVE',
          },
          data: { accessProfileId: profile.id },
        });
      }
    });
    await this.invalidatePortalCatalog();
    return this.getUnifiedProduct(id);
  }

  listAccessProfiles() {
    return this.prisma.accessProfile
      .findMany({
        include: {
          nodeBindings: {
            include: { node: true },
            orderBy: { priority: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      .then((profiles) =>
        profiles.map((profile) => this.presentAccessProfile(profile)),
      );
  }

  async createAccessProfile(input: CreateAccessProfileDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.validateNodes(tx, input.nodeIds);
      await this.assertNodesAreNotExclusive(tx, input.nodeIds);
      const profile = await tx.accessProfile.create({
        data: {
          slug: input.slug.trim(),
          name: input.name.trim(),
          description: input.description?.trim(),
          active: input.active,
          speedUpMbps: input.speedUpMbps,
          speedDownMbps: input.speedDownMbps,
          deviceLimit: input.deviceLimit,
          nodeBindings: {
            create: input.nodeIds.map((nodeId, priority) => ({
              nodeId,
              priority,
            })),
          },
        },
        include: {
          nodeBindings: {
            include: { node: true },
            orderBy: { priority: 'asc' },
          },
        },
      });
      return this.presentAccessProfile(profile);
    });
    await this.invalidatePortalCatalog();
    return result;
  }

  async updateAccessProfile(id: string, input: UpdateAccessProfileDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.accessProfile.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Access profile not found');
      if (existing.id === ultraAccessProfileId) {
        throw new BadRequestException(
          'Ultra access profile must be managed through Ultra products',
        );
      }
      if (input.nodeIds) {
        await this.validateNodes(tx, input.nodeIds);
        await this.assertNodesAreNotExclusive(tx, input.nodeIds);
        await tx.accessProfileNode.deleteMany({
          where: { accessProfileId: id },
        });
        await tx.accessProfileNode.createMany({
          data: input.nodeIds.map((nodeId, priority) => ({
            accessProfileId: id,
            nodeId,
            priority,
          })),
        });
      }
      const profile = await tx.accessProfile.update({
        where: { id },
        data: {
          slug: input.slug?.trim(),
          name: input.name?.trim(),
          description: input.description?.trim(),
          active: input.active,
          speedUpMbps: input.speedUpMbps,
          speedDownMbps: input.speedDownMbps,
          deviceLimit: input.deviceLimit,
        },
        include: {
          nodeBindings: {
            include: { node: true },
            orderBy: { priority: 'asc' },
          },
        },
      });
      return this.presentAccessProfile(profile);
    });
    await this.invalidatePortalCatalog();
    return result;
  }

  async createOffer(input: CreatePlanOfferDto) {
    const period = this.toBillingPeriod(input.billingPeriod);
    const result = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({ where: { id: input.planId } });
      if (!plan) throw new NotFoundException('Plan not found');
      const offerCount = await tx.planOffer.count({
        where: { planId: input.planId, archivedAt: null },
      });
      const isDefault = input.isDefault ?? offerCount === 0;
      if (isDefault) {
        await tx.planOffer.updateMany({
          where: { planId: input.planId },
          data: { isDefault: false },
        });
      }
      const offer = await tx.planOffer.create({
        data: {
          planId: input.planId,
          slug: input.slug.trim(),
          name: input.name.trim(),
          active: input.active,
          isDefault,
          billingPeriod: period,
          intervalMonths: this.intervalMonths(period),
          priceCents: input.priceCents,
        },
      });
      return this.presentOffer(offer);
    });
    await this.invalidatePortalCatalog();
    return result;
  }

  async updateOffer(id: string, input: UpdatePlanOfferDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.planOffer.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Plan offer not found');
      const period = input.billingPeriod
        ? this.toBillingPeriod(input.billingPeriod)
        : undefined;
      if (input.isDefault) {
        await tx.planOffer.updateMany({
          where: { planId: existing.planId },
          data: { isDefault: false },
        });
      }
      const offer = await tx.planOffer.update({
        where: { id },
        data: {
          slug: input.slug?.trim(),
          name: input.name?.trim(),
          active: input.active,
          isDefault: input.isDefault,
          billingPeriod: period,
          intervalMonths: period ? this.intervalMonths(period) : undefined,
          priceCents: input.priceCents,
        },
      });
      return this.presentOffer(offer);
    });
    await this.invalidatePortalCatalog();
    return result;
  }

  async archiveOffer(id: string) {
    const existing = await this.prisma.planOffer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Plan offer not found');
    const activeCount = await this.prisma.planOffer.count({
      where: {
        planId: existing.planId,
        active: true,
        archivedAt: null,
        id: { not: id },
      },
    });
    if (activeCount === 0) {
      throw new ConflictException('A plan must keep at least one active offer');
    }
    const offer = await this.prisma.planOffer.update({
      where: { id },
      data: { active: false, isDefault: false, archivedAt: new Date() },
    });
    await this.invalidatePortalCatalog();
    return this.presentOffer(offer);
  }

  private invalidatePortalCatalog() {
    return this.cache.del(portalCatalogCacheKey);
  }

  private async getUnifiedProduct(id: string) {
    const products = await this.loadUnifiedProducts(id);
    if (!products[0]) throw new NotFoundException('Catalog product not found');
    return products[0];
  }

  private async loadUnifiedProducts(id?: string) {
    const products = await this.prisma.catalogProduct.findMany({
      where: id ? { id, systemManaged: false } : { systemManaged: false },
      include: {
        offers: {
          include: { legacyPlanOffer: true },
          orderBy: { intervalMonths: 'asc' },
        },
        accessProfile: {
          include: {
            nodeBindings: {
              where: { node: { retiredAt: null } },
              include: { node: { include: { server: true } } },
              orderBy: { priority: 'asc' },
            },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return products.map((product) => {
      const directNodes = product.accessProfile?.nodeBindings ?? [];
      const nodes = directNodes.map((binding) => ({
        id: binding.node.id,
        label: binding.node.label,
        protocol: binding.node.protocol.toLowerCase(),
        serverId: binding.node.serverId,
        serverName: binding.node.server?.name ?? binding.node.hostname,
        region: binding.node.region,
        provider: binding.node.provider,
        lifecycleStatus: binding.node.lifecycleStatus.toLowerCase(),
        priority: binding.priority,
        serviceable:
          binding.node.active && binding.node.lifecycleStatus === 'ACTIVE',
      }));
      const serverMap = new Map<
        string,
        { id: string; name: string; region: string | null; nodes: typeof nodes }
      >();
      for (const node of nodes) {
        const id = node.serverId ?? `host-${node.id}`;
        const server = serverMap.get(id) ?? {
          id,
          name: node.serverName,
          region: node.region,
          nodes: [],
        };
        server.nodes.push(node);
        serverMap.set(id, server);
      }
      const servers = [...serverMap.values()];
      // Compatibility shape for the current portal. It now represents direct
      // server bindings and no longer reads NodePool tables.
      const pools = servers.map((server, priority) => ({
        ...server,
        active: true,
        priority,
      }));
      const offers = product.offers.map((offer) => ({
        id: offer.id,
        slug: offer.slug,
        name: offer.name,
        billingPeriod: offer.billingPeriod.toLowerCase(),
        intervalMonths: offer.intervalMonths,
        legacyDurationDays: offer.legacyPlanOffer?.legacyDurationDays ?? null,
        trafficBytes: Number(offer.trafficBytes),
        priceCents: offer.priceCents,
        storeUrl: offer.storeUrl ?? product.storeUrl,
        currency: offer.currency,
        active: offer.active,
        isDefault: offer.isDefault,
        archivedAt: offer.archivedAt?.toISOString() ?? null,
      }));
      const base = {
        id: product.id,
        slug: product.slug,
        status: product.status.toLowerCase(),
        name: product.name,
        series: (product.series ?? CatalogProductSeries.STANDARD).toLowerCase(),
        description: product.description,
        storeUrl: product.storeUrl,
        defaultTrafficMultiplier:
          (product.defaultTrafficMultiplierBasisPoints ?? 10_000) / 10_000,
        accent: product.accent,
        sortOrder: product.sortOrder,
        featured: product.featured,
        homepageVisible: product.homepageVisible,
        purchaseLimitPerUser: product.purchaseLimitPerUser,
        purchaseLimitKey: product.purchaseLimitKey,
        requiresActivePlan: product.requiresActivePlan,
        referralEligible: product.referralEligible,
        accessProfileId: product.accessProfileId,
        access: {
          profileName: product.accessProfile?.name ?? null,
          speedUpMbps:
            product.speedUpMbps ?? product.accessProfile?.speedUpMbps ?? 0,
          speedDownMbps:
            product.speedDownMbps ?? product.accessProfile?.speedDownMbps ?? 0,
          deviceLimit: product.accessProfile?.deviceLimit ?? 0,
          servers,
          nodePools: pools,
        },
        offers,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
      };
      return product.kind === CatalogProductKind.PLAN
        ? {
            ...base,
            kind: 'plan' as const,
            quotaCadence: (
              product.quotaCadence ?? QuotaCadence.MONTHLY_RESET
            ).toLowerCase(),
            trafficReset: 'monthly' as const,
          }
        : {
            ...base,
            kind: 'traffic_pack' as const,
            quotaCadence: (
              product.quotaCadence ?? QuotaCadence.ONE_TIME
            ).toLowerCase(),
            trafficReset:
              product.quotaCadence === QuotaCadence.MONTHLY_RESET
                ? ('monthly' as const)
                : ('never' as const),
          };
    });
  }

  private async resolveProductAccessProfile(
    tx: Prisma.TransactionClient,
    input: SaveCatalogProductDto,
    productId: string,
    series: CatalogProductSeries,
    currentProfileId?: string | null,
    actorId?: string,
  ) {
    if (input.offers.length === 0) {
      throw new BadRequestException('At least one catalog offer is required');
    }
    this.multiplierBasisPoints(input.defaultTrafficMultiplier);
    const periods = input.offers.map((offer) => offer.billingPeriod);
    if (new Set(periods).size !== periods.length) {
      throw new BadRequestException('Offer billing periods must be unique');
    }
    if (
      input.status === 'active' &&
      input.kind === 'plan' &&
      !periods.includes('monthly')
    ) {
      throw new BadRequestException('Published plans require a monthly offer');
    }
    if (input.kind === 'plan' && periods.includes('one_time')) {
      throw new BadRequestException('Plans cannot use one-time offers');
    }
    if (
      input.kind === 'traffic_pack' &&
      (periods.length !== 1 || !periods.includes('one_time'))
    ) {
      throw new BadRequestException(
        'Traffic packs require exactly one permanent one-time offer',
      );
    }
    if (input.purchaseLimitPerUser && !input.purchaseLimitKey?.trim()) {
      input.purchaseLimitKey = input.slug.trim();
    }

    if (series === CatalogProductSeries.ULTRA) {
      if (input.kind !== 'traffic_pack') {
        throw new BadRequestException('Ultra products must be traffic packs');
      }
      const nodeIds = input.nodeIds;
      let nodes: Array<{
        id: string;
        active: boolean;
        lifecycleStatus: string;
      }> = [];
      if (nodeIds) {
        if (nodeIds.length > 0) await this.validateNodes(tx, nodeIds);
        nodes = await tx.node.findMany({
          where: { id: { in: nodeIds }, retiredAt: null },
          select: { id: true, active: true, lifecycleStatus: true },
        });
        await tx.accessProfileNode.deleteMany({
          where: {
            nodeId: { in: nodeIds },
            accessProfileId: { not: ultraAccessProfileId },
          },
        });
        await tx.node.updateMany({
          where: {
            exclusiveAccessProfileId: ultraAccessProfileId,
            id: { notIn: nodeIds },
          },
          data: { exclusiveAccessProfileId: null },
        });
        await tx.node.updateMany({
          where: { id: { in: nodeIds } },
          data: { exclusiveAccessProfileId: ultraAccessProfileId },
        });
        await tx.accessProfileNode.deleteMany({
          where: { accessProfileId: ultraAccessProfileId },
        });
        if (actorId) {
          await tx.auditLog.create({
            data: {
              actorId,
              action: 'catalog.ultra_nodes.updated',
              targetType: 'access_profile',
              targetId: ultraAccessProfileId,
              metadata: { productId, nodeIds },
            },
          });
        }
      } else if (input.status === 'active') {
        nodes = await tx.node.findMany({
          where: {
            retiredAt: null,
            accessProfileBindings: {
              some: { accessProfileId: ultraAccessProfileId },
            },
          },
          select: { id: true, active: true, lifecycleStatus: true },
        });
      }
      if (
        input.status === 'active' &&
        !nodes.some((node) => node.active && node.lifecycleStatus === 'ACTIVE')
      ) {
        throw new BadRequestException(
          'Published Ultra products require a serviceable node',
        );
      }
      return tx.accessProfile.upsert({
        where: { id: ultraAccessProfileId },
        create: {
          id: ultraAccessProfileId,
          slug: ultraAccessProfileId,
          name: '普通线路 Ultra 专属节点',
          description: '三个永久 Ultra 档位共用的专属节点组',
          active: true,
          speedUpMbps: 300,
          speedDownMbps: 300,
          deviceLimit: 1000,
          nodeBindings: nodeIds
            ? {
                create: nodeIds.map((nodeId, priority) => ({
                  nodeId,
                  priority,
                })),
              }
            : undefined,
        },
        update: {
          active: true,
          speedUpMbps: 300,
          speedDownMbps: 300,
          deviceLimit: 1000,
          nodeBindings: nodeIds
            ? {
                create: nodeIds.map((nodeId, priority) => ({
                  nodeId,
                  priority,
                })),
              }
            : undefined,
        },
      });
    }

    if (input.nodeIds) {
      await this.validateNodes(tx, input.nodeIds);
      const nodes = await tx.node.findMany({
        where: { id: { in: input.nodeIds }, retiredAt: null },
        select: {
          id: true,
          active: true,
          lifecycleStatus: true,
          exclusiveAccessProfileId: true,
        },
      });
      if (nodes.some((node) => node.exclusiveAccessProfileId)) {
        throw new BadRequestException(
          'Ultra exclusive nodes cannot be assigned to standard products',
        );
      }
      if (
        input.status === 'active' &&
        !nodes.some((node) => node.active && node.lifecycleStatus === 'ACTIVE')
      ) {
        throw new BadRequestException(
          'Published products require a serviceable node',
        );
      }
      const managedSlug = `catalog-product-${productId}`;
      const current = currentProfileId
        ? await tx.accessProfile.findUnique({ where: { id: currentProfileId } })
        : null;
      const profileData = {
        name: `${input.name.trim()} 可用节点`,
        description: '由商品节点选择自动维护',
        active: input.status !== 'archived',
        speedUpMbps: input.speedUpMbps,
        speedDownMbps: input.speedDownMbps,
        deviceLimit: input.deviceLimit ?? current?.deviceLimit ?? 5,
      };
      if (current?.slug === managedSlug) {
        await tx.accessProfileNode.deleteMany({
          where: { accessProfileId: current.id },
        });
        return tx.accessProfile.update({
          where: { id: current.id },
          data: {
            ...profileData,
            nodeBindings: {
              create: input.nodeIds.map((nodeId, priority) => ({
                nodeId,
                priority,
              })),
            },
          },
        });
      }
      return tx.accessProfile.create({
        data: {
          slug: managedSlug,
          ...profileData,
          nodeBindings: {
            create: input.nodeIds.map((nodeId, priority) => ({
              nodeId,
              priority,
            })),
          },
        },
      });
    }

    if (!input.accessProfileId) {
      throw new BadRequestException('At least one node is required');
    }
    const profile = await tx.accessProfile.findUnique({
      where: { id: input.accessProfileId },
    });
    if (!profile) throw new BadRequestException('Unknown access profile');
    if (input.status === 'active') {
      if (!profile.active || input.offers.some((offer) => !offer.active)) {
        throw new BadRequestException(
          'Published products require an active profile and active offers',
        );
      }
      const directNodes = await tx.accessProfileNode.count({
        where: {
          accessProfileId: profile.id,
          node: { active: true, lifecycleStatus: 'ACTIVE' },
        },
      });
      if (directNodes === 0) {
        throw new BadRequestException(
          'Published products require a serviceable node',
        );
      }
    }
    return profile;
  }

  private async addPurchaseEligibility(
    catalog: Awaited<ReturnType<CatalogService['buildPortalCatalog']>>,
    userId: string,
  ) {
    const limitKeys = [
      ...new Set(
        catalog.products
          .map((product) => product.purchaseLimitKey)
          .filter((key): key is string => Boolean(key)),
      ),
    ];
    const now = new Date();
    const [orders, activeGrantCount, activeSubscriptionCount, activeUltra] =
      await Promise.all([
        limitKeys.length
          ? this.prisma.manualOrder.findMany({
              where: {
                userId,
                status: 'APPLIED',
                OR: [
                  {
                    catalogOffer: {
                      product: { purchaseLimitKey: { in: limitKeys } },
                    },
                  },
                  {
                    plan: {
                      catalogProduct: {
                        purchaseLimitKey: { in: limitKeys },
                      },
                    },
                  },
                ],
              },
              select: {
                catalogOffer: {
                  select: {
                    product: { select: { purchaseLimitKey: true } },
                  },
                },
                plan: {
                  select: {
                    catalogProduct: {
                      select: { purchaseLimitKey: true },
                    },
                  },
                },
              },
            })
          : Promise.resolve([]),
        this.prisma.entitlementGrant.count({
          where: {
            userId,
            kind: 'PLAN',
            status: 'ACTIVE',
            startsAt: { lte: now },
            endsAt: { gt: now },
          },
        }),
        this.prisma.subscription.count({
          where: {
            userId,
            status: 'ACTIVE',
            startsAt: { lte: now },
            endsAt: { gt: now },
          },
        }),
        this.prisma.entitlementGrant.findFirst({
          where: {
            userId,
            activeSlot: 'ULTRA',
            status: 'ACTIVE',
            startsAt: { lte: now },
            endsAt: { gt: now },
          },
          include: { product: { select: { name: true } } },
        }),
      ]);
    const usedByKey = new Map<string, number>();
    for (const order of orders) {
      const key =
        order.catalogOffer?.product.purchaseLimitKey ??
        order.plan?.catalogProduct?.purchaseLimitKey;
      if (key) usedByKey.set(key, (usedByKey.get(key) ?? 0) + 1);
    }
    const hasActivePlan = activeGrantCount > 0 || activeSubscriptionCount > 0;
    return {
      ...catalog,
      products: catalog.products.map((product) => {
        const selectedOffer =
          product.offers.find(
            (offer) => offer.isDefault && offer.active && !offer.archivedAt,
          ) ??
          product.offers.find((offer) => offer.active && !offer.archivedAt);
        if (product.series === 'ultra' && selectedOffer) {
          const currentPrice = activeUltra?.priceCentsSnapshot ?? 0;
          const currentTraffic = Number(
            activeUltra?.trafficBytesSnapshot ?? BigInt(0),
          );
          const isCurrent = activeUltra?.productId === product.id;
          const canUpgrade = Boolean(
            activeUltra &&
            selectedOffer.priceCents > currentPrice &&
            selectedOffer.trafficBytes > currentTraffic,
          );
          const eligible = !activeUltra || canUpgrade;
          return {
            ...product,
            purchaseEligibility: {
              eligible,
              used: activeUltra ? 1 : 0,
              remaining: activeUltra ? 0 : 1,
              reason: isCurrent
                ? '当前已持有该 Ultra 档位'
                : activeUltra && !canUpgrade
                  ? '不支持降级或叠加 Ultra 档位'
                  : null,
              purchaseMode: canUpgrade ? 'upgrade' : 'initial',
              payablePriceCents: canUpgrade
                ? selectedOffer.priceCents - currentPrice
                : selectedOffer.priceCents,
              currentProductId: activeUltra?.productId ?? null,
              currentProductName: activeUltra?.product.name ?? null,
              resetAnchorAt:
                activeUltra?.resetAnchorAt?.toISOString() ??
                activeUltra?.startsAt.toISOString() ??
                null,
            },
          };
        }
        const used = product.purchaseLimitKey
          ? (usedByKey.get(product.purchaseLimitKey) ?? 0)
          : 0;
        const remaining = product.purchaseLimitPerUser
          ? Math.max(product.purchaseLimitPerUser - used, 0)
          : null;
        const limitReached = remaining === 0;
        const needsPlan = product.requiresActivePlan && !hasActivePlan;
        return {
          ...product,
          purchaseEligibility: {
            eligible: !limitReached && !needsPlan,
            used,
            remaining,
            reason: limitReached
              ? '该账号已经使用过体验套餐'
              : needsPlan
                ? '需要先开通有效套餐'
                : null,
          },
        };
      }),
    };
  }

  private groupAvailableNodes(
    nodes: Array<{
      id: string;
      label: string;
      protocol: string;
      hostname: string;
      active: boolean;
      lifecycleStatus: string;
      exclusiveAccessProfileId: string | null;
      serverId: string | null;
      server: {
        id: string;
        name: string;
        region: string | null;
        active: boolean;
      } | null;
    }>,
  ) {
    const servers = new Map<
      string,
      {
        id: string;
        name: string;
        region: string | null;
        nodes: Array<{
          id: string;
          label: string;
          protocol: string;
          hostname: string;
          serviceable: boolean;
          exclusiveAccessProfileId: string | null;
        }>;
      }
    >();
    for (const node of nodes) {
      const serverId = node.server?.id ?? `unassigned-${node.id}`;
      const server = servers.get(serverId) ?? {
        id: serverId,
        name: node.server?.name ?? '未归属服务器',
        region: node.server?.region ?? null,
        nodes: [],
      };
      server.nodes.push({
        id: node.id,
        label: node.label,
        protocol: node.protocol.toLowerCase(),
        hostname: node.hostname,
        serviceable:
          node.active &&
          node.lifecycleStatus === 'ACTIVE' &&
          (node.server?.active ?? true),
        exclusiveAccessProfileId: node.exclusiveAccessProfileId,
      });
      servers.set(serverId, server);
    }
    return [...servers.values()];
  }

  private multiplierBasisPoints(multiplier: number) {
    const basisPoints = Math.round(multiplier * 10_000);
    if (
      !Number.isFinite(multiplier) ||
      basisPoints < 1_000 ||
      basisPoints > 1_000_000
    ) {
      throw new BadRequestException('Traffic multiplier must be 0.1 to 100');
    }
    return basisPoints;
  }

  private normalizeStoreUrl(value?: string) {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
      return url.toString();
    } catch {
      throw new BadRequestException('Store URL must be a valid HTTP(S) URL');
    }
  }

  private toProductKind(kind: SaveCatalogProductDto['kind']) {
    return kind === 'plan'
      ? CatalogProductKind.PLAN
      : CatalogProductKind.TRAFFIC_PACK;
  }

  private toProductStatus(status: SaveCatalogProductDto['status']) {
    if (status === 'active') return CatalogProductStatus.ACTIVE;
    if (status === 'archived') return CatalogProductStatus.ARCHIVED;
    return CatalogProductStatus.DRAFT;
  }

  private toProductSeries(series?: SaveCatalogProductDto['series']) {
    return series === 'ultra'
      ? CatalogProductSeries.ULTRA
      : CatalogProductSeries.STANDARD;
  }

  private async validateNodes(tx: Prisma.TransactionClient, nodeIds: string[]) {
    if (nodeIds.length === 0) {
      throw new BadRequestException('At least one node is required');
    }
    const count = await tx.node.count({
      where: { id: { in: nodeIds }, retiredAt: null },
    });
    if (count !== nodeIds.length) throw new BadRequestException('Unknown node');
  }

  private async assertNodesAreNotExclusive(
    tx: Prisma.TransactionClient,
    nodeIds: string[],
  ) {
    if (nodeIds.length === 0) return;
    const exclusive = await tx.node.count({
      where: {
        id: { in: nodeIds },
        retiredAt: null,
        exclusiveAccessProfileId: { not: null },
      },
    });
    if (exclusive > 0) {
      throw new BadRequestException(
        'Ultra exclusive nodes cannot be assigned to standard access profiles',
      );
    }
  }

  private presentAccessProfile(profile: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    active: boolean;
    speedUpMbps: number;
    speedDownMbps: number;
    deviceLimit: number;
    createdAt: Date;
    updatedAt: Date;
    nodeBindings: Array<{
      id: string;
      nodeId: string;
      priority: number;
      node: { label: string; active: boolean };
    }>;
  }) {
    return {
      id: profile.id,
      slug: profile.slug,
      name: profile.name,
      description: profile.description,
      active: profile.active,
      speedUpMbps: profile.speedUpMbps,
      speedDownMbps: profile.speedDownMbps,
      deviceLimit: profile.deviceLimit,
      nodes: profile.nodeBindings.map((binding) => ({
        bindingId: binding.id,
        nodeId: binding.nodeId,
        nodeLabel: binding.node.label,
        active: binding.node.active,
        priority: binding.priority,
      })),
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private presentOffer(offer: {
    id: string;
    planId: string;
    slug: string;
    name: string;
    active: boolean;
    isDefault: boolean;
    billingPeriod: BillingPeriod;
    intervalMonths: number | null;
    legacyDurationDays: number | null;
    priceCents: number;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: offer.id,
      planId: offer.planId,
      slug: offer.slug,
      name: offer.name,
      active: offer.active,
      isDefault: offer.isDefault,
      billingPeriod: offer.billingPeriod.toLowerCase(),
      intervalMonths: offer.intervalMonths,
      legacyDurationDays: offer.legacyDurationDays,
      priceCents: offer.priceCents,
      archivedAt: offer.archivedAt?.toISOString() ?? null,
      createdAt: offer.createdAt.toISOString(),
      updatedAt: offer.updatedAt.toISOString(),
    };
  }

  private toBillingPeriod(
    period: CreatePlanOfferDto['billingPeriod'] | 'one_time',
  ) {
    if (period === 'monthly') return BillingPeriod.MONTHLY;
    if (period === 'quarterly') return BillingPeriod.QUARTERLY;
    if (period === 'yearly') return BillingPeriod.YEARLY;
    if (period === 'one_time') return BillingPeriod.ONE_TIME;
    throw new BadRequestException('Unsupported billing period');
  }

  private intervalMonths(period: BillingPeriod) {
    if (period === BillingPeriod.MONTHLY) return 1;
    if (period === BillingPeriod.QUARTERLY) return 3;
    if (period === BillingPeriod.YEARLY) return 12;
    return null;
  }
}
