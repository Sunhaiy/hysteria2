import { pageResponse, parsePage } from './pagination';

describe('pagination contract', () => {
  it('uses one-based pages and clamps list sizes to the shared maximum', () => {
    expect(parsePage({ page: '0', pageSize: '1000' })).toEqual({
      page: 1,
      pageSize: 100,
      skip: 0,
    });
    expect(parsePage({ page: '3', pageSize: '20' })).toEqual({
      page: 3,
      pageSize: 20,
      skip: 40,
    });
  });

  it('returns the common PageResponse shape', () => {
    expect(pageResponse([{ id: 'item_1' }], 21, 2, 20)).toEqual({
      items: [{ id: 'item_1' }],
      page: 2,
      pageSize: 20,
      total: 21,
      totalPages: 2,
    });
  });
});
