// electron/audio/whisper/vadProcessor.ts
// Voice Activity Detection (VAD) processor using energy-based RMS thresholding.
// Segments audio into speech/silence regions with hangover and max-duration limits.

import type { SpeechSegment } from './types';

const WINDOW_SIZE = 480;       // ~30ms at 16kHz
const RMS_THRESHOLD = 0.008;
const HANGOVER_FRAMES = 10;    // Keep segment open 10 frames after last speech
const MIN_SPEECH_FRAMES = 4;   // Minimum frames for a valid segment
const MAX_SPEECH_MS = 15_000;  // Hard-cap segment duration

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (end - start));
}

export class VadProcessor {
  private buffer: Float32Array[] = [];
  private speechBuffer: Float32Array[] = [];
  private hangoverCount = 0;
  private inSpeech = false;
  private speechFrameCount = 0;
  private speechDurationMs = 0;
  private segmentIdCounter = 0;

  /** Push audio samples through the VAD. Returns completed speech segments. */
  push(samples: Float32Array): SpeechSegment[] {
    const segments: SpeechSegment[] = [];
    let input = samples;

    // Merge leftover buffer
    if (this.buffer.length > 0) {
      const totalLen = this.buffer.reduce((acc, f) => acc + f.length, 0) + samples.length;
      const merged = new Float32Array(totalLen);
      let pos = 0;
      for (const f of this.buffer) { merged.set(f, pos); pos += f.length; }
      merged.set(samples, pos);
      input = merged;
      this.buffer = [];
    }

    let offset = 0;
    while (offset + WINDOW_SIZE <= input.length) {
      const window = input.subarray(offset, offset + WINDOW_SIZE);
      offset += WINDOW_SIZE;
      const energy = rms(window, 0, window.length);
      const isSpeech = energy >= RMS_THRESHOLD;

      if (isSpeech) {
        this.hangoverCount = HANGOVER_FRAMES;
        if (!this.inSpeech) {
          this.inSpeech = true;
          this.speechFrameCount = 0;
          this.speechDurationMs = 0;
          this.speechBuffer = [];
          this.segmentIdCounter++;
        }
      }

      if (this.inSpeech) {
        this.speechBuffer.push(window.slice());
        this.speechFrameCount++;
        this.speechDurationMs += 30;

        if (!isSpeech) this.hangoverCount--;

        if (this.speechDurationMs >= MAX_SPEECH_MS) {
          const seg = this.buildSegment();
          if (seg) segments.push(seg);
          this.resetSpeech();
        } else if (this.hangoverCount <= 0) {
          if (this.speechFrameCount >= MIN_SPEECH_FRAMES) {
            const seg = this.buildSegment();
            if (seg) segments.push(seg);
          }
          this.resetSpeech();
        }
      }
    }

    // Buffer remaining samples
    if (offset < input.length) {
      this.buffer.push(input.subarray(offset).slice());
    }

    return segments;
  }

  /**
   * Peek at the open speech segment without closing it.
   * Used for streaming partial inference while user is still speaking.
   */
  peekOpenSegment(): SpeechSegment | null {
    if (!this.inSpeech || this.speechBuffer.length === 0) return null;
    const totalLen = this.speechBuffer.reduce((acc, f) => acc + f.length, 0);
    if (totalLen === 0) return null;
    const combined = new Float32Array(totalLen);
    let pos = 0;
    for (const frame of this.speechBuffer) { combined.set(frame, pos); pos += frame.length; }
    return { samples: combined, durationMs: this.speechDurationMs };
  }

  /**
   * Soft-commit: emit the open segment and carry tail audio forward
   * for acoustic context overlap across the cut.
   */
  softCommit(): SpeechSegment | null {
    if (!this.inSpeech) return null;
    const seg = this.buildSegment();
    const TAIL_FRAMES = Math.min(10, this.speechBuffer.length);
    const tail = TAIL_FRAMES > 0 ? this.speechBuffer.slice(-TAIL_FRAMES) : [];
    this.resetSpeech();
    if (tail.length > 0) {
      this.inSpeech = true;
      this.speechBuffer = tail;
      this.speechFrameCount = tail.length;
      this.speechDurationMs = tail.length * 30;
      this.hangoverCount = HANGOVER_FRAMES;
      this.segmentIdCounter++;
    }
    return seg;
  }

  isInSpeech(): boolean { return this.inSpeech; }

  /** Monotonic segment ID — increments each time a new segment opens. */
  currentSegmentId(): number { return this.segmentIdCounter; }

  /** Flush any remaining audio as final segments. */
  flush(): SpeechSegment[] {
    const segments: SpeechSegment[] = [];
    if (this.inSpeech && this.speechFrameCount >= MIN_SPEECH_FRAMES) {
      const seg = this.buildSegment();
      if (seg) segments.push(seg);
    }
    this.resetSpeech();
    this.buffer = [];
    return segments;
  }

  reset(): void {
    this.resetSpeech();
    this.buffer = [];
  }

  private buildSegment(): SpeechSegment | null {
    if (this.speechBuffer.length === 0) return null;
    const totalLen = this.speechBuffer.reduce((acc, f) => acc + f.length, 0);
    const combined = new Float32Array(totalLen);
    let pos = 0;
    for (const frame of this.speechBuffer) { combined.set(frame, pos); pos += frame.length; }
    return { samples: combined, durationMs: this.speechDurationMs };
  }

  private resetSpeech(): void {
    this.inSpeech = false;
    this.hangoverCount = 0;
    this.speechFrameCount = 0;
    this.speechDurationMs = 0;
    this.speechBuffer = [];
  }
}
