import { catalogLineTags } from './line-tags';

describe('catalog line tags', () => {
  it('describes residential access by assigned node tags or legacy labels', () => {
    expect(
      catalogLineTags('PLAN', [{ label: 'US', tags: ['residential'] }]),
    ).toEqual(['家宽', '住宅', '专线']);
    expect(catalogLineTags('PLAN', [{ label: '[住宅] 美国' }])).toEqual([
      '家宽',
      '住宅',
      '专线',
    ]);
  });
  it('does not advertise residential access for ordinary nodes or standalone packs', () => {
    expect(
      catalogLineTags('PLAN', [{ label: '[顶级] 美国', tags: ['top'] }]),
    ).toEqual([]);
    expect(catalogLineTags('PLAN', [])).toEqual([]);
    expect(catalogLineTags('TRAFFIC_PACK', [{ label: '[住宅] 美国' }])).toEqual(
      [],
    );
  });
});
