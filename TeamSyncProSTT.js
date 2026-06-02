var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var TeamSyncProSTT_exports = {};
__export(TeamSyncProSTT_exports, {
  TeamSyncProSTT: () => TeamSyncProSTT
});
module.exports = __toCommonJS(TeamSyncProSTT_exports);
var import_events = require("events");
var import_ws = __toESM(require("ws"));
var import_languages = require("../config/languages");
class TeamSyncProSTT extends import_events.EventEmitter {
  apiKey;
  channel;
  // 'system' | 'mic' — disambiguates concurrent streams per key
  ws = null;
  isActive = false;
  isConnected = false;
  isConnecting = false;
  intentionalClose = false;
  // set true before deliberate closeUpstream() to suppress auto-reconnect
  sampleRate = 16e3;
  audioChannels = 1;
  buffer = [];
  // Language state — updated via setRecognitionLanguage()
  languageBcp47 = "en-US";
  languageAlternates = [];
  // The key the caller last configured (e.g. 'auto', 'english-us').
  // Preserved so stop() can reset languageBcp47 back to the configured value,
  // ensuring the next start() sends 'auto' again rather than a stale detected language.
  configuredLanguageKey = "en-US";
  reconnectAttempts = 0;
  MAX_RECONNECT = 5;
  RECONNECT_BASE_MS = 1500;
  reconnectTimer = null;
  // Cleared only after 5 s of stable connection so backoff actually increases on rapid 1006 loops
  stabilityTimer = null;
  BACKEND_URL = "wss://api.teamsync-ai.vercel.app/v1/transcribe";
  // Static: stagger concurrent connections with the same key so both instances
  // don't hit the server (and its upstream Deepgram key rotation) simultaneously.
  static nextSlotByKey = /* @__PURE__ */ new Map();
  static SLOT_INTERVAL_MS = 3e3;
  constructor(apiKey, channel = "system") {
    super();
    this.apiKey = apiKey;
    this.channel = channel;
  }
  // ── Configuration setters ─────────────────────────────────
  setSampleRate(rate) {
    this.sampleRate = rate;
    console.log(`[TeamSyncProSTT:${this.channel}] Sample rate configured to ${rate}Hz`);
  }
  setAudioChannelCount(count) {
    this.audioChannels = count;
  }
  /**
   * Converts the internal language key (e.g. "english-us", "russian")
   * into BCP-47 codes and stores them for the next handshake.
   * If the stream is already active, reconnect so the new language takes effect.
   */
  setRecognitionLanguage(key) {
    this.configuredLanguageKey = key;
    if (key === "auto") {
      this.languageBcp47 = "auto";
      this.languageAlternates = [];
      console.log("[TeamSyncProSTT] Language set to auto-detect mode");
    } else {
      const config = import_languages.RECOGNITION_LANGUAGES[key];
      if (!config) {
        console.warn(`[TeamSyncProSTT] Unknown language key: ${key}`);
        return;
      }
      this.languageBcp47 = config.bcp47;
      this.languageAlternates = "alternates" in config ? config.alternates : [];
      console.log(
        `[TeamSyncProSTT] Language set: ${key} \u2192 ${this.languageBcp47}`,
        this.languageAlternates.length ? `(alts: ${this.languageAlternates.join(", ")})` : ""
      );
    }
    if (this.isActive && this.ws) {
      console.log("[TeamSyncProSTT] Language changed while active \u2014 reconnecting");
      this.reconnectAttempts = 0;
      this.intentionalClose = true;
      this.closeUpstream();
      setTimeout(() => {
        if (this.isActive) this.connect();
      }, 250);
    }
  }
  /** No-op — TeamSync API server handles VAD internally */
  notifySpeechEnded() {
  }
  setCredentials(_path) {
  }
  // ── Lifecycle ─────────────────────────────────────────────
  start() {
    if (this.isActive) return;
    this.isActive = true;
    this.reconnectAttempts = 0;
    this.connect();
  }
  stop() {
    this.isActive = false;
    this._chunksSent = 0;
    this.intentionalClose = false;
    if (this.configuredLanguageKey === "auto") {
      this.languageBcp47 = "auto";
      this.languageAlternates = [];
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
    this.closeUpstream();
    this.buffer = [];
  }
  _chunksSent = 0;
  write(chunk) {
    if (!this.isActive) return;
    if (!this.isConnected || !this.ws || this.ws.readyState !== import_ws.default.OPEN) {
      this.buffer.push(chunk);
      if (this.buffer.length > 500) this.buffer.shift();
      if (this.buffer.length <= 3 || this.buffer.length % 100 === 0) {
        const wsState = this.ws ? ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][this.ws.readyState] || this.ws.readyState : "null";
        console.log(`[TeamSyncProSTT:${this.channel}] Buffering chunk (buffer=${this.buffer.length}, isConnected=${this.isConnected}, ws=${wsState})`);
      }
      return;
    }
    this._chunksSent++;
    if (this._chunksSent <= 5 || this._chunksSent % 200 === 0) {
      console.log(`[TeamSyncProSTT:${this.channel}] Sent chunk #${this._chunksSent} (${chunk.length}B) to server`);
    }
    this.ws.send(chunk);
  }
  // ── Internal ──────────────────────────────────────────────
  connect(skipStagger = false) {
    if (this.isConnecting || !this.isActive) return;
    if (!skipStagger) {
      const now = Date.now();
      const reserved = TeamSyncProSTT.nextSlotByKey.get(this.apiKey) ?? 0;
      const staggerMs = Math.max(0, reserved - now);
      TeamSyncProSTT.nextSlotByKey.set(this.apiKey, Math.max(now, reserved) + TeamSyncProSTT.SLOT_INTERVAL_MS);
      if (staggerMs > 0) {
        this.isConnecting = true;
        console.log(`[TeamSyncProSTT:${this.channel}] Staggering connection ${staggerMs}ms (concurrent key collision prevention)`);
        setTimeout(() => {
          this.isConnecting = false;
          if (this.isActive) this.connect(true);
        }, staggerMs);
        return;
      }
    }
    this.isConnecting = true;
    this.isConnected = false;
    console.log(`[TeamSyncProSTT] Connecting (attempt ${this.reconnectAttempts + 1})...`);
    this.ws = new import_ws.default(this.BACKEND_URL);
    this.ws.on("open", () => {
      if (!this.isActive) {
        this.ws?.close();
        return;
      }
      const baseFrame = {
        key: this.apiKey,
        sample_rate: this.sampleRate,
        language: this.languageBcp47,
        language_alternates: this.languageAlternates,
        audio_channels: this.audioChannels,
        channel: this.channel
      };
      this.ws.send(JSON.stringify(baseFrame));
    });
    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!msg.text || msg.is_final) {
          console.log(`[TeamSyncProSTT:${this.channel}] Server msg:`, JSON.stringify(msg).slice(0, 120));
        }
        if (msg.error) {
          console.error("[TeamSyncProSTT] Server error:", msg.error, msg.message || "");
          this.emit("error", new Error(msg.error));
          if (msg.error === "auth_timeout" || msg.error === "invalid_key_format" || msg.error === "transcription_quota_exceeded") {
            this.isActive = false;
          }
          return;
        }
        if (msg.status === "connected") {
          this.isConnecting = false;
          this.isConnected = true;
          console.log(`[TeamSyncProSTT] Connected via ${msg.provider}`);
          if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
          this.stabilityTimer = setTimeout(() => {
            this.stabilityTimer = null;
            this.reconnectAttempts = 0;
          }, 5e3);
          this.flushBuffer();
          return;
        }
        if (msg.language_detected) {
          const detected = msg.language_detected;
          console.log(`[TeamSyncProSTT] Auto-detected language: ${detected}`);
          this.languageBcp47 = detected;
          this.languageAlternates = [];
          this.reconnectAttempts = 0;
          this.emit("languageDetected", detected);
          if (this.isActive && this.ws) {
            this.intentionalClose = true;
            this.closeUpstream();
            setTimeout(() => {
              if (this.isActive) this.connect();
            }, 250);
          }
          return;
        }
        if (msg.text) {
          this.emit("transcript", {
            text: msg.text,
            isFinal: msg.is_final ?? false,
            confidence: msg.confidence ?? 1
          });
        }
      } catch (err) {
        console.error("[TeamSyncProSTT] Parse error:", err);
      }
    });
    this.ws.on("error", (err) => {
      console.error("[TeamSyncProSTT] WebSocket error:", err.message);
      this.isConnecting = false;
      this.isConnected = false;
      this.emit("error", err);
    });
    this.ws.on("close", (code) => {
      this.isConnecting = false;
      this.isConnected = false;
      console.log(`[TeamSyncProSTT] Connection closed (code ${code})`);
      if (this.intentionalClose) {
        this.intentionalClose = false;
        return;
      }
      if (this.isActive) {
        this.scheduleReconnect();
      }
    });
  }
  scheduleReconnect() {
    if (!this.isActive) return;
    this._chunksSent = 0;
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
    if (this.reconnectAttempts >= this.MAX_RECONNECT) {
      console.error("[TeamSyncProSTT] Max reconnect attempts reached \u2014 giving up");
      this.emit("error", new Error("TeamSyncProSTT: max reconnect attempts exceeded"));
      return;
    }
    const delay = this.RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    console.log(`[TeamSyncProSTT] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isActive) this.connect();
    }, delay);
  }
  flushBuffer() {
    if (!this.ws || this.ws.readyState !== import_ws.default.OPEN) return;
    while (this.buffer.length > 0) {
      const chunk = this.buffer.shift();
      if (chunk) this.ws.send(chunk);
    }
  }
  closeUpstream() {
    this.isConnected = false;
    this.isConnecting = false;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
      }
      this.ws = null;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TeamSyncProSTT
});
//# sourceMappingURL=TeamSyncProSTT.js.map
