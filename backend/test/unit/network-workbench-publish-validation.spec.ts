import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../src/common/db/database.service';
import { DeviceGatewayMaintainerService } from '../../src/modules/device-gateway/device-gateway-maintainer.service';
import { DeviceGatewayService } from '../../src/modules/device-gateway/device-gateway.service';
import { NetworkWorkbenchService } from '../../src/modules/network-workbench/network-workbench.service';
import { SolverService } from '../../src/modules/solver/solver.service';
import { TcpJsonV1Server } from '../../src/modules/device-gateway/tcp-json-v1.server';

describe('NetworkWorkbenchService publish validation', () => {
  const db = {
    query: jest.fn(),
  } as unknown as DatabaseService;

  const service = new NetworkWorkbenchService(
    db,
    {} as DeviceGatewayService,
    {} as DeviceGatewayMaintainerService,
    {} as TcpJsonV1Server,
    {} as SolverService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows publish when all source stations have valid coordinates', async () => {
    (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    await expect(
      (service as any).assertVersionHasPublishableSourceStations('version-1', undefined),
    ).resolves.toBeUndefined();
  });

  it('rejects publish when source stations still miss coordinates', async () => {
    (db.query as jest.Mock).mockResolvedValue({
      rows: [{ node_code: 'SRC-001' }, { node_code: 'SRC-002' }],
    });

    await expect(
      (service as any).assertVersionHasPublishableSourceStations('version-2', undefined),
    ).rejects.toThrow(BadRequestException);
    await expect(
      (service as any).assertVersionHasPublishableSourceStations('version-2', undefined),
    ).rejects.toThrow('SRC-001');
  });

  it('prefers relational block_id when filtering versions by block scope', () => {
    const picked = (service as any).pickVersionForConfig(
      [
        {
          id: 'ver-a',
          block_id: 'block-a',
          version_no: 1,
          is_published: false,
          published_at: null,
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-06T09:00:00Z',
          node_count: 12,
          pipe_count: 8,
        },
        {
          id: 'ver-b',
          block_id: 'block-b',
          version_no: 2,
          is_published: true,
          published_at: '2026-04-06T10:00:00Z',
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-06T10:00:00Z',
          node_count: 20,
          pipe_count: 15,
        },
      ],
      null,
      { preferredBlockId: 'block-b', fallbackToAnyBlock: false },
    );

    expect(picked?.id).toBe('ver-b');
  });

  it('ignores explicit version ids from other blocks when selecting graph config', () => {
    const picked = (service as any).pickVersionForConfig(
      [
        {
          id: 'ver-a',
          block_id: 'block-a',
          version_no: 1,
          is_published: true,
          published_at: '2026-04-06T09:00:00Z',
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-06T09:00:00Z',
          node_count: 12,
          pipe_count: 8,
        },
        {
          id: 'ver-b',
          block_id: 'block-b',
          version_no: 2,
          is_published: true,
          published_at: '2026-04-06T10:00:00Z',
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-06T10:00:00Z',
          node_count: 20,
          pipe_count: 15,
        },
      ],
      'ver-a',
      { preferredBlockId: 'block-b', fallbackToAnyBlock: false },
    );

    expect(picked?.id).toBe('ver-b');
  });

  it('reuses the existing draft version in the same block before publish', () => {
    const picked = (service as any).pickDraftVersionForSave(
      [
        {
          id: 'published-a',
          block_id: 'block-a',
          version_no: 1,
          is_published: true,
          published_at: '2026-04-06T10:00:00Z',
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-06T10:00:00Z',
          node_count: 20,
          pipe_count: 15,
        },
        {
          id: 'draft-a',
          block_id: 'block-a',
          version_no: 2,
          is_published: false,
          published_at: null,
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-07T10:00:00Z',
          node_count: 21,
          pipe_count: 16,
        },
        {
          id: 'draft-b',
          block_id: 'block-b',
          version_no: 3,
          is_published: false,
          published_at: null,
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-07T11:00:00Z',
          node_count: 9,
          pipe_count: 7,
        },
      ],
      'block-a',
    );

    expect(picked?.id).toBe('draft-a');
  });

  it('does not treat historical published versions as current drafts', () => {
    const picked = (service as any).pickDraftVersionForSave(
      [
        {
          id: 'history-a',
          block_id: 'block-a',
          version_no: 1,
          is_published: false,
          published_at: '2026-04-06T10:00:00Z',
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-06T10:00:00Z',
          node_count: 20,
          pipe_count: 15,
        },
        {
          id: 'draft-a',
          block_id: 'block-a',
          version_no: 2,
          is_published: false,
          published_at: null,
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-07T10:00:00Z',
          node_count: 21,
          pipe_count: 16,
        },
      ],
      'block-a',
    );

    expect(picked?.id).toBe('draft-a');
  });

  it('only allows explicit draft ids from the same block when saving', () => {
    const sameBlockDraft = (service as any).pickExplicitDraftVersionForSave(
      [
        {
          id: 'published-a',
          block_id: 'block-a',
          version_no: 1,
          is_published: true,
          published_at: '2026-04-06T10:00:00Z',
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-06T10:00:00Z',
          node_count: 20,
          pipe_count: 15,
        },
        {
          id: 'draft-a',
          block_id: 'block-a',
          version_no: 2,
          is_published: false,
          published_at: null,
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-07T10:00:00Z',
          node_count: 21,
          pipe_count: 16,
        },
        {
          id: 'draft-b',
          block_id: 'block-b',
          version_no: 3,
          is_published: false,
          published_at: null,
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-07T11:00:00Z',
          node_count: 9,
          pipe_count: 7,
        },
      ],
      'draft-a',
      'block-a',
    );

    const picked = (service as any).pickExplicitDraftVersionForSave(
      [
        {
          id: 'published-a',
          block_id: 'block-a',
          version_no: 1,
          is_published: true,
          published_at: '2026-04-06T10:00:00Z',
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-06T10:00:00Z',
          node_count: 20,
          pipe_count: 15,
        },
        {
          id: 'draft-a',
          block_id: 'block-a',
          version_no: 2,
          is_published: false,
          published_at: null,
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-07T10:00:00Z',
          node_count: 21,
          pipe_count: 16,
        },
        {
          id: 'draft-b',
          block_id: 'block-b',
          version_no: 3,
          is_published: false,
          published_at: null,
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-07T11:00:00Z',
          node_count: 9,
          pipe_count: 7,
        },
      ],
      'published-a',
      'block-a',
    );

    const crossBlock = (service as any).pickExplicitDraftVersionForSave(
      [
        {
          id: 'draft-a',
          block_id: 'block-a',
          version_no: 2,
          is_published: false,
          published_at: null,
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-07T10:00:00Z',
          node_count: 21,
          pipe_count: 16,
        },
        {
          id: 'draft-b',
          block_id: 'block-b',
          version_no: 3,
          is_published: false,
          published_at: null,
          source_file_ref: null,
          source_meta: {},
          created_at: '2026-04-07T11:00:00Z',
          node_count: 9,
          pipe_count: 7,
        },
      ],
      'draft-b',
      'block-a',
    );

    expect(sameBlockDraft?.id).toBe('draft-a');
    expect(picked).toBeNull();
    expect(crossBlock).toBeNull();
  });

  it('returns only block-scoped model versions from getConfig', async () => {
    jest.spyOn(service as any, 'resolveContext').mockResolvedValue({
      projects: [],
      blocks: [],
      selected_project_id: 'project-1',
      selected_block_id: 'block-a',
      selected_block: null,
    });
    jest.spyOn(service as any, 'loadMeteringPoints').mockResolvedValue([]);
    jest.spyOn(service as any, 'loadNetworkModel').mockResolvedValue(null);
    jest.spyOn(service as any, 'loadPumpValveRelations').mockResolvedValue([]);
    jest.spyOn(service as any, 'loadDeviceRelations').mockResolvedValue([]);
    jest.spyOn(service as any, 'loadModelVersions').mockResolvedValue([
      {
        id: 'draft-a',
        block_id: 'block-a',
        version_no: 3,
        is_published: false,
        published_at: null,
        source_file_ref: null,
        source_meta: {},
        created_at: '2026-04-07T10:00:00Z',
        node_count: 21,
        pipe_count: 16,
      },
      {
        id: 'published-b',
        block_id: 'block-b',
        version_no: 2,
        is_published: true,
        published_at: '2026-04-06T10:00:00Z',
        source_file_ref: null,
        source_meta: {},
        created_at: '2026-04-06T10:00:00Z',
        node_count: 20,
        pipe_count: 15,
      },
    ]);
    jest.spyOn(service as any, 'getDeviceContract').mockReturnValue({});

    const config = await service.getConfig('project-1', 'block-a');

    expect(config.model_versions).toEqual([
      expect.objectContaining({
        id: 'draft-a',
        block_id: 'block-a',
      }),
    ]);
  });

  it('ignores explicit cross-block version ids when loading graph data', async () => {
    jest.spyOn(service as any, 'resolveContext').mockResolvedValue({
      projects: [],
      blocks: [],
      selected_project_id: 'project-1',
      selected_block_id: 'block-a',
      selected_block: null,
    });
    jest.spyOn(service as any, 'loadNetworkModel').mockResolvedValue({ id: 'model-1' });
    jest.spyOn(service as any, 'loadModelVersions').mockResolvedValue([
      {
        id: 'published-a',
        block_id: 'block-a',
        version_no: 1,
        is_published: true,
        published_at: '2026-04-06T10:00:00Z',
        source_file_ref: null,
        source_meta: {},
        created_at: '2026-04-06T10:00:00Z',
        node_count: 20,
        pipe_count: 15,
      },
      {
        id: 'published-b',
        block_id: 'block-b',
        version_no: 2,
        is_published: true,
        published_at: '2026-04-06T11:00:00Z',
        source_file_ref: null,
        source_meta: {},
        created_at: '2026-04-06T11:00:00Z',
        node_count: 25,
        pipe_count: 18,
      },
    ]);
    const loadGraph = jest.spyOn(service as any, 'loadGraph').mockResolvedValue({
      nodes: [{ node_code: 'SRC-001' }],
      pipes: [{ pipe_code: 'PIPE-001' }],
    });

    const graph = await service.getGraph('project-1', 'block-a', 'published-b');

    expect(graph.selected_version).toEqual(
      expect.objectContaining({
        id: 'published-a',
        block_id: 'block-a',
      }),
    );
    expect(loadGraph).toHaveBeenCalledWith('published-a');
  });
});
