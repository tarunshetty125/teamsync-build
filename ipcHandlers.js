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
var ipcHandlers_exports = {};
__export(ipcHandlers_exports, {
  initializeIpcHandlers: () => initializeIpcHandlers
});
module.exports = __toCommonJS(ipcHandlers_exports);
var import_electron = require("electron");
var import_DatabaseManager = require("./db/DatabaseManager");
var import_BenchmarkManager = require("./intelligence/BenchmarkManager");
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));
var import_AudioDevices = require("./audio/AudioDevices");
var import_PermissionManager = require("./services/PermissionManager");
var import_EntitlementVerifier = require("./licensing/EntitlementVerifier");
var import_providerAnalyticsSessionSnapshot = require("../src/lib/providers/providerAnalyticsSessionSnapshot");
var import_sessionExportDelivery = require("../src/lib/export/sessionExportDelivery");
var import_languages = require("./config/languages");
function initializeIpcHandlers(appState) {
  const safeHandle = (channel, listener) => {
    import_electron.ipcMain.removeHandler(channel);
    import_electron.ipcMain.handle(channel, listener);
  };
  let providerAnalyticsSessionSnapshot = null;
  const broadcastProviderAnalyticsSessionSnapshot = (snapshot) => {
    import_electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(import_providerAnalyticsSessionSnapshot.PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.changed, snapshot);
      }
    });
  };
  const permissionManager = import_PermissionManager.PermissionManager.getInstance();
  const entitlementVerifier = import_EntitlementVerifier.EntitlementVerifier.getInstance();
  const toPlanState = (status = entitlementVerifier.getStatus()) => ({
    plan: status.isPremium ? status.plan : "free",
    isActive: status.isPremium,
    provider: status.provider,
    isPremium: status.isPremium,
    status: status.status,
    trial: status.trial,
    expiresAt: status.expiresAt,
    graceUntil: status.graceUntil,
    lastSuccessfulSyncAt: status.lastSuccessfulSyncAt,
    entitlementVersion: status.entitlement?.entitlementVersion,
    features: status.features
  });
  const validateLicenseSender = (event) => {
    const senderId = event?.sender?.id;
    const allowedWindows = [
      appState.getWindowHelper?.().getLauncherWindow?.(),
      appState.settingsWindowHelper?.getSettingsWindow?.()
    ].filter(Boolean);
    return allowedWindows.some((win) => !win.isDestroyed() && win.webContents.id === senderId);
  };
  const rejectUntrustedLicenseSender = (event) => {
    if (!validateLicenseSender(event)) {
      console.warn("[IPC] Blocked licensing IPC from untrusted sender");
      return { success: false, error: "unauthorized_sender" };
    }
    return null;
  };
  const broadcastLicenseState = () => {
    const status = entitlementVerifier.getStatus();
    import_electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send("license-status-changed", toPlanState(status));
    });
  };
  const showOpenDialogNormalized = async (options) => {
    const result = await import_electron.dialog.showOpenDialog(options);
    if (Array.isArray(result)) {
      return {
        canceled: result.length === 0,
        filePaths: result,
        bookmarks: []
      };
    }
    return result;
  };
  const buildSessionExportSaveFilters = (format) => {
    if (format === "pdf") {
      return [
        { name: "PDF Report", extensions: ["pdf"] },
        { name: "All Files", extensions: ["*"] }
      ];
    }
    if (format === "html") {
      return [
        { name: "HTML Report", extensions: ["html"] },
        { name: "All Files", extensions: ["*"] }
      ];
    }
    return [
      { name: "Markdown Report", extensions: ["md"] },
      { name: "All Files", extensions: ["*"] }
    ];
  };
  const renderSessionExportPdfFromHtml = async (html) => {
    const pdfWindow = new import_electron.BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });
    let timeoutHandle;
    try {
      const htmlDataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      await pdfWindow.loadURL(htmlDataUrl);
      const renderPromise = pdfWindow.webContents.printToPDF({
        displayHeaderFooter: false,
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: "Letter",
        generateTaggedPDF: true,
        generateDocumentOutline: true
      });
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`PDF render timed out after ${import_sessionExportDelivery.SESSION_EXPORT_PDF_RUNTIME_BUDGETS.renderTimeoutMs}ms.`));
        }, import_sessionExportDelivery.SESSION_EXPORT_PDF_RUNTIME_BUDGETS.renderTimeoutMs);
      });
      return await Promise.race([renderPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (!pdfWindow.isDestroyed()) {
        pdfWindow.destroy();
      }
    }
  };
  const isProOrTrialActive = () => entitlementVerifier.hasPremiumAccess();
  const hasActiveProPlan = () => entitlementVerifier.hasPremiumAccess();
  const broadcastNegotiationStateChanged = () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return;
      const tracker = orchestrator.getNegotiationTracker();
      const payload = {
        enabled: orchestrator.isNegotiationContextEnabled?.() ?? tracker.isActive(),
        isActive: tracker.isActive(),
        state: tracker.getState()
      };
      import_electron.BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("negotiation_state_changed", payload);
        }
      });
    } catch (error) {
      console.warn("[IPC] Failed to broadcast negotiation state change:", error);
    }
  };
  const clearActiveModeOnLicenseLoss = () => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const manager = ModesManager.getInstance();
      const fallbackGeneralMode = manager.getModes().find((mode) => mode.templateType === "general");
      manager.setSelectedMode(fallbackGeneralMode?.id ?? null);
      manager.setActiveMode(fallbackGeneralMode?.id ?? null);
      broadcastModesState();
      import_electron.BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send("modes-active-cleared");
      });
      console.log("[IPC] Active mode cleared due to license loss");
    } catch (e) {
    }
  };
  const broadcastModesState = () => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const manager = ModesManager.getInstance();
      const state = manager.getState();
      const activeMode = manager.getActiveMode();
      import_electron.BrowserWindow.getAllWindows().forEach((win) => {
        if (win.isDestroyed()) return;
        win.webContents.send("modes-state-changed", state);
        win.webContents.send("mode-changed", {
          id: activeMode?.id ?? null,
          name: activeMode?.name ?? null,
          templateId: activeMode?.templateType ?? null
        });
      });
    } catch (error) {
      console.warn("[IPC] Failed to broadcast modes state:", error);
    }
  };
  const { CalendarIntelligence } = require("./calendar/CalendarIntelligence");
  const calendarIntelligence = CalendarIntelligence.getInstance();
  const broadcastCalendarRecommendation = (recommendation = calendarIntelligence.getRecommendation()) => {
    try {
      import_electron.BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("calendar-intelligence-changed", recommendation);
        }
      });
    } catch (error) {
      console.warn("[IPC] Failed to broadcast calendar recommendation:", error);
    }
  };
  calendarIntelligence.on("recommendation-changed", (recommendation) => {
    broadcastCalendarRecommendation(recommendation);
  });
  safeHandle("test-release-fetch", async () => {
    try {
      console.log("[IPC] Manual Test Fetch triggered (forcing refresh)...");
      const { ReleaseNotesManager } = require("./update/ReleaseNotesManager");
      const notes = await ReleaseNotesManager.getInstance().fetchReleaseNotes("latest", true);
      if (notes) {
        console.log("[IPC] Notes fetched for:", notes.version);
        const info = {
          version: notes.version || "latest",
          files: [],
          path: "",
          sha512: "",
          releaseName: notes.summary,
          releaseNotes: notes.fullBody,
          parsedNotes: notes
        };
        appState.getMainWindow()?.webContents.send("update-available", info);
        return { success: true };
      }
      return { success: false, error: "No notes returned" };
    } catch (err) {
      console.error("[IPC] test-release-fetch failed:", err);
      return { success: false, error: err.message };
    }
  });
  safeHandle("license:activate", async (event, payload) => {
    const rejected = rejectUntrustedLicenseSender(event);
    if (rejected) return rejected;
    const result = typeof payload === "object" && payload?.trial ? await entitlementVerifier.startTrial() : await entitlementVerifier.activateLicense(typeof payload === "string" ? payload : payload?.licenseKey || "");
    broadcastLicenseState();
    return {
      ...result,
      entitlement: result.entitlement ? {
        plan: result.entitlement.plan,
        trial: result.entitlement.trial,
        issuedAt: result.entitlement.issuedAt,
        expiresAt: result.entitlement.expiresAt,
        graceUntil: result.entitlement.graceUntil,
        entitlementVersion: result.entitlement.entitlementVersion,
        features: result.entitlement.features
      } : void 0
    };
  });
  safeHandle("license:sync", async (event) => {
    const rejected = rejectUntrustedLicenseSender(event);
    if (rejected) return rejected;
    const status = await entitlementVerifier.sync("manual");
    broadcastLicenseState();
    return toPlanState(status);
  });
  safeHandle("license:deactivate", async (event) => {
    const rejected = rejectUntrustedLicenseSender(event);
    if (rejected) return rejected;
    await entitlementVerifier.deactivate();
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (orchestrator) {
        orchestrator.setKnowledgeMode(false);
        console.log("[IPC] Knowledge mode auto-disabled due to license deactivation");
      }
    } catch (e) {
    }
    clearActiveModeOnLicenseLoss();
    broadcastLicenseState();
    return { success: true };
  });
  safeHandle("license:get-entitlement", async (event) => {
    const rejected = rejectUntrustedLicenseSender(event);
    if (rejected) return rejected;
    return toPlanState();
  });
  safeHandle("app:get-startup-state", async () => {
    try {
      return appState.getStartupState();
    } catch {
      return {
        bootstrapComplete: false,
        license: { isPremium: false },
        knowledge: {
          engineReady: false,
          hasResume: false,
          hasJD: false,
          nodeCount: 0,
          aot: {
            negotiationScript: false,
            gapAnalysis: false,
            questions: false
          }
        }
      };
    }
  });
  safeHandle("app:force-resync", async () => {
    try {
      return await appState.forceResyncState();
    } catch {
      return appState.getStartupState();
    }
  });
  safeHandle("app:get-aot-state", async () => {
    try {
      return appState.getAOTState();
    } catch {
      return {
        engineReady: false,
        hasResume: false,
        hasJD: false,
        inputHash: null,
        negotiation: { exists: false, data: null, updatedAt: null, version: 0, hash: null },
        gapAnalysis: { exists: false, data: null, updatedAt: null, version: 0, hash: null },
        questions: { exists: false, data: null, updatedAt: null, version: 0, hash: null }
      };
    }
  });
  safeHandle("get-recognition-languages", async () => {
    return import_languages.RECOGNITION_LANGUAGES;
  });
  safeHandle("get-ai-response-languages", async () => {
    return import_languages.AI_RESPONSE_LANGUAGES;
  });
  safeHandle("set-ai-response-language", async (_, language) => {
    if (!language || typeof language !== "string" || !language.trim()) {
      console.warn("[IPC] set-ai-response-language: invalid or empty language received, ignoring.");
      return { success: false, error: "Invalid language value" };
    }
    const sanitizedLanguage = language.trim();
    const { CredentialsManager } = require("./services/CredentialsManager");
    CredentialsManager.getInstance().setAiResponseLanguage(sanitizedLanguage);
    const llmHelper = appState.processingHelper?.getLLMHelper?.();
    if (llmHelper) {
      llmHelper.setAiResponseLanguage(sanitizedLanguage);
      console.log(`[IPC] AI response language updated to: ${sanitizedLanguage}`);
    } else {
      console.warn("[IPC] set-ai-response-language: processingHelper or LLMHelper not ready, language saved to disk only.");
    }
    return { success: true };
  });
  safeHandle("get-stt-language", async () => {
    const { CredentialsManager } = require("./services/CredentialsManager");
    return CredentialsManager.getInstance().getSttLanguage();
  });
  safeHandle("get-ai-response-language", async () => {
    const { CredentialsManager } = require("./services/CredentialsManager");
    return CredentialsManager.getInstance().getAiResponseLanguage();
  });
  safeHandle(
    "update-content-dimensions",
    async (event, { width, height }) => {
      if (!width || !height) return;
      const senderWebContents = event.sender;
      const settingsWin = appState.settingsWindowHelper.getSettingsWindow();
      const overlayWin = appState.getWindowHelper().getOverlayWindow();
      const launcherWin = appState.getWindowHelper().getLauncherWindow();
      if (settingsWin && !settingsWin.isDestroyed() && settingsWin.webContents.id === senderWebContents.id) {
        appState.settingsWindowHelper.setWindowDimensions(settingsWin, width, height);
      } else if (overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents.id === senderWebContents.id) {
        appState.getWindowHelper().setOverlayDimensions(width, height);
      } else if (launcherWin && !launcherWin.isDestroyed() && launcherWin.webContents.id === senderWebContents.id) {
        console.log(`[IPC] update-content-dimensions: launcher window resize request ${width}x${height} (ignored \u2014 launcher has fixed dimensions)`);
      }
    }
  );
  safeHandle("set-window-mode", async (event, mode, inactive) => {
    appState.getWindowHelper().setWindowMode(mode, inactive);
    return { success: true };
  });
  safeHandle("set-overlay-v2-layout", async (_, enabled) => {
    appState.getWindowHelper().setOverlayUsesV2Layout(!!enabled);
    return { success: true };
  });
  safeHandle(import_providerAnalyticsSessionSnapshot.PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.set, async (_, snapshot) => {
    const validation = (0, import_providerAnalyticsSessionSnapshot.validateProviderAnalyticsSessionSnapshot)(snapshot);
    const quarantine = (0, import_providerAnalyticsSessionSnapshot.applyProviderAnalyticsSessionSnapshotQuarantine)({
      currentSnapshot: providerAnalyticsSessionSnapshot,
      incomingSnapshot: snapshot,
      validation
    });
    if (validation.status !== "valid") {
      console.warn("[ProviderAnalytics] session snapshot guardrail", {
        status: validation.status,
        quarantined: quarantine.setResult.quarantined,
        responseCount: validation.responseCount,
        ownershipEntryCount: validation.ownershipEntryCount,
        serializedBytes: validation.serializedBytes,
        issues: validation.issues
      });
    }
    providerAnalyticsSessionSnapshot = quarantine.currentSnapshot;
    if (quarantine.shouldBroadcast) {
      broadcastProviderAnalyticsSessionSnapshot(quarantine.broadcastSnapshot);
    }
    return quarantine.setResult;
  });
  safeHandle(import_providerAnalyticsSessionSnapshot.PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.get, async () => {
    return providerAnalyticsSessionSnapshot;
  });
  safeHandle(import_sessionExportDelivery.SESSION_EXPORT_DELIVERY_IPC.save, async (event, request) => {
    const validation = (0, import_sessionExportDelivery.validateSessionExportSaveRequest)(request);
    if (!validation.valid) {
      const diagnostic = (0, import_sessionExportDelivery.buildSessionExportIpcBoundaryDiagnostic)({
        channel: import_sessionExportDelivery.SESSION_EXPORT_DELIVERY_IPC.save,
        operation: "validate_request",
        code: "export_save_request_invalid",
        valid: false,
        error: validation.error,
        message: validation.error ?? "Invalid export save request."
      });
      console.warn("[SessionExport] save request rejected:", diagnostic.error);
      return { success: false, error: diagnostic.error ?? "Invalid export save request.", diagnostic };
    }
    const saveRequest = request;
    const extension = (0, import_sessionExportDelivery.getSessionExportFileExtension)(saveRequest.format);
    const fallbackName = (0, import_sessionExportDelivery.buildSessionExportDefaultFileName)(saveRequest.format, saveRequest.generatedAt);
    const requestedName = saveRequest.suggestedFileName?.trim() ? saveRequest.suggestedFileName.trim().split(/[\\/]/).pop() : void 0;
    const defaultPath = requestedName || fallbackName;
    const parentWindow = import_electron.BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: `Save ${saveRequest.format === "html" ? "HTML" : "Markdown"} Session Report`,
      defaultPath,
      filters: buildSessionExportSaveFilters(saveRequest.format),
      properties: ["createDirectory"]
    };
    try {
      const rawResult = parentWindow && !parentWindow.isDestroyed() ? await import_electron.dialog.showSaveDialog(parentWindow, options) : await import_electron.dialog.showSaveDialog(options);
      const result = typeof rawResult === "string" ? { canceled: rawResult.length === 0, filePath: rawResult } : rawResult;
      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }
      const selectedPath = path.extname(result.filePath) ? result.filePath : `${result.filePath}.${extension}`;
      await fs.promises.writeFile(selectedPath, saveRequest.content, "utf8");
      return {
        success: true,
        filePath: selectedPath
      };
    } catch (error) {
      const message = (0, import_sessionExportDelivery.sanitizeSessionExportDeliveryError)(error, "Unable to save report.");
      const diagnostic = (0, import_sessionExportDelivery.buildSessionExportIpcBoundaryDiagnostic)({
        channel: import_sessionExportDelivery.SESSION_EXPORT_DELIVERY_IPC.save,
        operation: "write_file",
        code: "export_save_failed",
        success: false,
        error: message,
        message
      });
      console.warn("[SessionExport] save failed:", message);
      return { success: false, error: message, diagnostic };
    }
  });
  safeHandle(import_sessionExportDelivery.SESSION_EXPORT_DELIVERY_IPC.savePdf, async (event, request) => {
    const validation = (0, import_sessionExportDelivery.validateSessionExportPdfSaveRequest)(request);
    if (!validation.valid) {
      const diagnostic = (0, import_sessionExportDelivery.buildSessionExportIpcBoundaryDiagnostic)({
        channel: import_sessionExportDelivery.SESSION_EXPORT_DELIVERY_IPC.savePdf,
        operation: "validate_request",
        code: "export_pdf_save_request_invalid",
        valid: false,
        error: validation.error,
        message: validation.error ?? "Invalid PDF export save request."
      });
      console.warn("[SessionExport] PDF save request rejected:", diagnostic.error);
      return { success: false, error: diagnostic.error ?? "Invalid PDF export save request.", diagnostic };
    }
    const pdfRequest = request;
    const extension = (0, import_sessionExportDelivery.getSessionExportFileExtension)("pdf");
    const fallbackName = (0, import_sessionExportDelivery.buildSessionExportDefaultFileName)("pdf", pdfRequest.generatedAt);
    const requestedName = pdfRequest.suggestedFileName?.trim() ? pdfRequest.suggestedFileName.trim().split(/[\\/]/).pop() : void 0;
    const defaultPath = requestedName || fallbackName;
    const parentWindow = import_electron.BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Save PDF Session Report",
      defaultPath,
      filters: buildSessionExportSaveFilters("pdf"),
      properties: ["createDirectory"]
    };
    const rawResult = parentWindow && !parentWindow.isDestroyed() ? await import_electron.dialog.showSaveDialog(parentWindow, options) : await import_electron.dialog.showSaveDialog(options);
    const result = typeof rawResult === "string" ? { canceled: rawResult.length === 0, filePath: rawResult } : rawResult;
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    try {
      const selectedPath = path.extname(result.filePath) ? result.filePath : `${result.filePath}.${extension}`;
      const pdfBuffer = await renderSessionExportPdfFromHtml(pdfRequest.html);
      const pdfValidation = (0, import_sessionExportDelivery.validateSessionExportPdfBuffer)(pdfBuffer);
      if (!pdfValidation.valid) {
        throw new Error(pdfValidation.error ?? "Generated PDF failed validation.");
      }
      if (pdfValidation.warning) {
        console.warn("[SessionExport] PDF output warning:", {
          warning: pdfValidation.warning,
          byteLength: pdfValidation.byteLength,
          budget: import_sessionExportDelivery.SESSION_EXPORT_PDF_RUNTIME_BUDGETS.warningPdfBytes
        });
      }
      await fs.promises.writeFile(selectedPath, pdfBuffer);
      return {
        success: true,
        filePath: selectedPath
      };
    } catch (error) {
      const message = (0, import_sessionExportDelivery.sanitizeSessionExportDeliveryError)(error, "Unable to save PDF report.");
      const diagnostic = (0, import_sessionExportDelivery.buildSessionExportIpcBoundaryDiagnostic)({
        channel: import_sessionExportDelivery.SESSION_EXPORT_DELIVERY_IPC.savePdf,
        operation: "save_pdf_report",
        code: "export_pdf_save_failed",
        success: false,
        error: message,
        message
      });
      console.warn("[SessionExport] PDF save failed:", message);
      return { success: false, error: message, diagnostic };
    }
  });
  safeHandle("delete-screenshot", async (event, filePath) => {
    const userDataDir = import_electron.app.getPath("userData");
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn("[IPC] delete-screenshot: path outside userData rejected:", filePath);
      return { success: false, error: "Path not allowed" };
    }
    return appState.deleteScreenshot(resolved);
  });
  safeHandle("take-screenshot", async (_event, options) => {
    try {
      if (options?.requireVision) {
        appState.assertVisionCaptureSupported();
      }
      const screenshotPath = await appState.takeScreenshot();
      const preview = await appState.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("take-selective-screenshot", async (_event, options) => {
    try {
      if (options?.requireVision) {
        appState.assertVisionCaptureSupported();
      }
      const screenshotPath = await appState.takeSelectiveScreenshot();
      const preview = await appState.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      if (error.message === "Selection cancelled") {
        return { cancelled: true };
      }
      throw error;
    }
  });
  safeHandle("get-screenshots", async () => {
    try {
      let previews = [];
      if (appState.getView() === "queue") {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path2) => ({
            path: path2,
            preview: await appState.getImagePreview(path2)
          }))
        );
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path2) => ({
            path: path2,
            preview: await appState.getImagePreview(path2)
          }))
        );
      }
      return previews;
    } catch (error) {
      throw error;
    }
  });
  safeHandle("toggle-window", async () => {
    appState.toggleMainWindow();
  });
  safeHandle("show-window", async (event, inactive) => {
    appState.showMainWindow(inactive);
  });
  safeHandle("hide-window", async () => {
    appState.hideMainWindow();
  });
  safeHandle("show-overlay", async () => {
    appState.getWindowHelper().showOverlay();
  });
  safeHandle("hide-overlay", async () => {
    appState.getWindowHelper().hideOverlay();
  });
  safeHandle("get-meeting-active", async () => {
    return appState.getIsMeetingActive();
  });
  safeHandle("reset-queues", async () => {
    try {
      appState.clearQueues();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("get-donation-status", async () => {
    const { DonationManager } = require("./DonationManager");
    const manager = DonationManager.getInstance();
    return {
      shouldShow: manager.shouldShowToaster(),
      hasDonated: manager.getDonationState().hasDonated,
      lifetimeShows: manager.getDonationState().lifetimeShows
    };
  });
  safeHandle("mark-donation-toast-shown", async () => {
    const { DonationManager } = require("./DonationManager");
    DonationManager.getInstance().markAsShown();
    return { success: true };
  });
  safeHandle("set-donation-complete", async () => {
    const { DonationManager } = require("./DonationManager");
    DonationManager.getInstance().setHasDonated(true);
    return { success: true };
  });
  safeHandle("generate-suggestion", async (event, context, lastQuestion) => {
    try {
      const suggestion = await appState.getIntelligenceManager().handleAction("what_to_answer", {
        message: lastQuestion,
        additionalContext: context
      });
      return { suggestion };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("finalize-mic-stt", async () => {
    await appState.finalizeMicSTT();
  });
  safeHandle("analyze-image-file", async (event, filePath) => {
    const userDataDir = import_electron.app.getPath("userData");
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn("[IPC] analyze-image-file: path outside userData rejected:", filePath);
      throw new Error("Path not allowed");
    }
    try {
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFiles([resolved]);
      return result;
    } catch (error) {
      throw error;
    }
  });
  safeHandle("gemini-chat", async (event, message, imagePaths, context, options) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().chatWithGemini(message, imagePaths, context, options?.skipSystemPrompt);
      console.log(`[IPC] gemini-chat responseLength=${result?.length ?? 0} redacted=true`);
      if (!result || result.trim().length === 0) {
        console.warn("[IPC] Empty response from LLM, not updating IntelligenceManager");
        return "I apologize, but I couldn't generate a response. Please try again.";
      }
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.addTranscript({
        text: message,
        speaker: "user",
        timestamp: Date.now(),
        final: true,
        _sessionId: intelligenceManager.getSessionId()
      }, true);
      console.log(`[IPC] Updating IntelligenceManager with assistant message...`);
      intelligenceManager.addAssistantMessage(result);
      console.log(`[IPC] Updated IntelligenceManager.Last message length=${intelligenceManager.getLastAssistantMessage()?.length ?? 0} redacted=true`);
      intelligenceManager.logUsage("chat", message, result);
      return result;
    } catch (error) {
      throw error;
    }
  });
  const activeChatStreams = /* @__PURE__ */ new Map();
  const cancelActiveChatStream = async (senderId) => {
    const targets = senderId !== void 0 ? [[senderId, activeChatStreams.get(senderId)]] : Array.from(activeChatStreams.entries());
    for (const [targetSenderId, active] of targets) {
      if (!active) continue;
      activeChatStreams.set(targetSenderId, {
        streamId: active.streamId + 1,
        requestId: active.requestId,
        stream: null
      });
      if (active.requestId) {
        appState.getIntelligenceManager().getEngine()?.cancelRequest(active.requestId);
      }
      if (!active.stream?.return) continue;
      try {
        await active.stream.return(void 0);
      } catch (error) {
        console.warn("[IPC] Failed to cancel active gemini-chat-stream cleanly:", error);
      }
    }
  };
  safeHandle("cancel-gemini-chat-stream", async (event) => {
    await cancelActiveChatStream(event.sender.id);
    return { success: true };
  });
  safeHandle("cancel-intelligence-request", async () => {
    appState.getIntelligenceManager().resetEngine();
    return { success: true };
  });
  safeHandle("cancel-intelligence-by-request", async (_, requestId) => {
    if (!requestId) return { success: false, error: "Missing requestId" };
    appState.getIntelligenceManager().getEngine()?.cancelRequest(requestId);
    return { success: true };
  });
  safeHandle("gemini-chat-stream", async (event, message, imagePaths, context, options) => {
    try {
      console.log("[IPC] gemini-chat-stream started using IntelligenceManager.handleAction");
      const senderId = event.sender.id;
      await cancelActiveChatStream(senderId);
      const currentStreamState = activeChatStreams.get(senderId);
      const myStreamId = (currentStreamState?.streamId ?? 0) + 1;
      const requestId = options?.requestId;
      activeChatStreams.set(senderId, { streamId: myStreamId, requestId, stream: null });
      const intelligenceManager = appState.getIntelligenceManager();
      let additionalContext = context;
      let ragContext = null;
      if (!additionalContext) {
        try {
          const autoContext = intelligenceManager.getFormattedContext(60);
          if (autoContext && autoContext.trim().length > 200) {
            if (autoContext.length <= 1500) {
              additionalContext = autoContext;
              console.log(`[IPC] Auto-injected context for gemini-chat-stream (${additionalContext.length} chars)`);
            } else {
              console.log(`[IPC] Auto-context too large (${autoContext.length} chars), dropped (block-based)`);
            }
          }
        } catch (ctxErr) {
          console.warn("[IPC] Failed to auto-inject context:", ctxErr);
        }
      }
      if (additionalContext && additionalContext.length > 2e3) {
        console.warn(`[IPC] Context too large (${additionalContext.length} chars), dropped entirely`);
        additionalContext = void 0;
      }
      try {
        const ragManager = appState.getRAGManager();
        if (!imagePaths?.length && ragManager?.isReady() && ragManager.isLiveIndexingActive("live-meeting-current")) {
          try {
            const liveContext = await ragManager.retrieveMeetingContext("live-meeting-current", message);
            ragContext = {
              content: liveContext.formattedContext,
              scope: "live",
              title: "RAG MEMORY (LIVE)"
            };
          } catch (ragError) {
            const ragMessage = ragError?.message || "";
            if (!ragMessage.includes("NO_RELEVANT_CONTEXT") && !ragMessage.includes("NO_MEETING_EMBEDDINGS")) {
              console.warn("[IPC] Live RAG prefetch failed for gemini-chat-stream:", ragError);
            }
          }
        }
        const onToken = (payload) => {
          if (payload?.requestId !== requestId || payload?.intent !== "manual_chat") return;
          const liveState = activeChatStreams.get(senderId);
          if (!liveState || liveState.streamId !== myStreamId) {
            return;
          }
          event.sender.send("gemini-stream-token", { token: payload.token, requestId });
        };
        const onResult = (payload) => {
          if (payload?.requestId !== requestId || payload?.intent !== "manual_chat") return;
          if (activeChatStreams.get(senderId)?.streamId === myStreamId) {
            event.sender.send("gemini-stream-done", {
              requestId,
              content: payload.content,
              debugMetadata: payload.debugMetadata
            });
          }
        };
        const onError = (error, mode, failedRequestId) => {
          if (failedRequestId !== requestId) return;
          if (activeChatStreams.get(senderId)?.streamId === myStreamId) {
            event.sender.send("gemini-stream-error", { error: error?.message || "Unknown streaming error", requestId });
          }
        };
        intelligenceManager.on("action_token", onToken);
        intelligenceManager.on("action_result", onResult);
        intelligenceManager.on("error", onError);
        try {
          await intelligenceManager.handleAction("manual_chat", {
            message,
            imagePaths,
            requestId,
            additionalContext,
            rag: ragContext,
            profilePreference: options?.ignoreKnowledgeMode ? "force_off" : "default"
          });
        } finally {
          intelligenceManager.off("action_token", onToken);
          intelligenceManager.off("action_result", onResult);
          intelligenceManager.off("error", onError);
        }
      } finally {
        if (activeChatStreams.get(senderId)?.streamId === myStreamId) {
          activeChatStreams.set(senderId, { streamId: myStreamId, requestId, stream: null });
        }
      }
      return null;
    } catch (error) {
      console.error("[IPC] Error in gemini-chat-stream setup:", error);
      throw error;
    }
  });
  safeHandle("quit-app", () => {
    import_electron.app.quit();
  });
  safeHandle("quit-and-install-update", async () => {
    try {
      console.log("[IPC] Quit and install update requested");
      await appState.quitAndInstallUpdate();
      return { success: true };
    } catch (err) {
      console.error("[IPC] quit-and-install-update failed:", err);
      return { success: false, error: err.message };
    }
  });
  safeHandle("delete-meeting", async (_, id) => {
    return import_DatabaseManager.DatabaseManager.getInstance().deleteMeeting(id);
  });
  safeHandle("check-for-updates", async () => {
    try {
      console.log("[IPC] Manual update check requested");
      await appState.checkForUpdates();
      return { success: true };
    } catch (err) {
      console.error("[IPC] check-for-updates failed:", err);
      return { success: false, error: err.message };
    }
  });
  safeHandle("download-update", async () => {
    try {
      console.log("[IPC] Download update requested");
      appState.downloadUpdate();
      return { success: true };
    } catch (err) {
      console.error("[IPC] download-update failed:", err);
      return { success: false, error: err.message };
    }
  });
  safeHandle("move-window-left", async () => {
    appState.moveWindowLeft();
  });
  safeHandle("move-window-right", async () => {
    appState.moveWindowRight();
  });
  safeHandle("move-window-up", async () => {
    appState.moveWindowUp();
  });
  safeHandle("move-window-down", async () => {
    appState.moveWindowDown();
  });
  safeHandle("center-and-show-window", async () => {
    appState.centerAndShowWindow();
  });
  safeHandle("window-minimize", async () => {
    appState.getWindowHelper().minimizeWindow();
  });
  safeHandle("window-maximize", async () => {
    appState.getWindowHelper().maximizeWindow();
  });
  safeHandle("window-close", async () => {
    appState.getWindowHelper().closeWindow();
  });
  safeHandle("window-is-maximized", async () => {
    return appState.getWindowHelper().isMainWindowMaximized();
  });
  safeHandle("toggle-settings-window", (event, { x, y } = {}) => {
    appState.settingsWindowHelper.toggleWindow(x, y);
  });
  safeHandle("settings:open-tab", (_, tab) => {
    const launcherWin = appState.getWindowHelper().getLauncherWindow();
    if (launcherWin && !launcherWin.isDestroyed()) {
      launcherWin.webContents.send("settings:open-tab", tab);
      launcherWin.show();
      launcherWin.focus();
    }
  });
  safeHandle("close-settings-window", () => {
    appState.settingsWindowHelper.closeWindow();
  });
  safeHandle("set-undetectable", async (_, state) => {
    appState.setUndetectable(state);
    return { success: true };
  });
  safeHandle("set-disguise", async (_, mode) => {
    appState.setDisguise(mode);
    return { success: true };
  });
  safeHandle("get-undetectable", async () => {
    return appState.getUndetectable();
  });
  safeHandle("set-overlay-mouse-passthrough", async (_, enabled) => {
    appState.setOverlayMousePassthrough(enabled);
    return { success: true };
  });
  safeHandle("toggle-overlay-mouse-passthrough", async () => {
    const enabled = appState.toggleOverlayMousePassthrough();
    return { success: true, enabled };
  });
  safeHandle("get-overlay-mouse-passthrough", async () => {
    return appState.getOverlayMousePassthrough();
  });
  safeHandle("get-disguise", async () => {
    return appState.getDisguise();
  });
  const { StealthManager } = require("./services/StealthManager");
  safeHandle("stealth:engage", async () => {
    try {
      StealthManager.getInstance().engage();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  safeHandle("stealth:disengage", async () => {
    try {
      StealthManager.getInstance().disengage();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  safeHandle("stealth:get-state", async () => {
    try {
      return StealthManager.getInstance().getState();
    } catch (e) {
      return { level: "off", processDisguised: false, windowsProtected: false, dockHidden: false, eventsBlocked: false, watchdogActive: false };
    }
  });
  safeHandle("stealth:get-config", async () => {
    try {
      return StealthManager.getInstance().getConfig();
    } catch (e) {
      return null;
    }
  });
  safeHandle("stealth:update-config", async (_, patch) => {
    try {
      StealthManager.getInstance().updateConfig(patch);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  safeHandle("stealth:is-engaged", async () => {
    try {
      return StealthManager.getInstance().isEngaged();
    } catch {
      return false;
    }
  });
  safeHandle("set-open-at-login", async (_, openAtLogin) => {
    import_electron.app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: false,
      path: import_electron.app.getPath("exe")
      // Explicitly point to executable for production reliability
    });
    return { success: true };
  });
  safeHandle("get-open-at-login", async () => {
    const settings = import_electron.app.getLoginItemSettings();
    return settings.openAtLogin;
  });
  safeHandle("get-verbose-logging", async () => {
    return appState.getVerboseLogging();
  });
  safeHandle("set-verbose-logging", async (_, enabled) => {
    appState.setVerboseLogging(enabled);
    return { success: true };
  });
  safeHandle("get-log-file-path", async () => {
    try {
      return path.join(import_electron.app.getPath("documents"), "teamsync_debug.log");
    } catch {
      return null;
    }
  });
  safeHandle("open-log-file", async () => {
    try {
      const logPath = path.join(import_electron.app.getPath("documents"), "teamsync_debug.log");
      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, "");
      }
      await import_electron.shell.openPath(logPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  import_electron.ipcMain.on("forward-log-to-file", (_event, level, msg) => {
    if (!appState.getVerboseLogging()) return;
    const tag = level === "error" ? "[RENDERER-ERROR]" : level === "warn" ? "[RENDERER-WARN]" : "[RENDERER]";
    console.log(`${tag} ${msg}`);
  });
  safeHandle("get-arch", async () => {
    return process.arch;
  });
  safeHandle("get-os-version", async () => {
    const platform = process.platform;
    if (platform === "darwin") {
      const darwinMajor = parseInt(os.release().split(".")[0] || "0", 10);
      const macosMajor = darwinMajor >= 25 ? darwinMajor + 1 : darwinMajor >= 20 ? darwinMajor - 9 : null;
      return macosMajor ? `macOS ${macosMajor}` : `macOS ${os.release()}`;
    }
    if (platform === "win32") {
      const release = os.release();
      const majorBuild = parseInt(release.split(".")[2] || "0", 10);
      return majorBuild >= 22e3 ? `Windows 11` : `Windows 10`;
    }
    return os.type();
  });
  safeHandle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
        isOllama: llmHelper.isUsingOllama()
      };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("get-available-ollama-models", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const models = await llmHelper.getOllamaModels();
      return models;
    } catch (error) {
      throw error;
    }
  });
  safeHandle("switch-to-ollama", async (_, model, url) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToOllama(model, url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("force-restart-ollama", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const success = await llmHelper.forceRestartOllama();
      return { success };
    } catch (error) {
      console.error("Error force restarting Ollama:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("restart-ollama", async () => {
    try {
      await appState.processingHelper.getLLMHelper().forceRestartOllama();
      return true;
    } catch (error) {
      console.error("[IPC restart-ollama] Failed to restart:", error);
      return false;
    }
  });
  safeHandle("ensure-ollama-running", async () => {
    try {
      const { OllamaManager } = require("./services/OllamaManager");
      await OllamaManager.getInstance().init();
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });
  safeHandle("switch-to-gemini", async (_, apiKey, modelId) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToGemini(apiKey, modelId);
      if (apiKey) {
        const { CredentialsManager } = require("./services/CredentialsManager");
        CredentialsManager.getInstance().setGeminiApiKey(apiKey);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-gemini-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setGeminiApiKey(apiKey);
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setApiKey(apiKey);
      appState.getIntelligenceManager().resetEngine();
      appState.getIntelligenceManager().initializeLLMs();
      return { success: true };
    } catch (error) {
      console.error("Error saving Gemini API key:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-groq-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setGroqApiKey(apiKey);
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqApiKey(apiKey);
      appState.getIntelligenceManager().resetEngine();
      appState.getIntelligenceManager().initializeLLMs();
      return { success: true };
    } catch (error) {
      console.error("Error saving Groq API key:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("groq-vault:get-keys", async () => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const cm = CredentialsManager.getInstance();
      const vault = cm.getGroqKeyVault();
      const llmHelper = appState.processingHelper.getLLMHelper();
      const keyManager = llmHelper.getGroqKeyManager();
      const runtimeStates = keyManager.getKeyStates();
      const keys = vault.map((entry) => {
        const runtime = runtimeStates.find((s) => s.apiKey === entry.key);
        return {
          id: entry.id,
          maskedKey: keyManager.maskKey(entry.key),
          enabled: entry.enabled,
          addedAt: entry.addedAt,
          label: entry.label,
          // Runtime health (defaults for keys not yet loaded into pool)
          exhausted: runtime?.exhausted ?? false,
          cooldownUntil: runtime?.cooldownUntil ?? null,
          requestCount: runtime?.requestCount ?? 0,
          lastUsed: runtime?.lastUsed ?? 0,
          invalid: runtime?.invalid ?? false,
          isAvailable: runtime?.isAvailable ?? entry.enabled
        };
      });
      return { success: true, keys };
    } catch (error) {
      console.error("[IPC] groq-vault:get-keys error:", error);
      return { success: false, error: error.message, keys: [] };
    }
  });
  safeHandle("groq-vault:add-key", async (_, apiKey, label) => {
    try {
      const trimmed = (apiKey || "").trim();
      if (!trimmed) return { success: false, error: "API key is required" };
      let validationStatus = "healthy";
      let validationError;
      try {
        const Groq = require("groq-sdk").default || require("groq-sdk");
        const testClient = new Groq({ apiKey: trimmed });
        await testClient.models.list();
      } catch (e) {
        const status = e?.status ?? e?.statusCode ?? 0;
        if (status === 401 || status === 403) {
          validationStatus = "invalid";
          validationError = "Invalid API key \u2014 authentication failed";
        } else if (status === 429) {
          validationStatus = "healthy";
        } else {
          validationStatus = "healthy";
          validationError = `Key accepted (could not verify: ${e.message?.slice(0, 60)})`;
        }
      }
      if (validationStatus === "invalid") {
        return { success: false, error: validationError, validationStatus };
      }
      const { CredentialsManager } = require("./services/CredentialsManager");
      const entry = CredentialsManager.getInstance().addGroqVaultKey(trimmed, label);
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.reloadGroqVault();
      const keyManager = llmHelper.getGroqKeyManager();
      return {
        success: true,
        key: {
          id: entry.id,
          maskedKey: keyManager.maskKey(entry.key),
          enabled: entry.enabled,
          addedAt: entry.addedAt,
          label: entry.label
        },
        validationStatus,
        validationError
      };
    } catch (error) {
      console.error("[IPC] groq-vault:add-key error:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("groq-vault:remove-key", async (_, id) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().removeGroqVaultKey(id);
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.reloadGroqVault();
      return { success: true };
    } catch (error) {
      console.error("[IPC] groq-vault:remove-key error:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("groq-vault:toggle-key", async (_, id, enabled) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().toggleGroqVaultKey(id, enabled);
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.reloadGroqVault();
      return { success: true };
    } catch (error) {
      console.error("[IPC] groq-vault:toggle-key error:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("groq-vault:get-health", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const keyManager = llmHelper.getGroqKeyManager();
      const report = keyManager.getHealthReport();
      return { success: true, ...report };
    } catch (error) {
      console.error("[IPC] groq-vault:get-health error:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-openai-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setOpenaiApiKey(apiKey);
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setOpenaiApiKey(apiKey);
      appState.getIntelligenceManager().resetEngine();
      appState.getIntelligenceManager().initializeLLMs();
      return { success: true };
    } catch (error) {
      console.error("Error saving OpenAI API key:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-claude-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setClaudeApiKey(apiKey);
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setClaudeApiKey(apiKey);
      appState.getIntelligenceManager().resetEngine();
      appState.getIntelligenceManager().initializeLLMs();
      return { success: true };
    } catch (error) {
      console.error("Error saving Claude API key:", error);
      return { success: false, error: error.message };
    }
  });
  const _usageCache = /* @__PURE__ */ new Map();
  const USAGE_CACHE_TTL_MS = 6e4;
  safeHandle("set-teamsync-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const cm = CredentialsManager.getInstance();
      const prevSttProvider = cm.getSttProvider();
      cm.setTeamSyncApiKey(apiKey);
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setTeamSyncKey(apiKey || null);
      const defaultModel = cm.getDefaultModel();
      const providers = [...cm.getCurlProviders() || [], ...cm.getCustomProviders() || []];
      llmHelper.setModel(defaultModel, providers);
      import_electron.BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send("model-changed", defaultModel);
      });
      const newSttProvider = cm.getSttProvider();
      if (newSttProvider !== prevSttProvider) {
        console.log(`[IPC] set-teamsync-api-key: STT provider changed ${prevSttProvider} \u2192 ${newSttProvider}, reconfiguring pipeline`);
        await appState.reconfigureSttProvider();
      }
      if (apiKey) {
        console.log("[IPC] set-teamsync-api-key: key saved; no local premium entitlement granted.");
      }
      return { success: true };
    } catch (error) {
      console.error("Error saving TeamSync API key:", error);
      return { success: false, error: error.message };
    } finally {
      _usageCache?.clear();
    }
  });
  safeHandle("get-teamsync-usage", async () => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const key = CredentialsManager.getInstance().getTeamSyncApiKey();
      if (!key) return { ok: false, error: "no_key" };
      const cached = _usageCache.get(key);
      if (cached && Date.now() - cached.ts < USAGE_CACHE_TTL_MS) {
        return cached.data;
      }
      const res = await fetch("https://api.teamsync-ai.vercel.app/v1/usage", {
        headers: { "x-teamsync-key": key },
        signal: AbortSignal.timeout(8e3)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error || "request_failed", status: res.status };
      }
      const data = await res.json();
      const result = { ok: true, ...data };
      _usageCache.set(key, { data: result, ts: Date.now() });
      return result;
    } catch (error) {
      return { ok: false, error: error.message || "network_error" };
    }
  });
  safeHandle("invalidate-teamsync-usage-cache", () => {
    _usageCache.clear();
    return { ok: true };
  });
  safeHandle("profile:wipe-trial-data", async (event) => {
    const rejected = rejectUntrustedLicenseSender(event);
    if (rejected) return rejected;
    try {
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          const { DocType } = require("../premium/electron/knowledge/types");
          orchestrator.deleteDocumentsByType(DocType.RESUME);
          orchestrator.deleteDocumentsByType(DocType.JD);
        }
      } catch {
      }
      try {
        const sqliteDb = import_DatabaseManager.DatabaseManager.getInstance().getDb();
        if (sqliteDb) {
          sqliteDb.exec(`
            DELETE FROM company_dossiers;
            DELETE FROM knowledge_documents;
            DELETE FROM resume_nodes;
            DELETE FROM user_profile;
          `);
        }
      } catch (dbErr) {
        console.warn("[IPC] profile:wipe-trial-data: SQLite wipe partial error:", dbErr.message);
      }
      return { success: true };
    } catch (error) {
      console.error("[IPC] profile:wipe-trial-data error:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("get-custom-providers", async () => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const cm = CredentialsManager.getInstance();
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      return [...curlProviders, ...legacyProviders];
    } catch (error) {
      console.error("Error getting custom providers:", error);
      return [];
    }
  });
  safeHandle("save-custom-provider", async (_, provider) => {
    try {
      if (typeof provider !== "object" || provider === null || typeof provider.id !== "string" || typeof provider.name !== "string" || typeof provider.curlCommand !== "string") {
        console.error("[IPC] save-custom-provider: invalid payload shape", typeof provider);
        return { success: false, error: "Invalid provider payload" };
      }
      const curlCmd = provider.curlCommand;
      if (!curlCmd.includes("{{TEXT}}")) {
        return { success: false, error: "curlCommand must contain {{TEXT}} placeholder for the prompt" };
      }
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().saveCurlProvider(provider);
      return { success: true };
    } catch (error) {
      console.error("Error saving custom provider:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("delete-custom-provider", async (_, id) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().deleteCurlProvider(id);
      CredentialsManager.getInstance().deleteCustomProvider(id);
      return { success: true };
    } catch (error) {
      console.error("Error deleting custom provider:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("switch-to-custom-provider", async (_, providerId) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const cm = CredentialsManager.getInstance();
      const provider = [
        ...cm.getCurlProviders() || [],
        ...cm.getCustomProviders() || []
      ].find((p) => p.id === providerId);
      if (!provider) {
        throw new Error("Provider not found");
      }
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToCustom(provider);
      appState.getIntelligenceManager().initializeLLMs();
      return { success: true };
    } catch (error) {
      console.error("Error switching to custom provider:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("get-curl-providers", async () => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      return CredentialsManager.getInstance().getCurlProviders();
    } catch (error) {
      console.error("Error getting curl providers:", error);
      return [];
    }
  });
  safeHandle("save-curl-provider", async (_, provider) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().saveCurlProvider(provider);
      return { success: true };
    } catch (error) {
      console.error("Error saving curl provider:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("delete-curl-provider", async (_, id) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().deleteCurlProvider(id);
      return { success: true };
    } catch (error) {
      console.error("Error deleting curl provider:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("switch-to-curl-provider", async (_, providerId) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const provider = CredentialsManager.getInstance().getCurlProviders().find((p) => p.id === providerId);
      if (!provider) {
        throw new Error("Provider not found");
      }
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToCurl(provider);
      appState.getIntelligenceManager().initializeLLMs();
      return { success: true };
    } catch (error) {
      console.error("Error switching to curl provider:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("get-stored-credentials", async () => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const creds = CredentialsManager.getInstance().getAllCredentials();
      const hasKey = (key) => !!(key && key.trim().length > 0);
      const cm = CredentialsManager.getInstance();
      const hasGroqVaultKey = (cm.getGroqKeyVault?.() || []).some((k) => k.enabled);
      const bedrockCredentials = cm.getBedrockCredentials();
      const safeBedrockCredentials = bedrockCredentials ? {
        authMode: bedrockCredentials.authMode,
        region: bedrockCredentials.region,
        profileName: bedrockCredentials.profileName,
        preferredModel: bedrockCredentials.preferredModel,
        hasAccessKeyId: hasKey(bedrockCredentials.accessKeyId),
        hasSecretAccessKey: hasKey(bedrockCredentials.secretAccessKey),
        hasSessionToken: hasKey(bedrockCredentials.sessionToken)
      } : void 0;
      return {
        hasGeminiKey: hasKey(creds.geminiApiKey),
        hasGroqKey: hasKey(creds.groqApiKey) || hasGroqVaultKey,
        hasOpenaiKey: hasKey(creds.openaiApiKey),
        hasClaudeKey: hasKey(creds.claudeApiKey),
        hasTeamSyncKey: hasKey(creds.teamsyncApiKey),
        googleServiceAccountPath: creds.googleServiceAccountPath || null,
        sttProvider: CredentialsManager.getInstance().getSttProvider(),
        groqSttModel: creds.groqSttModel || "whisper-large-v3-turbo",
        hasSttGroqKey: hasKey(creds.groqSttApiKey),
        hasSttOpenaiKey: hasKey(creds.openAiSttApiKey),
        hasDeepgramKey: hasKey(creds.deepgramApiKey),
        hasElevenLabsKey: hasKey(creds.elevenLabsApiKey),
        hasAzureKey: hasKey(creds.azureApiKey),
        azureRegion: creds.azureRegion || "eastus",
        hasIbmWatsonKey: hasKey(creds.ibmWatsonApiKey),
        ibmWatsonRegion: creds.ibmWatsonRegion || "us-south",
        hasSonioxKey: hasKey(creds.sonioxApiKey),
        // STT key values — returned so the settings UI can pre-populate input fields.
        // AI model keys (Gemini/Groq/OpenAI/Claude) remain boolean-only; STT keys are
        // surfaced here because users need to see which key is active when switching providers.
        sttGroqKey: creds.groqSttApiKey || "",
        sttOpenaiKey: creds.openAiSttApiKey || "",
        sttDeepgramKey: creds.deepgramApiKey || "",
        sttElevenLabsKey: creds.elevenLabsApiKey || "",
        sttAzureKey: creds.azureApiKey || "",
        sttIbmKey: creds.ibmWatsonApiKey || "",
        sttSonioxKey: creds.sonioxApiKey || "",
        hasTavilyKey: hasKey(creds.tavilyApiKey),
        // Dynamic Model Discovery - preferred models
        geminiPreferredModel: creds.geminiPreferredModel || void 0,
        groqPreferredModel: creds.groqPreferredModel || void 0,
        openaiPreferredModel: creds.openaiPreferredModel || void 0,
        claudePreferredModel: creds.claudePreferredModel || void 0,
        bedrockPreferredModel: creds.bedrockPreferredModel || creds.bedrockCredentials?.preferredModel || void 0,
        groqFetchedModels: cm.getGroqFetchedModels(),
        bedrockCredentials: safeBedrockCredentials,
        bedrockFetchedModels: cm.getBedrockFetchedModels(),
        hasBedrockCredentials: cm.hasBedrockCredentials()
      };
    } catch (error) {
      return { hasGeminiKey: false, hasGroqKey: false, hasOpenaiKey: false, hasClaudeKey: false, hasTeamSyncKey: false, hasBedrockCredentials: false, googleServiceAccountPath: null, sttProvider: "deepgram", groqSttModel: "whisper-large-v3-turbo", hasSttGroqKey: false, hasSttOpenaiKey: false, hasDeepgramKey: false, hasElevenLabsKey: false, hasAzureKey: false, azureRegion: "eastus", hasIbmWatsonKey: false, ibmWatsonRegion: "us-south", hasSonioxKey: false, hasTavilyKey: false, sttGroqKey: "", sttOpenaiKey: "", sttDeepgramKey: "", sttElevenLabsKey: "", sttAzureKey: "", sttIbmKey: "", sttSonioxKey: "" };
    }
  });
  safeHandle("fetch-provider-models", async (_, provider, apiKey) => {
    try {
      if (provider === "bedrock") {
        const { CredentialsManager } = require("./services/CredentialsManager");
        const models2 = await CredentialsManager.getInstance().fetchBedrockModels();
        return { success: true, models: models2 };
      }
      let key = apiKey?.trim();
      if (!key) {
        const { CredentialsManager } = require("./services/CredentialsManager");
        const cm = CredentialsManager.getInstance();
        if (provider === "gemini") key = cm.getGeminiApiKey();
        else if (provider === "groq") {
          key = cm.getGroqApiKey();
          if (!key) {
            const vault = cm.getGroqKeyVault?.() || [];
            const firstEnabled = vault.find((k) => k.enabled);
            if (firstEnabled) key = firstEnabled.key;
          }
        } else if (provider === "openai") key = cm.getOpenaiApiKey();
        else if (provider === "claude") key = cm.getClaudeApiKey();
      }
      if (!key) {
        return { success: false, error: "No API key available. Please save a key first." };
      }
      const { fetchProviderModels } = require("./utils/modelFetcher");
      const models = await fetchProviderModels(provider, key);
      if (provider === "groq") {
        const { CredentialsManager: CM } = require("./services/CredentialsManager");
        CM.getInstance().setGroqFetchedModels(models);
      }
      return { success: true, models };
    } catch (error) {
      console.error(`[IPC] Failed to fetch ${provider} models:`, error);
      const msg = error?.response?.data?.error?.message || error.message || "Failed to fetch models";
      return { success: false, error: msg };
    }
  });
  safeHandle("set-provider-preferred-model", async (_, provider, modelId) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setPreferredModel(provider, modelId);
    } catch (error) {
      console.error(`[IPC] Failed to set preferred model for ${provider}:`, error);
    }
  });
  safeHandle("clear-groq-fetched-models", async () => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().clearGroqFetchedModels();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-bedrock-credentials", async (_, credentials) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const cm = CredentialsManager.getInstance();
      const stored = cm.getBedrockCredentials();
      const nextCredentials = {
        ...stored,
        ...credentials,
        authMode: credentials?.authMode || "aws_cli",
        region: credentials?.region || stored?.region || "us-east-1"
      };
      if (!credentials?.accessKeyId?.trim()) nextCredentials.accessKeyId = stored?.accessKeyId;
      if (!credentials?.secretAccessKey?.trim()) nextCredentials.secretAccessKey = stored?.secretAccessKey;
      if (credentials?.sessionToken === "") nextCredentials.sessionToken = stored?.sessionToken;
      await cm.testBedrockConnection(nextCredentials);
      const models = await cm.fetchBedrockModels(nextCredentials);
      if (!nextCredentials.preferredModel && models.length > 0) {
        nextCredentials.preferredModel = models[0].id;
      }
      cm.setBedrockCredentials(nextCredentials);
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      llmHelper?.setBedrockCredentials?.(cm.getBedrockCredentials());
      const saved = cm.getBedrockCredentials();
      return {
        success: true,
        models,
        credentials: saved ? {
          authMode: saved.authMode,
          region: saved.region,
          profileName: saved.profileName,
          preferredModel: saved.preferredModel
        } : void 0
      };
    } catch (error) {
      const { BedrockClient } = require("./services/BedrockClient");
      const msg = sanitizeErrorMessage(BedrockClient.normalizeError(error));
      console.error("[IPC] Bedrock credential save failed:", msg);
      return { success: false, error: msg };
    }
  });
  safeHandle("test-bedrock-connection", async (_, credentials) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const cm = CredentialsManager.getInstance();
      const stored = cm.getBedrockCredentials();
      const nextCredentials = {
        ...stored,
        ...credentials,
        authMode: credentials?.authMode || "aws_cli",
        region: credentials?.region || stored?.region || "us-east-1"
      };
      if (!credentials?.accessKeyId?.trim()) nextCredentials.accessKeyId = stored?.accessKeyId;
      if (!credentials?.secretAccessKey?.trim()) nextCredentials.secretAccessKey = stored?.secretAccessKey;
      if (credentials?.sessionToken === "") nextCredentials.sessionToken = stored?.sessionToken;
      await cm.testBedrockConnection(nextCredentials);
      const models = await cm.fetchBedrockModels(nextCredentials);
      if (!nextCredentials.preferredModel && models.length > 0) {
        nextCredentials.preferredModel = models[0].id;
      }
      cm.setBedrockCredentials(nextCredentials);
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      llmHelper?.setBedrockCredentials?.(cm.getBedrockCredentials());
      const saved = cm.getBedrockCredentials();
      return {
        success: true,
        models,
        credentials: saved ? {
          authMode: saved.authMode,
          region: saved.region,
          profileName: saved.profileName,
          preferredModel: saved.preferredModel
        } : void 0
      };
    } catch (error) {
      const { BedrockClient } = require("./services/BedrockClient");
      const msg = sanitizeErrorMessage(BedrockClient.normalizeError(error));
      console.error("[IPC] Bedrock connection test failed:", msg);
      return { success: false, error: msg };
    }
  });
  safeHandle("fetch-bedrock-models", async (_, credentials) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const cm = CredentialsManager.getInstance();
      const models = await cm.fetchBedrockModels(credentials || void 0);
      return { success: true, models };
    } catch (error) {
      const { BedrockClient } = require("./services/BedrockClient");
      const msg = sanitizeErrorMessage(BedrockClient.normalizeError(error));
      console.error("[IPC] Bedrock model fetch failed:", msg);
      return { success: false, error: msg };
    }
  });
  const broadcastCredentialsChanged = () => {
    import_electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send("credentials-changed");
    });
  };
  const autoSelectSttProviderForSavedKey = (provider, apiKey) => {
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey) {
      return;
    }
    const { CredentialsManager } = require("./services/CredentialsManager");
    const cm = CredentialsManager.getInstance();
    if (cm.getSttProvider() !== provider) {
      cm.setSttProvider(provider);
      console.log(`[IPC] Auto-promoted STT provider to ${provider} after key save`);
    }
  };
  safeHandle("set-stt-provider", async (_, provider) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setSttProvider(provider);
      await appState.reconfigureSttProvider();
      broadcastCredentialsChanged();
      return { success: true };
    } catch (error) {
      console.error("Error setting STT provider:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("get-stt-provider", async () => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      return CredentialsManager.getInstance().getSttProvider();
    } catch (error) {
      return "none";
    }
  });
  safeHandle("stt:debug-simulate-failure", async (_, channel, provider, reason) => {
    try {
      const triggered = appState.debugSimulateSttFailure(channel, provider, reason);
      return { success: triggered, channel, provider: provider || "active" };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("stt:debug-prime-replay-buffer", async (_, channel, durationMs) => {
    try {
      const result = appState.debugPrimeSttReplayBuffer(channel, durationMs);
      return { success: !!result, ...result || {} };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("stt:get-runtime-state", async () => {
    try {
      return appState.getSttRuntimeState();
    } catch (error) {
      return { user: null, interviewer: null, error: error.message };
    }
  });
  safeHandle("stt:set-debug-enabled", async (_, enabled) => {
    try {
      appState.setSttDebugEnabled(!!enabled);
      return { success: true, enabled: appState.getSttDebugEnabled() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("stt:get-debug-enabled", async () => {
    return appState.getSttDebugEnabled();
  });
  safeHandle("stt:run-failover-validation", async (_, channel = "interviewer") => {
    try {
      return await appState.runSttFailoverValidation(channel);
    } catch (error) {
      return { success: false, channel, assertions: {}, logs: [error.message] };
    }
  });
  safeHandle("stt:run-load-test", async (_, channel = "interviewer", options) => {
    try {
      return await appState.runSttLoadTest(channel, options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-groq-stt-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setGroqSttApiKey(apiKey);
      autoSelectSttProviderForSavedKey("groq", apiKey);
      await appState.reconfigureSttProvider();
      broadcastCredentialsChanged();
      return { success: true };
    } catch (error) {
      console.error("Error saving Groq STT API key:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-openai-stt-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setOpenAiSttApiKey(apiKey);
      autoSelectSttProviderForSavedKey("openai", apiKey);
      await appState.reconfigureSttProvider();
      broadcastCredentialsChanged();
      return { success: true };
    } catch (error) {
      console.error("Error saving OpenAI STT API key:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-deepgram-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const cm = CredentialsManager.getInstance();
      cm.setDeepgramApiKey(apiKey);
      autoSelectSttProviderForSavedKey("deepgram", apiKey);
      await appState.reconfigureSttProvider();
      broadcastCredentialsChanged();
      return { success: true };
    } catch (error) {
      console.error("Error saving Deepgram API key:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-groq-stt-model", async (_, model) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setGroqSttModel(model);
      await appState.reconfigureSttProvider();
      return { success: true };
    } catch (error) {
      console.error("Error setting Groq STT model:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-elevenlabs-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setElevenLabsApiKey(apiKey);
      autoSelectSttProviderForSavedKey("elevenlabs", apiKey);
      await appState.reconfigureSttProvider();
      broadcastCredentialsChanged();
      return { success: true };
    } catch (error) {
      console.error("Error saving ElevenLabs API key:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-azure-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setAzureApiKey(apiKey);
      autoSelectSttProviderForSavedKey("azure", apiKey);
      await appState.reconfigureSttProvider();
      broadcastCredentialsChanged();
      return { success: true };
    } catch (error) {
      console.error("Error saving Azure API key:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-azure-region", async (_, region) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setAzureRegion(region);
      await appState.reconfigureSttProvider();
      return { success: true };
    } catch (error) {
      console.error("Error setting Azure region:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-ibmwatson-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setIbmWatsonApiKey(apiKey);
      autoSelectSttProviderForSavedKey("ibmwatson", apiKey);
      await appState.reconfigureSttProvider();
      broadcastCredentialsChanged();
      return { success: true };
    } catch (error) {
      console.error("Error saving IBM Watson API key:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-soniox-api-key", async (_, apiKey) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setSonioxApiKey(apiKey);
      autoSelectSttProviderForSavedKey("soniox", apiKey);
      await appState.reconfigureSttProvider();
      broadcastCredentialsChanged();
      return { success: true };
    } catch (error) {
      console.error("Error saving Soniox API key:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-ibmwatson-region", async (_, region) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setIbmWatsonRegion(region);
      await appState.reconfigureSttProvider();
      return { success: true };
    } catch (error) {
      console.error("Error setting IBM Watson region:", error);
      return { success: false, error: error.message };
    }
  });
  const sanitizeErrorMessage = (msg) => {
    return msg.replace(/:\s*[a-zA-Z0-9*]+\*+[a-zA-Z0-9*]+\.?$/g, "").trim();
  };
  safeHandle("test-stt-connection", async (_, provider, apiKey, region) => {
    console.log(`[IPC] Received test - stt - connection request for provider: ${provider} `);
    try {
      if (provider === "deepgram") {
        const WebSocket = require("ws");
        const token = apiKey.trim();
        return await new Promise((resolve) => {
          const url = "wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1";
          const ws = new WebSocket(url, {
            headers: { Authorization: `Token ${token}` }
          });
          const timeout = setTimeout(() => {
            ws.close();
            console.error("[IPC] Deepgram test failed: Connection timed out");
            resolve({ success: false, error: "Connection timed out" });
          }, 15e3);
          ws.on("open", () => {
            clearTimeout(timeout);
            try {
              ws.send(JSON.stringify({ type: "CloseStream" }));
            } catch {
            }
            ws.close();
            resolve({ success: true });
          });
          ws.on("unexpected-response", (request, response) => {
            clearTimeout(timeout);
            const status = response.statusCode;
            let body = "";
            response.on("data", (chunk) => {
              body += chunk.toString();
            });
            response.on("end", () => {
              const errMsg = `Unexpected server response: ${status} - ${body}`;
              console.error(`[IPC] Deepgram test failed: ${errMsg}`);
              resolve({ success: false, error: errMsg });
            });
          });
          ws.on("error", (err) => {
            clearTimeout(timeout);
            console.error(`[IPC] Deepgram test error: ${err.message}`);
            resolve({ success: false, error: err.message || "Connection failed" });
          });
        });
      }
      if (provider === "soniox") {
        const WebSocket = require("ws");
        return await new Promise((resolve) => {
          let resolved = false;
          const done = (result) => {
            if (resolved) return;
            resolved = true;
            try {
              ws.close();
            } catch {
            }
            resolve(result);
          };
          const ws = new WebSocket("wss://stt-rt.soniox.com/transcribe-websocket");
          const connectTimeout = setTimeout(() => {
            done({ success: false, error: "Connection timed out" });
          }, 1e4);
          ws.on("open", () => {
            clearTimeout(connectTimeout);
            ws.send(JSON.stringify({
              api_key: apiKey,
              model: "stt-rt-v4",
              audio_format: "pcm_s16le",
              sample_rate: 16e3,
              num_channels: 1
            }));
            setTimeout(() => done({ success: true }), 2500);
          });
          ws.on("message", (msg) => {
            try {
              const res = JSON.parse(msg.toString());
              if (res.error_code) {
                done({ success: false, error: `${res.error_code}: ${res.error_message}` });
              }
            } catch {
            }
          });
          ws.on("error", (err) => {
            clearTimeout(connectTimeout);
            done({ success: false, error: err.message || "Connection failed" });
          });
          ws.on("close", (code) => {
            if (!resolved && code !== 1e3) {
              done({ success: false, error: `Server closed connection (code ${code})` });
            }
          });
        });
      }
      const axios = require("axios");
      const FormData = require("form-data");
      const numSamples = 8e3;
      const pcmData = Buffer.alloc(numSamples * 2);
      const wavHeader = Buffer.alloc(44);
      wavHeader.write("RIFF", 0);
      wavHeader.writeUInt32LE(36 + pcmData.length, 4);
      wavHeader.write("WAVE", 8);
      wavHeader.write("fmt ", 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20);
      wavHeader.writeUInt16LE(1, 22);
      wavHeader.writeUInt32LE(16e3, 24);
      wavHeader.writeUInt32LE(32e3, 28);
      wavHeader.writeUInt16LE(2, 32);
      wavHeader.writeUInt16LE(16, 34);
      wavHeader.write("data", 36);
      wavHeader.writeUInt32LE(pcmData.length, 40);
      const testWav = Buffer.concat([wavHeader, pcmData]);
      if (provider === "elevenlabs") {
        try {
          await axios.get("https://api.elevenlabs.io/v1/voices", {
            headers: { "xi-api-key": apiKey },
            timeout: 1e4
          });
        } catch (elErr) {
          const elStatus = elErr?.response?.data?.detail?.status;
          if (elStatus === "invalid_api_key") {
            throw elErr;
          }
          console.log("[IPC] ElevenLabs key is valid but may have restricted scopes. Saving key.");
        }
      } else if (provider === "azure") {
        const azureRegion = region || "eastus";
        await axios.post(
          `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`,
          testWav,
          {
            headers: { "Ocp-Apim-Subscription-Key": apiKey, "Content-Type": "audio/wav" },
            timeout: 15e3
          }
        );
      } else if (provider === "ibmwatson") {
        const ibmRegion = region || "us-south";
        await axios.post(
          `https://api.${ibmRegion}.speech-to-text.watson.cloud.ibm.com/v1/recognize`,
          testWav,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString("base64")}`,
              "Content-Type": "audio/wav"
            },
            timeout: 15e3
          }
        );
      } else {
        const endpoint = provider === "groq" ? "https://api.groq.com/openai/v1/audio/transcriptions" : "https://api.openai.com/v1/audio/transcriptions";
        const model = provider === "groq" ? "whisper-large-v3-turbo" : "whisper-1";
        const form = new FormData();
        form.append("file", testWav, { filename: "test.wav", contentType: "audio/wav" });
        form.append("model", model);
        await axios.post(endpoint, form, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...form.getHeaders()
          },
          timeout: 15e3
        });
      }
      return { success: true };
    } catch (error) {
      const respData = error?.response?.data;
      const rawMsg = respData?.error?.message || respData?.detail?.message || respData?.message || error.message || "Connection failed";
      const msg = sanitizeErrorMessage(rawMsg);
      console.error("STT connection test failed:", msg);
      return { success: false, error: msg };
    }
  });
  safeHandle("test-llm-connection", async (_, provider, apiKey) => {
    console.log(`[IPC] Received test-llm-connection request for provider: ${provider}`);
    try {
      if (!apiKey || !apiKey.trim()) {
        const { CredentialsManager } = require("./services/CredentialsManager");
        const creds = CredentialsManager.getInstance();
        if (provider === "gemini") apiKey = creds.getGeminiApiKey();
        else if (provider === "groq") apiKey = creds.getGroqApiKey();
        else if (provider === "openai") apiKey = creds.getOpenaiApiKey();
        else if (provider === "claude") apiKey = creds.getClaudeApiKey();
      }
      if (!apiKey || !apiKey.trim()) {
        return { success: false, error: "No API key provided" };
      }
      const axios = require("axios");
      let response;
      if (provider === "gemini") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent`;
        response = await axios.post(url, {
          contents: [{ parts: [{ text: "Hello" }] }]
        }, {
          headers: { "x-goog-api-key": apiKey },
          timeout: 15e3
        });
      } else if (provider === "groq") {
        response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15e3
        });
      } else if (provider === "openai") {
        response = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15e3
        });
      } else if (provider === "claude") {
        response = await axios.post("https://api.anthropic.com/v1/messages", {
          model: "claude-sonnet-4-6",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          timeout: 15e3
        });
      }
      if (response && (response.status === 200 || response.status === 201)) {
        return { success: true };
      } else {
        return { success: false, error: "Request failed with status " + response?.status };
      }
    } catch (error) {
      console.error("LLM connection test failed:", error);
      const rawMsg = error?.response?.data?.error?.message || error?.response?.data?.message || (error.response?.data?.error?.type ? `${error.response.data.error.type}: ${error.response.data.error.message}` : error.message) || "Connection failed";
      const msg = sanitizeErrorMessage(rawMsg);
      return { success: false, error: msg };
    }
  });
  safeHandle("get-groq-fast-text-mode", () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return { enabled: llmHelper.getGroqFastTextMode() };
    } catch (error) {
      return { enabled: false };
    }
  });
  safeHandle("set-groq-fast-text-mode", (_, enabled) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqFastTextMode(enabled);
      const { SettingsManager } = require("./services/SettingsManager");
      SettingsManager.getInstance().set("groqFastTextMode", enabled);
      import_electron.BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("groq-fast-text-changed", enabled);
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-model", async (_, modelId) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const { CredentialsManager } = require("./services/CredentialsManager");
      const cm = CredentialsManager.getInstance();
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];
      llmHelper.setModel(modelId, allProviders);
      appState.modelSelectorWindowHelper.hideWindow();
      import_electron.BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("model-changed", modelId);
        }
      });
      return { success: true };
    } catch (error) {
      console.error("Error setting model:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-default-model", async (_, modelId) => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const { isBedrockModelId, resolveBedrockModelId } = require("./llm/BedrockModelIds");
      const cm = CredentialsManager.getInstance();
      const bedrockPreferred = cm.getPreferredModel("bedrock") || cm.getBedrockCredentials()?.preferredModel;
      const finalModelId = isBedrockModelId(modelId, bedrockPreferred) ? resolveBedrockModelId(modelId, bedrockPreferred) || modelId : modelId;
      cm.setDefaultModel(finalModelId);
      const llmHelper = appState.processingHelper.getLLMHelper();
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];
      llmHelper.setModel(finalModelId, allProviders);
      appState.modelSelectorWindowHelper.hideWindow();
      import_electron.BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("model-changed", finalModelId);
        }
      });
      return { success: true };
    } catch (error) {
      console.error("Error setting default model:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("get-default-model", async () => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const cm = CredentialsManager.getInstance();
      return { model: cm.getDefaultModel() };
    } catch (error) {
      console.error("Error getting default model:", error);
      return { model: "gemini-3.1-flash-lite-preview" };
    }
  });
  safeHandle("show-model-selector", (_, coords) => {
    appState.modelSelectorWindowHelper.showWindow(coords.x, coords.y);
  });
  safeHandle("hide-model-selector", () => {
    appState.modelSelectorWindowHelper.hideWindow();
  });
  safeHandle("toggle-model-selector", (_, coords) => {
    appState.modelSelectorWindowHelper.toggleWindow(coords.x, coords.y);
  });
  safeHandle("native-audio-status", async () => {
    return { connected: true };
  });
  safeHandle("get-input-devices", async () => {
    return import_AudioDevices.AudioDevices.getInputDevices();
  });
  safeHandle("get-output-devices", async () => {
    return import_AudioDevices.AudioDevices.getOutputDevices();
  });
  safeHandle("start-audio-test", async (event, deviceId) => {
    await appState.startAudioTest(deviceId);
    return { success: true };
  });
  safeHandle("stop-audio-test", async () => {
    appState.stopAudioTest();
    return { success: true };
  });
  safeHandle("set-recognition-language", async (_, key) => {
    appState.setRecognitionLanguage(key);
    return { success: true };
  });
  safeHandle("start-meeting", async (event, metadata) => {
    try {
      await appState.startMeeting(metadata);
      return { success: true };
    } catch (error) {
      console.error("Error starting meeting:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("end-meeting", async () => {
    try {
      await appState.endMeeting();
      return { success: true };
    } catch (error) {
      console.error("Error ending meeting:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("get-recent-meetings", async () => {
    return import_DatabaseManager.DatabaseManager.getInstance().getRecentMeetings(50);
  });
  safeHandle("get-meeting-details", async (event, id) => {
    return import_DatabaseManager.DatabaseManager.getInstance().getMeetingDetails(id);
  });
  safeHandle("update-meeting-title", async (_, { id, title }) => {
    return import_DatabaseManager.DatabaseManager.getInstance().updateMeetingTitle(id, title);
  });
  safeHandle("update-meeting-summary", async (_, { id, updates }) => {
    return import_DatabaseManager.DatabaseManager.getInstance().updateMeetingSummary(id, updates);
  });
  safeHandle("seed-demo", async () => {
    import_DatabaseManager.DatabaseManager.getInstance().seedDemoMeeting();
    const ragManager = appState.getRAGManager();
    if (ragManager && ragManager.isReady()) {
      ragManager.ensureDemoMeetingProcessed().catch(console.error);
    }
    return { success: true };
  });
  safeHandle("flush-database", async () => {
    const result = import_DatabaseManager.DatabaseManager.getInstance().clearAllData();
    return { success: result };
  });
  safeHandle("open-external", async (event, url) => {
    try {
      if (url.startsWith("x-apple.systempreferences:")) {
        await import_electron.shell.openExternal(url);
        return;
      }
      const parsed = new URL(url);
      if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
        await import_electron.shell.openExternal(url);
      } else {
        console.warn(`[IPC] Blocked potentially unsafe open-external: ${url}`);
      }
    } catch {
      console.warn(`[IPC] Invalid URL in open-external: ${url}`);
    }
  });
  safeHandle("generate-assist", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const insight = await intelligenceManager.runAssistMode();
      return { insight };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("session:get-mode", async () => {
    return { mode: appState.getIntelligenceManager().getSessionMode() };
  });
  safeHandle("session:get-id", async () => {
    return { sessionId: appState.getIntelligenceManager().getSessionId() };
  });
  safeHandle("session:set-mode", async (_, mode) => {
    const intelligenceManager = appState.getIntelligenceManager();
    intelligenceManager.setSessionMode(mode);
    import_electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("session-mode-changed", { mode });
      }
    });
    return { success: true, mode };
  });
  safeHandle("generate-action", async (_, payload) => {
    const intelligenceManager = appState.getIntelligenceManager();
    const result = await intelligenceManager.handleAction(payload.intent, {
      message: payload.message,
      additionalContext: payload.additionalContext,
      imagePaths: payload.imagePaths,
      requestId: payload.requestId,
      profilePreference: payload.profilePreference,
      modelOverride: payload.modelOverride,
      transcriptOverride: payload.transcriptOverride,
      actionContract: payload.actionContract,
      actionId: payload.actionId,
      contextTarget: payload.contextTarget
    });
    return { success: true, result };
  });
  safeHandle("generate-what-to-say", async (_, question, imagePaths, mode, requestId) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.handleAction("what_to_answer", {
        message: question,
        imagePaths,
        requestId,
        modeOverride: mode
      });
      return { answer, question: question || "inferred from context" };
    } catch (error) {
      return {
        question: question || "unknown"
      };
    }
  });
  safeHandle("generate-clarify", async (_, requestId) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const clarification = await intelligenceManager.handleAction("clarify", {
        requestId,
        profilePreference: "force_off"
      });
      if (clarification === null) {
        const win = appState.getMainWindow();
        win?.webContents.send("intelligence-error", {
          error: "Could not generate a clarifying question. Try again after some audio context is available.",
          mode: "clarify",
          requestId
        });
      }
      return { clarification };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("generate-code-hint", async (_, imagePaths, problemStatement, requestId) => {
    try {
      const resolvedImagePaths = imagePaths && imagePaths.length > 0 ? imagePaths : appState.getScreenshotQueue();
      console.log(`[IPC] generate-code-hint: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? "explicit" : "queue fallback"})`);
      const intelligenceManager = appState.getIntelligenceManager();
      const hint = await intelligenceManager.runCodeHint(
        resolvedImagePaths.length > 0 ? resolvedImagePaths : void 0,
        problemStatement,
        requestId
      );
      return { hint };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("generate-brainstorm", async (_, imagePaths, problemStatement, requestId) => {
    try {
      const resolvedImagePaths = imagePaths && imagePaths.length > 0 ? imagePaths : appState.getScreenshotQueue();
      console.log(`[IPC] generate-brainstorm: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? "explicit" : "queue fallback"})`);
      const intelligenceManager = appState.getIntelligenceManager();
      const script = await intelligenceManager.runBrainstorm(
        resolvedImagePaths.length > 0 ? resolvedImagePaths : void 0,
        problemStatement,
        requestId
      );
      return { script };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("generate-answer-now", async (_, question, imagePaths, context, mode, requestId) => {
    try {
      const answer = await appState.getIntelligenceManager().handleAction("answer_now", {
        message: question,
        imagePaths,
        requestId,
        additionalContext: context,
        modeOverride: mode
      });
      return { answer };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("generate-screen-scan", async (_, imagePaths, extractedText, forcedMode, requestId) => {
    try {
      const resolvedImagePaths = imagePaths && imagePaths.length > 0 ? imagePaths : appState.getScreenshotQueue();
      console.log(`[IPC] generate-screen-scan: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? "explicit" : "queue fallback"}), mode: ${forcedMode || "auto"}`);
      const intelligenceManager = appState.getIntelligenceManager();
      const result = await intelligenceManager.runScreenScan(
        resolvedImagePaths,
        extractedText,
        forcedMode,
        requestId
      );
      return { result, mode: forcedMode || "auto" };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("get-action-button-mode", () => {
    const { SettingsManager } = require("./services/SettingsManager");
    const sm = SettingsManager.getInstance();
    return sm.get("actionButtonMode") ?? "recap";
  });
  safeHandle("set-action-button-mode", (_, mode) => {
    const { SettingsManager } = require("./services/SettingsManager");
    const sm = SettingsManager.getInstance();
    sm.set("actionButtonMode", mode);
    import_electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("action-button-mode-changed", mode);
      }
    });
    return { success: true };
  });
  safeHandle("get-personalization-preferences", () => {
    const { SettingsManager } = require("./services/SettingsManager");
    return SettingsManager.getInstance().getPersonalizationPreferences();
  });
  safeHandle("set-personalization-preferences", (_, patch) => {
    const { SettingsManager } = require("./services/SettingsManager");
    const preferences = SettingsManager.getInstance().setPersonalizationPreferences(patch);
    import_electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("personalization-preferences-changed", preferences);
      }
    });
    return { success: true, preferences };
  });
  safeHandle("generate-follow-up", async (_, intent, userRequest, requestId) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const refined = await intelligenceManager.runFollowUp(intent, userRequest, requestId);
      return { refined, intent };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("generate-recap", async (_, requestId) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const summary = await intelligenceManager.handleAction("recap", {
        requestId,
        profilePreference: "force_off"
      });
      return { summary };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("generate-follow-up-questions", async (_, requestId) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const questions = await intelligenceManager.handleAction("follow_up_questions", {
        requestId,
        profilePreference: "force_off"
      });
      return { questions };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("generate-system-design-tradeoffs", async (_, requestId) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.runSystemDesignTradeoffs(requestId);
      return { answer };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("submit-manual-question", async (_, question, requestId) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.handleAction("manual_chat", {
        message: question,
        requestId
      });
      return { answer, question };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("get-intelligence-context", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      return {
        context: intelligenceManager.getFormattedContext(),
        lastAssistantMessage: intelligenceManager.getLastAssistantMessage(),
        activeMode: intelligenceManager.getActiveMode()
      };
    } catch (error) {
      throw error;
    }
  });
  safeHandle("benchmark:get-summary", async () => {
    return import_BenchmarkManager.BenchmarkManager.getInstance().getSummary();
  });
  safeHandle("benchmark:get-recent", async (_, limit = 20) => {
    return import_BenchmarkManager.BenchmarkManager.getInstance().getRecent(limit);
  });
  safeHandle("reset-intelligence", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.reset();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("select-service-account", async () => {
    try {
      const result = await showOpenDialogNormalized({
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }
      const filePath = result.filePaths[0];
      appState.updateGoogleCredentials(filePath);
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setGoogleServiceAccountPath(filePath);
      return { success: true, path: filePath };
    } catch (error) {
      console.error("Error selecting service account:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("theme:get-mode", () => {
    const tm = appState.getThemeManager();
    return {
      mode: tm.getMode(),
      resolved: tm.getResolvedTheme()
    };
  });
  safeHandle("theme:set-mode", (_, mode) => {
    appState.getThemeManager().setMode(mode);
    return { success: true };
  });
  safeHandle("calendar-connect", async () => {
    try {
      const { CalendarManager } = require("./services/CalendarManager");
      await CalendarManager.getInstance().startAuthFlow();
      const status = CalendarManager.getInstance().getConnectionStatus();
      import_electron.BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("calendar-status-changed", status);
        }
      });
      return { success: true };
    } catch (error) {
      console.error("Calendar auth error:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("calendar-disconnect", async () => {
    const { CalendarManager } = require("./services/CalendarManager");
    await CalendarManager.getInstance().disconnect();
    calendarIntelligence.clearRecommendation();
    import_electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("calendar-status-changed", { connected: false, email: null });
      }
    });
    return { success: true };
  });
  safeHandle("get-calendar-status", async () => {
    const { CalendarManager } = require("./services/CalendarManager");
    return CalendarManager.getInstance().getConnectionStatus();
  });
  safeHandle("get-upcoming-events", async () => {
    const { CalendarManager } = require("./services/CalendarManager");
    return CalendarManager.getInstance().getUpcomingEvents();
  });
  safeHandle("calendar-intelligence:evaluate-events", async (_, events) => {
    return calendarIntelligence.observeUpcomingEvents(Array.isArray(events) ? events : []);
  });
  safeHandle("calendar-intelligence:get-recommendation", async () => {
    return calendarIntelligence.getRecommendation();
  });
  safeHandle("calendar-intelligence:dismiss", async (_, eventId) => {
    calendarIntelligence.dismissEvent(eventId);
    return { success: true };
  });
  safeHandle("calendar-refresh", async () => {
    const { CalendarManager } = require("./services/CalendarManager");
    await CalendarManager.getInstance().refreshState();
    return { success: true };
  });
  safeHandle("generate-followup-email", async (_, input) => {
    try {
      const { FOLLOWUP_EMAIL_PROMPT, GROQ_FOLLOWUP_EMAIL_PROMPT } = require("./llm/prompts");
      const { buildFollowUpEmailPromptInput } = require("./utils/emailUtils");
      const llmHelper = appState.processingHelper.getLLMHelper();
      const contextString = buildFollowUpEmailPromptInput(input);
      const geminiPrompt = `${FOLLOWUP_EMAIL_PROMPT}

MEETING DETAILS:
${contextString}`;
      const groqPrompt = `${GROQ_FOLLOWUP_EMAIL_PROMPT}

MEETING DETAILS:
${contextString}`;
      const emailBody = await llmHelper.chatWithGemini(geminiPrompt, void 0, void 0, true, groqPrompt);
      return emailBody;
    } catch (error) {
      console.error("Error generating follow-up email:", error);
      throw error;
    }
  });
  safeHandle("extract-emails-from-transcript", async (_, transcript) => {
    try {
      const { extractEmailsFromTranscript } = require("./utils/emailUtils");
      return extractEmailsFromTranscript(transcript);
    } catch (error) {
      console.error("Error extracting emails:", error);
      return [];
    }
  });
  safeHandle("get-calendar-attendees", async (_, eventId) => {
    try {
      const { CalendarManager } = require("./services/CalendarManager");
      const cm = CalendarManager.getInstance();
      const events = await cm.getUpcomingEvents();
      const event = events?.find((e) => e.id === eventId);
      if (event && event.attendees) {
        return event.attendees.map((a) => ({
          email: a.email,
          name: a.displayName || a.email?.split("@")[0] || ""
        })).filter((a) => a.email);
      }
      return [];
    } catch (error) {
      console.error("Error getting calendar attendees:", error);
      return [];
    }
  });
  safeHandle("open-mailto", async (_, { to, subject, body }) => {
    try {
      const { buildMailtoLink } = require("./utils/emailUtils");
      const mailtoUrl = buildMailtoLink(to, subject, body);
      await import_electron.shell.openExternal(mailtoUrl);
      return { success: true };
    } catch (error) {
      console.error("Error opening mailto:", error);
      return { success: false, error: error.message };
    }
  });
  const activeRAGQueries = /* @__PURE__ */ new Map();
  const activeRAGActionRequestIds = /* @__PURE__ */ new Map();
  const activeLiveRagQueriesBySender = /* @__PURE__ */ new Map();
  safeHandle("rag:query-meeting", async (event, { meetingId, query }) => {
    const ragManager = appState.getRAGManager();
    const intelligenceManager = appState.getIntelligenceManager();
    if (!ragManager || !ragManager.isReady()) {
      console.log("[RAG] Not ready, falling back to regular chat");
      return { fallback: true };
    }
    if (!ragManager.isMeetingProcessed(meetingId) && !ragManager.isLiveIndexingActive(meetingId)) {
      console.log(`[RAG] Meeting ${meetingId} not processed and no JIT indexing, falling back to regular chat`);
      return { fallback: true };
    }
    const abortController = new AbortController();
    const queryKey = `meeting-${meetingId}`;
    const requestId = `rag-meeting-${meetingId}-${Date.now()}`;
    activeRAGQueries.set(queryKey, abortController);
    activeRAGActionRequestIds.set(queryKey, requestId);
    try {
      const retrieved = await ragManager.retrieveMeetingContext(meetingId, query);
      const onToken = (payload) => {
        if (payload?.intent !== "manual_chat" || payload?.requestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-chunk", { meetingId, chunk: payload.token });
      };
      const onResult = (payload) => {
        if (payload?.intent !== "manual_chat" || payload?.requestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-complete", { meetingId });
      };
      const onError = (error, _mode, failedRequestId) => {
        if (failedRequestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-error", { meetingId, error: error?.message || "Unknown error" });
      };
      intelligenceManager.on("action_token", onToken);
      intelligenceManager.on("action_result", onResult);
      intelligenceManager.on("error", onError);
      try {
        await intelligenceManager.handleAction("manual_chat", {
          message: query,
          requestId,
          rag: {
            content: retrieved.formattedContext,
            scope: "meeting",
            title: "RAG MEMORY (MEETING)"
          },
          profilePreference: "force_off",
          additionalContext: [
            "Answer questions ONLY about this meeting.",
            "Be concise and natural.",
            "If the answer is not present, say so briefly and do not guess."
          ].join("\n")
        });
      } finally {
        intelligenceManager.off("action_token", onToken);
        intelligenceManager.off("action_result", onResult);
        intelligenceManager.off("error", onError);
      }
      return { success: true };
    } catch (error) {
      if (error.name !== "AbortError") {
        const msg = error.message || "";
        if (msg.includes("NO_RELEVANT_CONTEXT") || msg.includes("NO_MEETING_EMBEDDINGS")) {
          console.log(`[RAG] Query failed with '${msg}', falling back to regular chat`);
          return { fallback: true };
        }
        console.error("[RAG] Query error:", error);
        event.sender.send("rag:stream-error", { meetingId, error: msg });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
      activeRAGActionRequestIds.delete(queryKey);
    }
  });
  safeHandle("rag:query-live", async (event, { query, requestId }) => {
    const ragManager = appState.getRAGManager();
    const intelligenceManager = appState.getIntelligenceManager();
    const senderId = event.sender.id;
    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }
    if (!ragManager.isLiveIndexingActive("live-meeting-current")) {
      return { fallback: true };
    }
    const priorLiveQuery = activeLiveRagQueriesBySender.get(senderId);
    if (priorLiveQuery) {
      priorLiveQuery.controller.abort();
      if (priorLiveQuery.requestId) {
        appState.getIntelligenceManager().getEngine()?.cancelRequest(priorLiveQuery.requestId);
      }
      activeRAGQueries.delete(priorLiveQuery.queryKey);
      activeRAGActionRequestIds.delete(priorLiveQuery.queryKey);
      activeLiveRagQueriesBySender.delete(senderId);
    }
    const abortController = new AbortController();
    const queryKey = `live-${Date.now()}`;
    activeRAGQueries.set(queryKey, abortController);
    if (requestId) {
      activeRAGActionRequestIds.set(queryKey, requestId);
    }
    activeLiveRagQueriesBySender.set(senderId, { queryKey, controller: abortController, requestId });
    try {
      const retrieved = await ragManager.retrieveMeetingContext("live-meeting-current", query);
      const onToken = (payload) => {
        if (payload?.requestId !== requestId || payload?.intent !== "manual_chat") return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-chunk", { live: true, chunk: payload.token, requestId });
      };
      const onResult = (payload) => {
        if (payload?.requestId !== requestId || payload?.intent !== "manual_chat") return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-complete", { live: true, requestId });
      };
      const onError = (error, _mode, failedRequestId) => {
        if (failedRequestId !== requestId || abortController.signal.aborted) return;
        event.sender.send("rag:stream-error", { live: true, error: error?.message || "Unknown error", requestId });
      };
      intelligenceManager.on("action_token", onToken);
      intelligenceManager.on("action_result", onResult);
      intelligenceManager.on("error", onError);
      try {
        await intelligenceManager.handleAction("manual_chat", {
          message: query,
          requestId,
          rag: {
            content: retrieved.formattedContext,
            scope: "live",
            title: "RAG MEMORY (LIVE)"
          },
          profilePreference: "force_off",
          additionalContext: [
            "Answer questions ONLY about the current live meeting.",
            "Be concise and natural.",
            "If the answer is not present, say so briefly and do not guess."
          ].join("\n")
        });
      } finally {
        intelligenceManager.off("action_token", onToken);
        intelligenceManager.off("action_result", onResult);
        intelligenceManager.off("error", onError);
      }
      return { success: true };
    } catch (error) {
      if (error.name !== "AbortError") {
        const msg = error.message || "";
        if (msg.includes("NO_RELEVANT_CONTEXT") || msg.includes("NO_MEETING_EMBEDDINGS")) {
          console.log(`[RAG] JIT query failed with '${msg}', falling back to regular live chat`);
          return { fallback: true };
        }
        console.error("[RAG] Live query error:", error);
        event.sender.send("rag:stream-error", { live: true, error: msg, requestId });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
      activeRAGActionRequestIds.delete(queryKey);
      if (activeLiveRagQueriesBySender.get(senderId)?.queryKey === queryKey) {
        activeLiveRagQueriesBySender.delete(senderId);
      }
    }
  });
  safeHandle("rag:query-global", async (event, { query, requestId: providedRequestId }) => {
    const ragManager = appState.getRAGManager();
    const intelligenceManager = appState.getIntelligenceManager();
    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }
    const abortController = new AbortController();
    const queryKey = `global-${Date.now()}`;
    const requestId = providedRequestId || `rag-global-${Date.now()}`;
    activeRAGQueries.set(queryKey, abortController);
    activeRAGActionRequestIds.set(queryKey, requestId);
    try {
      const retrieved = await ragManager.retrieveGlobalContext(query);
      const onToken = (payload) => {
        if (payload?.intent !== "manual_chat" || payload?.requestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-chunk", { global: true, chunk: payload.token, requestId });
      };
      const onResult = (payload) => {
        if (payload?.intent !== "manual_chat" || payload?.requestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-complete", { global: true, requestId });
      };
      const onError = (error, _mode, failedRequestId) => {
        if (failedRequestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-error", { global: true, error: error?.message || "Unknown error", requestId });
      };
      intelligenceManager.on("action_token", onToken);
      intelligenceManager.on("action_result", onResult);
      intelligenceManager.on("error", onError);
      try {
        await intelligenceManager.handleAction("manual_chat", {
          message: query,
          requestId,
          rag: {
            content: retrieved.formattedContext,
            scope: "global",
            title: "RAG MEMORY (GLOBAL)"
          },
          profilePreference: "force_off",
          additionalContext: [
            "Answer by searching across meetings.",
            "Mention which meeting or time period the answer came from when possible.",
            "Be concise and do not guess."
          ].join("\n")
        });
      } finally {
        intelligenceManager.off("action_token", onToken);
        intelligenceManager.off("action_result", onResult);
        intelligenceManager.off("error", onError);
      }
      return { success: true };
    } catch (error) {
      if (error.name !== "AbortError") {
        const msg = error.message || "";
        if (msg.includes("NO_RELEVANT_CONTEXT") || msg.includes("NO_MEETING_EMBEDDINGS")) {
          console.log(`[RAG] Global query failed with '${msg}', falling back to regular chat`);
          return { fallback: true };
        }
        event.sender.send("rag:stream-error", { global: true, error: msg, requestId });
      }
      return { success: false, error: error.message };
    } finally {
      activeRAGQueries.delete(queryKey);
      activeRAGActionRequestIds.delete(queryKey);
    }
  });
  safeHandle("rag:cancel-query", async (_, { meetingId, global }) => {
    const queryKey = global ? "global" : `meeting-${meetingId}`;
    for (const [key, controller] of activeRAGQueries) {
      if (key.startsWith(queryKey) || global && key.startsWith("global")) {
        controller.abort();
        const requestId = activeRAGActionRequestIds.get(key);
        if (requestId) {
          appState.getIntelligenceManager().getEngine()?.cancelRequest(requestId);
        }
        activeRAGQueries.delete(key);
        activeRAGActionRequestIds.delete(key);
      }
    }
    return { success: true };
  });
  safeHandle("rag:is-meeting-processed", async (_, meetingId) => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error("RAGManager not initialized");
      return ragManager.isMeetingProcessed(meetingId);
    } catch (error) {
      console.error("[IPC rag:is-meeting-processed] Error:", error);
      return false;
    }
  });
  safeHandle("rag:reindex-incompatible-meetings", async () => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error("RAGManager not initialized");
      await ragManager.reindexIncompatibleMeetings();
      return { success: true };
    } catch (error) {
      console.error("[IPC rag:reindex-incompatible-meetings] Error:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("rag:get-queue-status", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { pending: 0, processing: 0, completed: 0, failed: 0 };
    return ragManager.getQueueStatus();
  });
  safeHandle("rag:retry-embeddings", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { success: false };
    await ragManager.retryPendingEmbeddings();
    return { success: true };
  });
  const getTavilyKey = () => {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const key = CredentialsManager.getInstance().getTavilyApiKey();
      return typeof key === "string" && key.trim() ? key.trim() : null;
    } catch {
      return null;
    }
  };
  const configureExplicitTavilyResearchProvider = (orchestrator) => {
    if (!orchestrator) return null;
    const tavilyApiKey = getTavilyKey();
    if (!tavilyApiKey) {
      orchestrator.setCompanyResearchProvider?.(null);
      return null;
    }
    const { TavilySearchProvider } = require("../premium/electron/knowledge/TavilySearchProvider");
    orchestrator.setCompanyResearchProvider?.(new TavilySearchProvider(tavilyApiKey));
    return tavilyApiKey;
  };
  safeHandle("profile:upload-resume", async (_, filePath) => {
    try {
      if (!isProOrTrialActive()) {
        return { success: false, error: "Pro license required. Please activate a license key to use Profile Intelligence features." };
      }
      console.log(`[IPC] profile:upload-resume called with: ${filePath}`);
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: "Knowledge engine not initialized. Please ensure API keys are configured." };
      }
      const { DocType } = require("../premium/electron/knowledge/types");
      const result = await orchestrator.ingestDocument(filePath, DocType.RESUME);
      return result;
    } catch (error) {
      console.error("[IPC] profile:upload-resume error:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("profile:get-status", async () => {
    try {
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { hasProfile: false, profileMode: false, isReady: false };
      }
      const status = orchestrator.getStatus();
      return {
        hasProfile: status.hasResume,
        profileMode: status.activeMode,
        isReady: status.isReady,
        name: status.resumeSummary?.name,
        role: status.resumeSummary?.role,
        totalExperienceYears: status.resumeSummary?.totalExperienceYears
      };
    } catch (error) {
      return { hasProfile: false, profileMode: false, isReady: false };
    }
  });
  safeHandle("profile:set-mode", async (_, enabled) => {
    try {
      if (enabled && !isProOrTrialActive()) {
        return { success: false, error: "Pro license required. Please activate a license key to use Profile Intelligence features." };
      }
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: "Knowledge engine not initialized" };
      }
      orchestrator.setKnowledgeMode(enabled);
      const { SettingsManager } = require("./services/SettingsManager");
      SettingsManager.getInstance().set("knowledgeMode", enabled);
      import_electron.BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("profile-mode-changed", enabled);
        }
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("profile:delete", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: "Knowledge engine not initialized" };
      }
      const { DocType } = require("../premium/electron/knowledge/types");
      orchestrator.deleteDocumentsByType(DocType.RESUME);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("profile:get-profile", async () => {
    try {
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }
      if (!hasActiveProPlan()) {
        return {
          error: "PRO_REQUIRED",
          engineReady: false
        };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return null;
      const status = orchestrator.getStatus?.() || {};
      return {
        ...orchestrator.getProfileData() || {},
        hasResume: !!status.hasResume,
        engineReady: !!orchestrator.isEngineReady?.()
      };
    } catch (error) {
      return null;
    }
  });
  safeHandle("get-tavily-key", async () => {
    return getTavilyKey();
  });
  safeHandle("profile:select-file", async () => {
    try {
      const result = await showOpenDialogNormalized({
        properties: ["openFile"],
        filters: [
          { name: "Resume Files", extensions: ["pdf", "docx", "txt"] }
        ]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true };
      }
      return { success: true, filePath: result.filePaths[0] };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("profile:upload-jd", async (_, filePath) => {
    try {
      if (!isProOrTrialActive()) {
        return { success: false, error: "Pro license required. Please activate a license key to use Profile Intelligence features." };
      }
      console.log(`[IPC] profile:upload-jd called with: ${filePath}`);
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: "Knowledge engine not initialized. Please ensure API keys are configured." };
      }
      const { DocType } = require("../premium/electron/knowledge/types");
      const result = await orchestrator.ingestDocument(filePath, DocType.JD);
      return result;
    } catch (error) {
      console.error("[IPC] profile:upload-jd error:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("profile:delete-jd", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: "Knowledge engine not initialized" };
      }
      const { DocType } = require("../premium/electron/knowledge/types");
      orchestrator.deleteDocumentsByType(DocType.JD);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("profile:research-company", async (_, companyName) => {
    try {
      if (!isProOrTrialActive()) {
        return { success: false, error: "Pro license required. Please activate a license key to use Profile Intelligence features." };
      }
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: "Knowledge engine not initialized" };
      }
      const profileData = orchestrator.getProfileData();
      const tavilyApiKey = configureExplicitTavilyResearchProvider(orchestrator);
      if (!tavilyApiKey) {
        return { success: false, error: "MISSING_API_KEY" };
      }
      const result = await orchestrator.runCompanyResearch?.(
        companyName,
        profileData?.activeJD?.title || "",
        { forceRefresh: true }
      );
      if (!result) {
        return { success: false, error: "Company research flow unavailable" };
      }
      return { success: true, status: result.status, research: result.research ?? null };
    } catch (error) {
      console.error("[IPC] profile:research-company error:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("run_company_research", async (_, payload) => {
    try {
      if (!isProOrTrialActive()) {
        return { success: false, error: "LICENSE_REQUIRED" };
      }
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: "ENGINE_NOT_INITIALIZED" };
      }
      const tavilyApiKey = configureExplicitTavilyResearchProvider(orchestrator);
      if (!tavilyApiKey) {
        return { success: false, error: "MISSING_API_KEY" };
      }
      const result = await orchestrator.runCompanyResearch?.(
        payload?.company || "",
        payload?.role || "",
        { forceRefresh: !!payload?.forceRefresh }
      );
      if (!result) {
        return { success: false, error: "RESEARCH_UNAVAILABLE" };
      }
      return {
        success: true,
        status: result.status,
        research: result.research ?? null
      };
    } catch (error) {
      console.error("[IPC] run_company_research error:", error);
      return {
        success: false,
        error: error?.message || "UNKNOWN_ERROR"
      };
    }
  });
  safeHandle("profile:generate-negotiation", async (_, force = false) => {
    try {
      if (!isProOrTrialActive()) {
        return { success: false, error: "Pro license required. Please activate a license key to use Profile Intelligence features." };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: "Knowledge engine unavailable" };
      }
      if (typeof orchestrator.isEngineReady === "function" && !orchestrator.isEngineReady()) {
        const restoredScript = orchestrator.getNegotiationScript?.();
        if (restoredScript) {
          return { success: true, script: restoredScript };
        }
        return { success: false, error: "Knowledge engine is still restoring. Please try again in a moment." };
      }
      const status = orchestrator.getStatus();
      if (!status.hasResume) {
        return { success: false, error: "No resume loaded" };
      }
      let script = force ? null : orchestrator.getNegotiationScript();
      let regenerated = false;
      let hashChanged = false;
      if (!script) {
        const result = await orchestrator.generateNegotiationScriptOnDemand();
        script = result?.script ?? null;
        regenerated = !!result?.regenerated;
        hashChanged = !!result?.hashChanged;
      }
      if (!script) {
        return { success: false, error: "Could not generate negotiation script. Ensure a resume and job description are uploaded." };
      }
      if (orchestrator.isNegotiationContextEnabled?.()) {
        orchestrator.setNegotiationContextEnabled(true);
        broadcastNegotiationStateChanged();
      }
      if (regenerated && hashChanged) {
        const aotState = appState.getAOTState();
        import_electron.BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send("negotiation_regenerated", {
              regenerated: true,
              updatedAt: aotState.negotiation.updatedAt,
              version: aotState.negotiation.version,
              hash: aotState.negotiation.hash
            });
          }
        });
      }
      return { success: true, script };
    } catch (error) {
      console.error("[IPC] profile:generate-negotiation error:", error);
      return { success: false, error: error.message };
    }
  });
  safeHandle("overlay:log-system-design-mode", async (_, enabled) => {
    console.log(`[IPC] System Design Mode ${enabled ? "ON" : "OFF"}`);
    return { success: true };
  });
  safeHandle("profile:get-negotiation-state", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false, error: "Engine not ready" };
      const tracker = orchestrator.getNegotiationTracker();
      return {
        success: true,
        enabled: orchestrator.isNegotiationContextEnabled?.() ?? tracker.isActive(),
        state: tracker.getState(),
        isActive: tracker.isActive()
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("profile:set-negotiation-context-enabled", async (_, enabled) => {
    try {
      if (!isProOrTrialActive()) {
        console.warn("[IPC] Negotiation toggle blocked \u2014 Pro license required");
        return { success: false, error: "Pro license required. Please activate a license key to use Profile Intelligence features." };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        console.warn("[IPC] Negotiation toggle blocked \u2014 engine not ready");
        return { success: false, error: "Engine not ready" };
      }
      const hasScript = !!orchestrator.getNegotiationScript?.();
      if (enabled && !hasScript) {
        console.warn("[IPC] Negotiation toggle blocked \u2014 no script generated yet");
        return { success: false, error: "Generate a negotiation script first." };
      }
      const result = orchestrator.setNegotiationContextEnabled(Boolean(enabled));
      console.log(`[IPC] Negotiation context ${enabled ? "ON" : "OFF"} \u2192 phase=${result.state?.phase}`);
      broadcastNegotiationStateChanged();
      return {
        success: true,
        enabled: result.enabled,
        isActive: result.state.phase !== "INACTIVE",
        state: result.state,
        hasScript
      };
    } catch (error) {
      console.error("[IPC] Negotiation toggle error:", error.message);
      return { success: false, error: error.message };
    }
  });
  safeHandle("profile:reset-negotiation", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false };
      orchestrator.resetNegotiationSession();
      broadcastNegotiationStateChanged();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("profile:get-notes", async () => {
    try {
      const content = import_DatabaseManager.DatabaseManager.getInstance().getCustomNotes();
      return { success: true, content };
    } catch (error) {
      return { success: false, content: "", error: error.message };
    }
  });
  safeHandle("profile:save-notes", async (_, content) => {
    try {
      const trimmed = typeof content === "string" ? content.slice(0, 4e3) : "";
      import_DatabaseManager.DatabaseManager.getInstance().saveCustomNotes(trimmed);
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (orchestrator?.setCustomNotes) orchestrator.setCustomNotes(trimmed);
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper?.setCustomNotes) llmHelper.setCustomNotes(trimmed);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-custom-notes-enabled", async (_, enabled) => {
    try {
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper?.setCustomNotesEnabled) {
        llmHelper.setCustomNotesEnabled(!!enabled);
      }
      const orchestrator = appState.getKnowledgeOrchestrator?.();
      if (orchestrator?.setCustomNotesEnabled) {
        orchestrator.setCustomNotesEnabled(!!enabled);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("get-custom-notes-enabled", async () => {
    try {
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      return { success: true, enabled: llmHelper?.getCustomNotesEnabled?.() ?? true };
    } catch (error) {
      return { success: false, enabled: true, error: error.message };
    }
  });
  safeHandle("set-tavily-api-key", async (_, apiKey) => {
    try {
      if (apiKey && !apiKey.startsWith("tvly-")) {
        return { success: false, error: 'Invalid Tavily API key. Keys must start with "tvly-".' };
      }
      const { CredentialsManager } = require("./services/CredentialsManager");
      CredentialsManager.getInstance().setTavilyApiKey(apiKey);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  safeHandle("set-overlay-opacity", async (_, opacity) => {
    const clamped = Math.min(1, Math.max(0.35, opacity));
    import_electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("overlay-opacity-changed", clamped);
      }
    });
    return;
  });
  safeHandle("permissions:getStatus", async () => {
    return permissionManager.getStatus();
  });
  safeHandle("permissions:requestMicrophone", async () => {
    return permissionManager.requestMicrophonePermission();
  });
  safeHandle("permissions:requestScreenRecording", async () => {
    return permissionManager.requestScreenRecordingPermission();
  });
  safeHandle("permissions:requestAccessibility", async () => {
    return permissionManager.requestAccessibilityPermission();
  });
  safeHandle("permissions:openSettings", async (_, permission) => {
    return permissionManager.openSettings(permission);
  });
  const isGeneralModeId = (mgr, modeId) => mgr.getModes().some((mode) => mode.id === modeId && mode.templateType === "general");
  const ownsGeneralSection = (mgr, sectionId) => mgr.getState().userModes.some(
    (mode) => mode.templateId === "general" && mode.notesTemplate.some((section) => section.id === sectionId)
  );
  const ownsGeneralReferenceFile = (mgr, fileId) => mgr.getState().userModes.some(
    (mode) => mode.templateId === "general" && mode.referenceFiles.some((file) => file.id === fileId)
  );
  safeHandle("modes:get-state", async () => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      return ModesManager.getInstance().getState();
    } catch (e) {
      console.error("[IPC] modes:get-state error:", e);
      return {
        templates: [],
        userModes: [],
        selectedModeId: null,
        activeModeId: null
      };
    }
  });
  safeHandle("modes:get-templates", async () => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      return ModesManager.getInstance().getTemplates();
    } catch (e) {
      console.error("[IPC] modes:get-templates error:", e);
      return [];
    }
  });
  safeHandle("modes:get-all", async () => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      const modes = mgr.getModes();
      return modes.map((m) => ({
        ...m,
        referenceFileCount: mgr.getReferenceFiles(m.id).length
      }));
    } catch (e) {
      console.error("[IPC] modes:get-all error:", e);
      return [];
    }
  });
  safeHandle("modes:get-active", async () => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      return ModesManager.getInstance().getActiveMode();
    } catch (e) {
      console.error("[IPC] modes:get-active error:", e);
      return null;
    }
  });
  safeHandle("modes:create", async (_, params) => {
    try {
      if (!isProOrTrialActive()) return { success: false, error: "pro_required" };
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      const mode = mgr.createMode({
        name: params.name,
        templateId: params.templateId ?? params.templateType ?? "general"
      });
      broadcastModesState();
      return { success: true, mode, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:create error:", e);
      return { success: false, error: e.message };
    }
  });
  safeHandle("modes:update", async (_, id, updates) => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive()) {
        const requestedTemplate = updates.templateId ?? updates.templateType;
        if (requestedTemplate && requestedTemplate !== "general") {
          return { success: false, error: "pro_required" };
        }
        const existing = mgr.getModes().find((m) => m.id === id);
        if (existing && existing.templateType !== "general") {
          return { success: false, error: "pro_required" };
        }
      }
      mgr.updateMode(id, updates);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:update error:", e);
      return { success: false, error: e.message };
    }
  });
  safeHandle("modes:delete", async (_, id) => {
    try {
      if (!isProOrTrialActive()) return { success: false, error: "pro_required" };
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      mgr.deleteMode(id);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:delete error:", e);
      return { success: false, error: e.message };
    }
  });
  safeHandle("modes:set-selected", async (_, id) => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      mgr.setSelectedMode(id);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:set-selected error:", e);
      return { success: false, error: e.message };
    }
  });
  safeHandle("modes:set-active", async (_, id) => {
    try {
      if (id !== null) {
        const { ModesManager: ModesManager2 } = require("./services/ModesManager");
        const targetMode = ModesManager2.getInstance().getModes().find((m) => m.id === id);
        if (targetMode && targetMode.templateType !== "general" && !isProOrTrialActive()) {
          return { success: false, error: "pro_required" };
        }
      }
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      mgr.setActiveMode(id);
      const activeMode = id ? mgr.getModes().find((m) => m.id === id) : null;
      console.log(`[IPC] modes:set-active \u2192 id: ${id}, name: "${activeMode?.name ?? "(none)"}", template: ${activeMode?.templateType ?? "N/A"}`);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:set-active error:", e);
      return { success: false, error: e.message };
    }
  });
  safeHandle("modes:get-reference-files", async (_, modeId) => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      return ModesManager.getInstance().getReferenceFiles(modeId);
    } catch (e) {
      console.error("[IPC] modes:get-reference-files error:", e);
      return [];
    }
  });
  safeHandle("modes:upload-reference-file", async (_, modeId) => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !isGeneralModeId(mgr, modeId)) return { success: false, error: "pro_required" };
      const result = await showOpenDialogNormalized({
        properties: ["openFile"],
        filters: [
          { name: "Text & Documents", extensions: ["txt", "md", "pdf", "docx"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });
      if (result.canceled || !result.filePaths.length) {
        return { success: false, cancelled: true };
      }
      const filePath = result.filePaths[0];
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      let content = "";
      if (ext === ".md") {
        content = fs.readFileSync(filePath, "utf8");
      } else {
        const { extractDocumentText } = require("../premium/electron/knowledge/DocumentReader");
        content = await extractDocumentText(filePath);
      }
      if (!content.trim()) {
        return { success: false, error: "No readable text found in the selected file." };
      }
      const file = mgr.addReferenceFile({ modeId, fileName, content, filePath });
      broadcastModesState();
      return { success: true, file, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:upload-reference-file error:", e);
      return { success: false, error: e.message };
    }
  });
  safeHandle("modes:delete-reference-file", async (_, id) => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !ownsGeneralReferenceFile(mgr, id)) return { success: false, error: "pro_required" };
      mgr.deleteReferenceFile(id);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:delete-reference-file error:", e);
      return { success: false, error: e.message };
    }
  });
  safeHandle("modes:get-note-sections", async (_, modeId) => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      return ModesManager.getInstance().getNoteSections(modeId);
    } catch (e) {
      console.error("[IPC] modes:get-note-sections error:", e);
      return [];
    }
  });
  safeHandle("modes:add-note-section", async (_, modeId, title, description) => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !isGeneralModeId(mgr, modeId)) return { success: false, error: "pro_required" };
      const section = mgr.addNoteSection({ modeId, title, description });
      broadcastModesState();
      return { success: true, section, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:add-note-section error:", e);
      return { success: false, error: e.message };
    }
  });
  safeHandle("modes:update-note-section", async (_, id, updates) => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !ownsGeneralSection(mgr, id)) return { success: false, error: "pro_required" };
      mgr.updateNoteSection(id, updates);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:update-note-section error:", e);
      return { success: false, error: e.message };
    }
  });
  safeHandle("modes:delete-note-section", async (_, id) => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !ownsGeneralSection(mgr, id)) return { success: false, error: "pro_required" };
      mgr.deleteNoteSection(id);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:delete-note-section error:", e);
      return { success: false, error: e.message };
    }
  });
  safeHandle("modes:remove-all-note-sections", async (_, modeId) => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !isGeneralModeId(mgr, modeId)) return { success: false, error: "pro_required" };
      mgr.removeAllNoteSections(modeId);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:remove-all-note-sections error:", e);
      return { success: false, error: e.message };
    }
  });
  safeHandle("modes:reset-note-sections", async (_, modeId) => {
    try {
      const { ModesManager } = require("./services/ModesManager");
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !isGeneralModeId(mgr, modeId)) return { success: false, error: "pro_required" };
      mgr.resetNoteSections(modeId);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e) {
      console.error("[IPC] modes:reset-note-sections error:", e);
      return { success: false, error: e.message };
    }
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  initializeIpcHandlers
});
//# sourceMappingURL=ipcHandlers.js.map
