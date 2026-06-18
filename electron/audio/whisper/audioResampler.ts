// electron/audio/whisper/audioResampler.ts
// Resamples 16-bit PCM Buffer to 16kHz Float32Array for Whisper inference.

/** Convert a 16-bit PCM Buffer at arbitrary sample rate to 16kHz Float32Array. */
export function resampleToF32(chunk: Buffer, inputSampleRate: number): Float32Array {
  const TARGET_RATE = 16_000;
  const inputSamples = chunk.byteLength / 2;
  const input = new Float32Array(inputSamples);
  for (let i = 0; i < inputSamples; i++) {
    input[i] = chunk.readInt16LE(i * 2) / 32768;
  }
  if (inputSampleRate === TARGET_RATE) {
    return input;
  }
  // Linear interpolation resampling
  const ratio = inputSampleRate / TARGET_RATE;
  const outputLength = Math.round(inputSamples / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;
    const s0 = input[srcIdx] ?? 0;
    const s1 = input[srcIdx + 1] ?? s0;
    output[i] = s0 + frac * (s1 - s0);
  }
  return output;
}
