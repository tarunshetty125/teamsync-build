// electron/audio/whisper/hardwareDetect.ts
// Detects hardware capabilities and recommends optimal Whisper model.

import * as os from 'os';
import type { HardwareInfo } from './types';

/** Detect hardware and recommend optimal model/provider configuration. */
export function detectHardware(): HardwareInfo {
  const arch = process.arch;
  const platform = process.platform;
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model ?? 'Unknown';
  const totalRamGb = Math.round(os.totalmem() / 1024 ** 3);
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64';
  const isIntelMac = platform === 'darwin' && arch === 'x64';

  let tier: HardwareInfo['tier'];
  let recommendation: string;
  let recommendedModel: string;

  if (isAppleSilicon) {
    tier = 'excellent';
    recommendation = 'Apple Silicon — CoreML activates Metal GPU via ONNX Runtime. Moonshine Base streams in near real-time on the Neural Engine.';
    recommendedModel = 'onnx-community/moonshine-base-ONNX';
  } else if (isIntelMac) {
    tier = 'limited';
    recommendation = 'Intel Mac — CPU inference with int8 quantization. Moonshine Tiny streams in real-time on CPU; Cloud STT (Groq/Deepgram) recommended for long multilingual sessions.';
    recommendedModel = 'onnx-community/moonshine-tiny-ONNX';
  } else if (platform === 'win32' && totalRamGb >= 8) {
    tier = 'good';
    recommendation = 'Windows — DirectML activates GPU acceleration (NVIDIA, AMD, Intel) via ONNX Runtime. Moonshine Base streams in real-time on most gaming hardware.';
    recommendedModel = totalRamGb >= 16 ? 'onnx-community/moonshine-base-ONNX' : 'onnx-community/moonshine-tiny-ONNX';
  } else if (platform === 'linux') {
    tier = 'good';
    recommendation = 'Linux — ONNX Runtime CPU with int8 quantization. Moonshine Base offers near real-time streaming.';
    recommendedModel = 'onnx-community/moonshine-base-ONNX';
  } else {
    tier = 'limited';
    recommendation = 'Limited hardware — Moonshine Tiny streams in real-time even on minimal CPUs.';
    recommendedModel = 'onnx-community/moonshine-tiny-ONNX';
  }

  return { arch, platform, cpuModel, isAppleSilicon, totalRamGb, tier, recommendation, recommendedModel };
}
