import { DatabaseService } from '../../src/common/db/database.service';
import { NetworkModelService } from '../../src/modules/network-model/network-model.service';

describe('NetworkModelService block-scoped publish', () => {
  const db = {
    query: jest.fn(),
    withTransaction: jest.fn(),
  } as unknown as DatabaseService;

  const service = new NetworkModelService(db);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('only unpublishes sibling versions inside the same block scope', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ id: 'ver-2', block_id: 'block-1' }],
    });

    (db.withTransaction as jest.Mock).mockImplementation(async (runner: (client: any) => Promise<unknown>) => {
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'ver-2',
                network_model_id: 'model-1',
                block_id: 'block-1',
                version_no: 2,
                is_published: true,
                published_at: new Date('2026-04-06T10:00:00Z'),
                source_file_ref: null,
                created_at: new Date('2026-04-06T09:00:00Z'),
              },
            ],
          }),
      };
      const result = await runner(client);
      expect(client.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('block_id is not distinct from $2::uuid'),
        ['model-1', 'block-1'],
      );
      return result;
    });

    const published = await service.publishVersion('model-1', 'ver-2');
    expect(published.block_id).toBe('block-1');
    expect(published.is_published).toBe(true);
  });
});
