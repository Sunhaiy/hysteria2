import { DestinationTelemetryService } from './destination-telemetry.service';

describe('Admin permissions during updater retirement', () => {
  it('lists supported permissions while a retired enum grant remains in the database', async () => {
    const known = [
      'DESTINATION_AUDIT_READ',
      'ADMIN_PERMISSIONS_MANAGE',
      'SEO_CONTENT_MANAGE',
    ];
    const database = {
      user: {
        findMany: (query: {
          include: {
            adminPermissions:
              | boolean
              | { where: { permission: { in: string[] } } };
          };
        }) => {
          const relation = query.include.adminPermissions;
          if (
            typeof relation === 'boolean' ||
            relation.where.permission.in.some((value) => !known.includes(value))
          ) {
            throw new Error(
              'Value AGENT_UPDATES_MANAGE not found in enum AdminPermission',
            );
          }
          return Promise.resolve([
            {
              id: 'admin',
              email: 'admin@example.test',
              displayName: 'Admin',
              adminPermissions: [{ permission: 'SEO_CONTENT_MANAGE' }],
            },
          ]);
        },
      },
    };
    const service = new DestinationTelemetryService(
      database as never,
      {} as never,
      {} as never,
    );
    await expect(service.listAdminPermissions()).resolves.toEqual([
      {
        userId: 'admin',
        email: 'admin@example.test',
        displayName: 'Admin',
        permissions: ['seo_content.manage'],
      },
    ]);
  });
});
