/// <reference lib="webworker" />

import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
  type ProgressInfo,
} from "@huggingface/transformers";
import wasmFactoryUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import {
  CHAT_HISTORY_EMBEDDING_CACHE_KEY,
  CHAT_HISTORY_EMBEDDING_MODEL,
  CHAT_HISTORY_EMBEDDING_MODEL_REVISION,
} from "@/lib/chat-history-embedding-config";

interface EmbedRequest {
  type: "embed";
  id: number;
  texts: string[];
}

const workerScope = self as DedicatedWorkerGlobalScope;

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
// The runtime WASM ships with the app. Only model artifacts need CacheStorage.
env.useWasmCache = false;
env.cacheKey = CHAT_HISTORY_EMBEDDING_CACHE_KEY;
// Transformers.js 4.2 discovers some pipeline files against `main` even when
// a revision option is supplied. Pin the URL template itself so every fetched
// and cached artifact comes from the same immutable model revision.
env.remotePathTemplate = `{model}/resolve/${CHAT_HISTORY_EMBEDDING_MODEL_REVISION}/`;
const wasmBackend = env.backends.onnx.wasm;
if (!wasmBackend) {
  throw new Error("ONNX WASM backend is unavailable.");
}
wasmBackend.numThreads = 1;
wasmBackend.proxy = false;
wasmBackend.wasmPaths = {
  mjs: wasmFactoryUrl,
  wasm: wasmUrl,
};

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isEmbedRequest(event.data)) return;
  void handleEmbedRequest(event.data);
});

async function handleEmbedRequest(request: EmbedRequest) {
  try {
    const extractor = await getExtractor();
    const output = await extractor(request.texts, {
      pooling: "mean",
      normalize: true,
    });
    const embeddings = output.tolist();
    workerScope.postMessage({
      type: "result",
      id: request.id,
      embeddings,
    });
  } catch (error) {
    // Allow a later request to retry after a transient download/cache failure.
    extractorPromise = null;
    workerScope.postMessage({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : "Embedding failed",
    });
  }
}

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "feature-extraction",
      CHAT_HISTORY_EMBEDDING_MODEL,
      {
        device: "wasm",
        dtype: "q8",
        progress_callback: reportProgress,
      },
    );
  }
  return extractorPromise;
}

function reportProgress(progress: ProgressInfo) {
  workerScope.postMessage({
    type: "progress",
    status: progress.status,
    file: "file" in progress ? progress.file : undefined,
    progress: "progress" in progress ? progress.progress : undefined,
  });
}

function isEmbedRequest(value: unknown): value is EmbedRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<EmbedRequest>;
  return (
    request.type === "embed" &&
    typeof request.id === "number" &&
    Array.isArray(request.texts) &&
    request.texts.length > 0 &&
    request.texts.every((text) => typeof text === "string")
  );
}
