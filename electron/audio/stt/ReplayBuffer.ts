export interface ReplayBufferEntry {
  timestamp: number;
  chunk: Buffer;
}

export interface ReplayBufferOptions {
  maxDurationMs?: number;
  maxEntries?: number;
  maxBytes?: number;
}

export class ReplayBuffer {
  private readonly maxDurationMs: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private entries: ReplayBufferEntry[] = [];
  private totalBytes = 0;

  constructor(optionsOrMaxDurationMs: ReplayBufferOptions | number = 12_000) {
    const options = typeof optionsOrMaxDurationMs === "number"
      ? { maxDurationMs: optionsOrMaxDurationMs }
      : optionsOrMaxDurationMs;

    this.maxDurationMs = options.maxDurationMs ?? 12_000;
    this.maxEntries = Math.max(32, options.maxEntries ?? Number(process.env.STT_REPLAY_MAX_ENTRIES || 4_096));
    this.maxBytes = Math.max(256 * 1024, options.maxBytes ?? Number(process.env.STT_REPLAY_MAX_BYTES || 24 * 1024 * 1024));
  }

  public push(chunk: Buffer, timestamp: number = Date.now()): void {
    const copy = Buffer.from(chunk);
    this.entries.push({
      timestamp,
      chunk: copy,
    });
    this.totalBytes += copy.length;
    this.prune(timestamp);
  }

  public snapshot(): ReplayBufferEntry[] {
    return this.entries.map((entry) => ({
      timestamp: entry.timestamp,
      chunk: Buffer.from(entry.chunk),
    }));
  }

  public getEntryCount(): number {
    return this.entries.length;
  }

  public getTotalBytes(): number {
    return this.totalBytes;
  }

  public getDurationMs(): number {
    if (this.entries.length < 2) {
      return 0;
    }
    return Math.max(0, this.entries[this.entries.length - 1].timestamp - this.entries[0].timestamp);
  }

  public clear(): void {
    this.entries = [];
    this.totalBytes = 0;
  }

  public pruneNow(now: number = Date.now()): void {
    this.prune(now);
  }

  public dropOldestChunk(): void {
    if (this.entries.length > 0) {
      const oldest = this.entries.shift();
      if (oldest) {
        this.totalBytes = Math.max(0, this.totalBytes - oldest.chunk.length);
      }
    }
  }

  private prune(now: number): void {
    const cutoff = now - this.maxDurationMs;
    while (this.entries.length > 0) {
      const oldest = this.entries[0];
      const exceedsDuration = oldest.timestamp < cutoff;
      const exceedsEntries = this.entries.length > this.maxEntries;
      const exceedsBytes = this.totalBytes > this.maxBytes;

      if (!exceedsDuration && !exceedsEntries && !exceedsBytes) {
        break;
      }

      this.entries.shift();
      this.totalBytes = Math.max(0, this.totalBytes - oldest.chunk.length);
    }
  }
}
