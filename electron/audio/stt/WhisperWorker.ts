import { parentPort } from "worker_threads";

interface InitMessage {
  type: "init";
  modelId: string;
  modelPath: string;
  allowRemoteModels: boolean;
}

interface TranscribeMessage {
  type: "transcribe";
  requestId: string;
  audioBuffer: ArrayBuffer;
  sampleRate: number;
}

type WorkerMessage = InitMessage | TranscribeMessage;

let pipe: any = null;
let initPromise: Promise<void> | null = null;

async function ensureLoaded(message: InitMessage): Promise<void> {
  if (pipe) {
    return;
  }

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    const { pipeline, env } = await (new Function('return import("@xenova/transformers")')()) as typeof import("@xenova/transformers");
    env.localModelPath = message.modelPath;
    env.allowRemoteModels = message.allowRemoteModels;

    pipe = await pipeline("automatic-speech-recognition", message.modelId, {
      local_files_only: !message.allowRemoteModels,
    });
  })();

  try {
    await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

if (!parentPort) {
  throw new Error("WhisperWorker requires a parentPort");
}

parentPort.on("message", async (message: WorkerMessage) => {
  try {
    if (message.type === "init") {
      await ensureLoaded(message);
      parentPort?.postMessage({ type: "ready" });
      return;
    }

    const startedAt = Date.now();
    const audio = new Float32Array(message.audioBuffer);
    const result = await pipe(audio, {
      sampling_rate: message.sampleRate,
      chunk_length_s: 20,
      stride_length_s: 5,
      return_timestamps: false,
    });
    const text = typeof result === "string"
      ? result
      : typeof result?.text === "string"
        ? result.text
        : "";

    parentPort?.postMessage({
      type: "result",
      requestId: message.requestId,
      text,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    parentPort?.postMessage({
      type: "error",
      requestId: "requestId" in message ? message.requestId : undefined,
      message: failure.message,
    });
  }
});
