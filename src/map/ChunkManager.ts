import type { StreamedCell } from './StreamedMap';

interface CachedCell {
  cell: StreamedCell;
  lastUsed: number;
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
    private readonly radius: number,
    private readonly onRegion: (cells: StreamedCell[]) => void,
    private readonly onError: (error: Error) => void
  ) {}

  updateCenter(centerX: number, centerY: number): void {
    if (this.disposed) return;
    const center = `${centerX},${centerY}`;
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
    void this.loadRegion(centerX, centerY, requestId, center)
      .then((cells) => {
        if (this.disposed || requestId !== this.requestId || this.targetCenter !== center) return;
        this.activeCells = cells;
        this.appliedCenter = center;
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
              this.updateCenter(centerX, centerY);
            }
          }, 2000);
        }
      });
  }

  get currentCells(): readonly StreamedCell[] {
    return this.activeCells;
  }

  get currentCenter(): { x: number; y: number } | null {
    if (!this.appliedCenter) return null;
    const [x, y] = this.appliedCenter.split(',').map(Number);
    return { x, y };
  }

  dispose(): void {
    this.disposed = true;
    this.requestId++;
    this.activeCells = [];
    this.cache.clear();
    this.inFlight.clear();
  }

  private async loadRegion(centerX: number, centerY: number, requestId: number, center: string): Promise<StreamedCell[]> {
    const coordinates: Array<{ x: number; y: number }> = [];
    for (let y = centerY - this.radius; y <= centerY + this.radius; y++) {
      for (let x = centerX - this.radius; x <= centerX + this.radius; x++) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
        coordinates.push({ x, y });
      }
    }
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
