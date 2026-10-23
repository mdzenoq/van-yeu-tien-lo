import type { StreamedCell } from './StreamedMap';

interface CachedCell {
  cell: StreamedCell;
  lastUsed: number;
}

interface CellCenter {
  x: number;
  y: number;
}

const MAX_CACHED_CELLS = 64;
const MAX_FETCH_ATTEMPTS = 3;
const MAX_CONCURRENT_CELL_REQUESTS = 12;

/** Loads and retains only the bounded cell neighborhood around the current tile. */
export class ChunkManager {
  private readonly cache = new Map<string, CachedCell>();
  private readonly inFlight = new Map<string, Promise<StreamedCell>>();
  private activeCells: StreamedCell[] = [];
  private requestedCenter = '';
  private appliedCenter = '';
  private appliedPrimaryCenter = '';
  private failedCenter = '';
  private targetCenter = '';
  private requestId = 0;
  private nextRetryAt = 0;
  private regionRetryCount = 0;
  private disposed = false;

  constructor(
    private readonly baseUrl: string,
    private readonly width: number,
    private readonly height: number,
    private readonly regionWidth: number,
    private readonly regionHeight: number,
    private readonly onRegion: (cells: StreamedCell[]) => void,
    private readonly onError: (error: Error) => void
  ) {
    if (!Number.isInteger(regionWidth) || regionWidth < 1 || !Number.isInteger(regionHeight) || regionHeight < 1) {
      throw new Error('Kích thước vùng tải map phải là số nguyên dương.');
    }
  }

  updateCenter(centerX: number, centerY: number): void {
    this.updateCenters([{ x: centerX, y: centerY }]);
  }

  updateCenters(centers: readonly CellCenter[]): void {
    if (this.disposed) return;
    if (centers.length === 0) return;
    const [primary, ...others] = centers;
    const uniqueCenters = [
      primary,
      ...[...new Map(others.map((center) => [`${center.x},${center.y}`, center])).values()].sort(
        (a, b) => a.x - b.x || a.y - b.y
      )
    ];
    const center = uniqueCenters.map(({ x, y }) => `${x},${y}`).join('|');
    this.targetCenter = center;
    if (center === this.appliedCenter) {
      if (this.requestedCenter && this.requestedCenter !== center) {
        this.requestId++;
        this.requestedCenter = '';
      }
      return;
    }
    if (center === this.requestedCenter) return;
    if (center === this.failedCenter) {
      if (Date.now() < this.nextRetryAt) return;
    } else {
      this.regionRetryCount = 0;
    }

    this.requestedCenter = center;
    const requestId = ++this.requestId;
    void this.loadRegion(uniqueCenters, requestId, center)
      .then((cells) => {
        if (this.disposed || requestId !== this.requestId || this.targetCenter !== center) return;
        this.activeCells = cells;
        this.appliedCenter = center;
        this.appliedPrimaryCenter = `${primary.x},${primary.y}`;
        this.failedCenter = '';
        this.nextRetryAt = 0;
        this.regionRetryCount = 0;
        this.evictUnusedCells();
        this.onRegion(cells);
      })
      .catch((error: unknown) => {
        if (this.disposed || requestId !== this.requestId || this.targetCenter !== center) return;
        this.requestedCenter = '';
        this.failedCenter = center;
        this.nextRetryAt = Date.now() + 2000;
        this.onError(error instanceof Error ? error : new Error(String(error)));
        if (this.regionRetryCount < 2) {
          this.regionRetryCount++;
          window.setTimeout(() => {
            if (!this.disposed && this.targetCenter === center && this.appliedCenter !== center) {
              this.updateCenters(uniqueCenters);
            }
          }, 2000);
        }
      });
  }

  get currentCells(): readonly StreamedCell[] {
    return this.activeCells;
  }

  get currentCenter(): { x: number; y: number } | null {
    if (!this.appliedPrimaryCenter) return null;
    const [x, y] = this.appliedPrimaryCenter.split(',').map(Number);
    return { x, y };
  }

  dispose(): void {
    this.disposed = true;
    this.requestId++;
    this.activeCells = [];
    this.cache.clear();
    this.inFlight.clear();
  }

  private async loadRegion(centers: readonly CellCenter[], requestId: number, center: string): Promise<StreamedCell[]> {
    const coordinateMap = new Map<string, CellCenter>();
    const left = Math.floor((this.regionWidth - 1) / 2);
    const right = this.regionWidth - left - 1;
    const top = Math.floor((this.regionHeight - 1) / 2);
    const bottom = this.regionHeight - top - 1;
    for (const regionCenter of centers) {
      for (let y = regionCenter.y - top; y <= regionCenter.y + bottom; y++) {
        for (let x = regionCenter.x - left; x <= regionCenter.x + right; x++) {
          if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
          coordinateMap.set(`${x}_${y}`, { x, y });
        }
      }
    }
    const coordinates = [...coordinateMap.values()];
    const cells: StreamedCell[] = [];
    for (let start = 0; start < coordinates.length; start += MAX_CONCURRENT_CELL_REQUESTS) {
      if (this.disposed || requestId !== this.requestId || this.targetCenter !== center) return [];
      const batch = coordinates.slice(start, start + MAX_CONCURRENT_CELL_REQUESTS);
      cells.push(...(await Promise.all(batch.map(({ x, y }) => this.loadCell(x, y)))));
    }
    return cells;
  }

  private loadCell(x: number, y: number): Promise<StreamedCell> {
    const key = `${x}_${y}`;
    const cached = this.cache.get(key);
    if (cached) {
      cached.lastUsed = Date.now();
      return Promise.resolve(cached.cell);
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = this.fetchCell(x, y);
    this.inFlight.set(key, request);
    void request.finally(() => this.inFlight.delete(key)).catch(() => undefined);
    return request;
  }

  private async fetchCell(x: number, y: number): Promise<StreamedCell> {
    const url = `${this.baseUrl}/cells/${x}_${y}.json`;
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} khi tải ô map (${x}, ${y}): ${url}`);
        const cell = (await response.json()) as StreamedCell;
        if (cell.x !== x || cell.y !== y || !Array.isArray(cell.tiles) || !Array.isArray(cell.objects)) {
          throw new Error(`Dữ liệu ô map (${x}, ${y}) không hợp lệ: ${url}`);
        }
        this.cache.set(`${x}_${y}`, { cell, lastUsed: Date.now() });
        return cell;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_FETCH_ATTEMPTS) {
          await new Promise((resolve) => window.setTimeout(resolve, attempt * 200));
        }
      }
    }
    throw lastError ?? new Error(`Không tải được ô map (${x}, ${y}).`);
  }

  private evictUnusedCells(): void {
    if (this.cache.size <= MAX_CACHED_CELLS) return;
    const active = new Set(this.activeCells.map((cell) => `${cell.x}_${cell.y}`));
    const candidates = [...this.cache.entries()]
      .filter(([key]) => !active.has(key))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.cache.size > MAX_CACHED_CELLS && candidates.length > 0) {
      const [key] = candidates.shift()!;
      this.cache.delete(key);
    }
  }
}
