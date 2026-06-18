// electron/llm/codingStreamGate.ts
// Gates coding answer streaming — holds back initial tokens until a heading
// is detected (ensures the contract's `## Approach` comes first, not raw code).

export class CodingStreamGate {
  private buf = '';
  private opened = false;

  /** Max chars to buffer before force-flushing. */
  static readonly MAX_GATE_CHARS = 48;

  /**
   * Feed one raw token. Returns the text to EMIT now:
   *  - while gating and not yet safe: '' (buffered)
   *  - on the chunk that opens the gate: the whole accumulated prefix
   *  - once open: the token verbatim (pass-through)
   */
  push(token: string): string {
    if (this.opened) return token;
    this.buf += token;
    if (this.shouldOpen()) {
      this.opened = true;
      const flush = this.buf;
      this.buf = '';
      return flush;
    }
    return '';
  }

  /**
   * Flush whatever remains at stream end. Covers the short-answer case where
   * the gate never opened (e.g. a terse reply with no heading).
   */
  finish(): string {
    if (this.opened) return '';
    this.opened = true;
    const flush = this.buf;
    this.buf = '';
    return flush;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** True once any non-empty chunk has been (or is being) emitted. */
  hasEmitted(): boolean {
    return this.opened;
  }

  private shouldOpen(): boolean {
    if (this.buf.length >= CodingStreamGate.MAX_GATE_CHARS) return true;
    const t = this.buf.trimStart();
    if (/^#{1,3}\s/.test(t)) return true;
    if (/^#{1,3}$/.test(t)) return false;
    return false;
  }
}
