import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingPeriod,
  CatalogProductKind,
  CatalogProductStatus,
  Prisma,
  QuotaCadence,
} from '@prisma/client';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateAccessProfileDto,
  CreatePlanOfferDto,
  UpdateAccessProfileDto,
  UpdatePlanOfferDto,
  SaveCatalogProductDto,
} from './catalog.dto';

const portalCatalogCacheKey = 'catalog:portal:v1';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getAdminCatalog() {
    const [plans, trafficPacks, accessProfiles, products] = await Promise.all([
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
            include: { node: true },
            orderBy: { priority: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.loadUnifiedProducts(),
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
    };
  }

  async getPortalCatalog() {
    const cached = await this.cache.get(portalCatalogCacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as Awaited<
          ReturnType<CatalogService['buildPortalCatalog']>
        >;
      } catch {
        await this.cache.del(portalCatalogCacheKey);
      }
    }
    const result = await this.buildPortalCatalog();
    await this.cache.set(portalCatalogCacheKey, JSON.stringify(result), 300);
    return result;
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
          (pack.validityDays ?? 0) > 0 &&
          Boolean(profile?.active) &&
          Boolean(profile?.nodes.some((node) => node.active))
        );
      }),
    };
  }

  async createProduct(input: SaveCatalogProductDto) {
    const id = await this.prisma.$transaction(async (tx) => {
      const profile = await this.validateProductInput(tx, input);
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
            accessProfileId: input.accessProfileId,
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
            validityDays:
              this.intervalMonths(
                this.toBillingPeriod(defaultOffer.billingPeriod),
              )! * 30,
            priceCents: defaultOffer.priceCents,
            accent: input.accent ?? 'teal',
            accessProfileId: input.accessProfileId,
          },
        });
        legacyTrafficPackProductId = product.id;
      }

      const product = await tx.catalogProduct.create({
        data: {
          legacyPlanId,
          legacyTrafficPackProductId,
          slug: input.slug.trim(),
          kind,
          status: this.toProductStatus(input.status),
          name: input.name.trim(),
          description: input.description?.trim(),
          storeUrl: this.normalizeStoreUrl(input.storeUrl),
          quotaCadence:
            kind === CatalogProductKind.PLAN
              ? QuotaCadence.MONTHLY_RESET
              : QuotaCadence.ONE_TIME,
          accessProfileId: input.accessProfileId,
          speedUpMbps: input.speedUpMbps,
          speedDownMbps: input.speedDownMbps,
          defaultTrafficMultiplierBasisPoints: defaultMultiplierBasisPoints,
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

  async updateProduct(id: string, input: SaveCatalogProductDto) {
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
      const kind = this.toProductKind(input.kind);
      if (existing.kind !== kind) {
        throw new BadRequestException('Product kind cannot be changed');
      }
      const profile = await this.validateProductInput(tx, input);
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
          accessProfileId: input.accessProfileId,
          speedUpMbps: input.speedUpMbps,
          speedDownMbps: input.speedDownMbps,
          defaultTrafficMultiplierBasisPoints: defaultMultiplierBasisPoints,
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
            accessProfileId: input.accessProfileId,
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
              this.intervalMonths(
                this.toBillingPeriod(defaultOffer.billingPeriod),
              )! * 30,
            priceCents: defaultOffer.priceCents,
            accent: input.accent,
            accessProfileId: input.accessProfileId,
            archivedAt: input.status === 'archived' ? new Date() : null,
          },
        });
      }
      await tx.entitlementGrant.updateMany({
        where: {
          productId: id,
          status: 'ACTIVE',
          endsAt: { gt: new Date() },
        },
        data: {
          speedUpMbpsSnapshot: input.speedUpMbps,
          speedDownMbpsSnapshot: input.speedDownMbps,
        },
      });
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
          },
        });
        await tx.accessAccount.updateMany({
          where: {
            trafficMultiplierOverrideBasisPoints: null,
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
      if (input.nodeIds) {
        await this.validateNodes(tx, input.nodeIds);
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
      where: id ? { id } : undefined,
      include: {
        offers: {
          include: { legacyPlanOffer: true },
          orderBy: { intervalMonths: 'asc' },
        },
        accessProfile: {
          include: {
            nodeBindings: {
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
        description: product.description,
        storeUrl: product.storeUrl,
        defaultTrafficMultiplier:
          (product.defaultTrafficMultiplierBasisPoints ?? 10_000) / 10_000,
        accent: product.accent,
        sortOrder: product.sortOrder,
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
            quotaCadence: 'monthly_reset' as const,
            trafficReset: 'monthly' as const,
          }
        : {
            ...base,
            kind: 'traffic_pack' as const,
            quotaCadence: 'one_time' as const,
            trafficReset: 'never' as const,
          };
    });
  }

  private async validateProductInput(
    tx: Prisma.TransactionClient,
    input: SaveCatalogProductDto,
  ) {
    if (input.offers.length === 0) {
      throw new BadRequestException('At least one catalog offer is required');
    }
    const profile = await tx.accessProfile.findUnique({
      where: { id: input.accessProfileId },
    });
    if (!profile) throw new BadRequestException('Unknown access profile');
    this.multiplierBasisPoints(input.defaultTrafficMultiplier);
    const periods = input.offers.map((offer) => offer.billingPeriod);
    if (new Set(periods).size !== periods.length) {
      throw new BadRequestException('Offer billing periods must be unique');
    }
    const required =
      input.kind === 'plan'
        ? ['monthly', 'quarterly', 'yearly']
        : ['quarterly', 'yearly'];
    if (
      input.status === 'active' &&
      (periods.length !== required.length ||
        required.some(
          (period) => !periods.includes(period as (typeof periods)[number]),
        ))
    ) {
      throw new BadRequestException(
        input.kind === 'plan'
          ? 'Published plans require monthly, quarterly and yearly offers'
          : 'Published traffic packs require quarterly and yearly offers',
      );
    }
    if (input.status === 'active') {
      if (!profile.active || input.offers.some((offer) => !offer.active)) {
        throw new BadRequestException(
          'Published products require an active profile and active offers',
        );
      }
      const directNodes = await tx.accessProfileNode.count({
        where: {
          accessProfileId: input.accessProfileId,
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

  private async validateNodes(tx: Prisma.TransactionClient, nodeIds: string[]) {
    if (nodeIds.length === 0) {
      throw new BadRequestException('At least one node is required');
    }
    const count = await tx.node.count({ where: { id: { in: nodeIds } } });
    if (count !== nodeIds.length) throw new BadRequestException('Unknown node');
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

  private toBillingPeriod(period: CreatePlanOfferDto['billingPeriod']) {
    if (period === 'monthly') return BillingPeriod.MONTHLY;
    if (period === 'quarterly') return BillingPeriod.QUARTERLY;
    if (period === 'yearly') return BillingPeriod.YEARLY;
    throw new BadRequestException('Unsupported billing period');
  }

  private intervalMonths(period: BillingPeriod) {
    if (period === BillingPeriod.MONTHLY) return 1;
    if (period === BillingPeriod.QUARTERLY) return 3;
    if (period === BillingPeriod.YEARLY) return 12;
    return null;
  }
}
