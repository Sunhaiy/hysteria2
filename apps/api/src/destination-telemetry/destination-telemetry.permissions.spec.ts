import { validateSync } from 'class-validator';
import { DestinationTelemetryService } from './destination-telemetry.service';
import { UpdateAdminPermissionsDto } from './destination-telemetry.dto';

describe('Dedicated Agent administrator permissions', () => {
  function fixture() {
    let permissions = ['AGENT_UPDATES_MANAGE'];
    const user = {
      id: 'admin',
      role: 'ADMIN',
      email: 'admin@example.test',
      displayName: 'Admin',
    };
    const database = {
      user: {
        findUnique: () => Promise.resolve(user),
        update: () => Promise.resolve(user),
        findMany: (query: {
          include: {
            adminPermissions: { where: { permission: { in: string[] } } };
          };
        }) =>
          Promise.resolve([
            {
              ...user,
              adminPermissions: permissions
                .filter((permission) =>
                  query.include.adminPermissions.where.permission.in.includes(
                    permission,
                  ),
                )
                .map((permission) => ({ permission })),
            },
          ]),
      },
      adminPermissionGrant: {
        deleteMany: () => {
          permissions = [];
          return Promise.resolve({ count: 1 });
        },
        createMany: ({ data }: { data: Array<{ permission: string }> }) => {
          permissions = data.map((row) => row.permission);
          return Promise.resolve({ count: data.length });
        },
      },
      auditLog: { create: () => Promise.resolve({}) },
      $transaction: <T>(work: (tx: unknown) => Promise<T>) => work(database),
    };
    return new DestinationTelemetryService(
      database as never,
      {} as never,
      {} as never,
    );
  }

  it('lists the Agent grant separately from permission-administration access', async () => {
    const [record] = await fixture().listAdminPermissions();
    expect(record.permissions).toEqual(['agent_updates.manage']);
    expect(record.permissions).not.toContain('admin_permissions.manage');
  });

  it('round-trips Agent access without substituting a different administrator grant', async () => {
    const service = fixture();
    await service.updateAdminPermissions(
      'admin',
      {
        permissions: ['agent_updates.manage', 'seo_content.manage'],
      } as never,
      'owner',
    );
    const [record] = await service.listAdminPermissions();
    expect(record.permissions).toEqual([
      'agent_updates.manage',
      'seo_content.manage',
    ]);
  });

  it('accepts all four known grants and rejects unknown grants', () => {
    const dto = Object.assign(new UpdateAdminPermissionsDto(), {
      permissions: [
        'agent_updates.manage',
        'destination_audit.read',
        'admin_permissions.manage',
        'seo_content.manage',
      ],
    });
    expect(validateSync(dto)).toEqual([]);
    dto.permissions = ['unknown'] as never;
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('does not map an unknown internal value to administrator privileges', async () => {
    await expect(
      fixture().updateAdminPermissions(
        'admin',
        {
          permissions: ['unknown'],
        } as never,
        'owner',
      ),
    ).rejects.toThrow('Unknown administrator permission');
  });
});
