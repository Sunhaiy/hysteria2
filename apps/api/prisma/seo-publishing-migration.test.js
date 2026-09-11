const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { describe, it } = require('node:test');

const sql = readFileSync(
  join(
    __dirname,
    'migrations',
    '20260910190000_seo_publishing',
    'migration.sql',
  ),
  'utf8',
);
const permissionSql = readFileSync(
  join(
    __dirname,
    'migrations',
    '20260910190100_seo_admin_permission',
    'migration.sql',
  ),
  'utf8',
);
const observabilitySql = readFileSync(
  join(
    __dirname,
    'migrations',
    '20260910190200_seo_generation_observability',
    'migration.sql',
  ),
  'utf8',
);
const editorialEvidenceSql = readFileSync(
  join(
    __dirname,
    'migrations',
    '20260911143000_seo_editorial_evidence',
    'migration.sql',
  ),
  'utf8',
);

describe('SEO publishing migration', () => {
  it('adds versioned content, generation, indexing, redirects, and search metrics', () => {
    for (const table of [
      'SeoArticle',
      'SeoArticleRevision',
      'SeoKeyword',
      'SeoGenerationJob',
      'SeoImage',
      'SeoIndexSubmission',
      'SeoRedirect',
      'SeoSearchMetric',
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
    }
    assert.match(sql, /'SEO_CONTENT_MANAGE'/);
    assert.match(permissionSql, /INSERT INTO "AdminPermissionGrant"/);
    assert.match(permissionSql, /WHERE "role" = 'ADMIN'/);
    assert.match(observabilitySql, /ADD COLUMN "promptVersion" TEXT/);
    assert.match(editorialEvidenceSql, /ADD COLUMN "sourceEvidence" JSONB/);
    assert.match(editorialEvidenceSql, /ADD COLUMN "aiAudit" JSONB/);
    assert.match(editorialEvidenceSql, /ADD COLUMN "lastVerifiedAt" TIMESTAMP/);
  });

  it('does not rewrite commerce, entitlement, usage, or member data', () => {
    for (const table of [
      'User',
      'ManualOrder',
      'PaymentRecord',
      'Subscription',
      'EntitlementGrant',
      'QuotaBucket',
      'UsageRollup',
    ]) {
      assert.doesNotMatch(
        sql,
        new RegExp(`(?:UPDATE|DELETE FROM|TRUNCATE) "${table}"`, 'i'),
      );
      assert.doesNotMatch(
        editorialEvidenceSql,
        new RegExp(`(?:UPDATE|DELETE FROM|TRUNCATE) "${table}"`, 'i'),
      );
    }
  });
});
