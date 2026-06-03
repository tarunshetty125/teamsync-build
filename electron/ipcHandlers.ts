// ipcHandlers.ts

import { app, ipcMain, shell, dialog, desktopCapturer, systemPreferences, BrowserWindow, screen, type FileFilter, type OpenDialogOptions, type OpenDialogReturnValue } from "electron"
import { AppState } from "./main"
import { GEMINI_FLASH_MODEL } from "./IntelligenceManager"
import { DatabaseManager } from "./db/DatabaseManager"; // Import Database Manager
import { BenchmarkManager } from "./intelligence/BenchmarkManager";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { AudioDevices } from "./audio/AudioDevices";
import { PermissionManager } from "./services/PermissionManager";
import { EntitlementVerifier, type EntitlementStatus } from "./licensing/EntitlementVerifier";
import { TEAMSYNC_USAGE_URL } from "../src/lib/config/apiConfig";
import type { PermissionKind } from "../src/lib/permissions/types";
import {
  PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC,
  applyProviderAnalyticsSessionSnapshotQuarantine,
  validateProviderAnalyticsSessionSnapshot,
  type ProviderAnalyticsSessionSnapshot,
  type ProviderAnalyticsSessionSnapshotSetResult,
} from "../src/lib/providers/providerAnalyticsSessionSnapshot";
import {
  SESSION_EXPORT_DELIVERY_IPC,
  SESSION_EXPORT_PDF_RUNTIME_BUDGETS,
  buildSessionExportIpcBoundaryDiagnostic,
  buildSessionExportDefaultFileName,
  getSessionExportFileExtension,
  sanitizeSessionExportDeliveryError,
  validateSessionExportPdfBuffer,
  validateSessionExportPdfSaveRequest,
  validateSessionExportSaveRequest,
  type SessionExportDeliveryFormat,
  type SessionExportPdfSaveRequest,
  type SessionExportPdfSaveResult,
  type SessionExportSaveRequest,
  type SessionExportSaveResult,
} from "../src/lib/export/sessionExportDelivery";


import { RECOGNITION_LANGUAGES, AI_RESPONSE_LANGUAGES } from "./config/languages"

export function initializeIpcHandlers(appState: AppState): void {
  const safeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };
  const isDevelopmentOnlyIpcAllowed = () => !app.isPackaged || process.env.NODE_ENV === 'development';
  const safeDevelopmentHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => {
    safeHandle(channel, (event, ...args) => {
      if (!isDevelopmentOnlyIpcAllowed()) {
        console.warn(`[IPC] Blocked development-only IPC in packaged production: ${channel}`);
        return { success: false, error: 'unavailable_in_production' };
      }
      return listener(event, ...args);
    });
  };
  let providerAnalyticsSessionSnapshot: ProviderAnalyticsSessionSnapshot | null = null;
  const broadcastProviderAnalyticsSessionSnapshot = (snapshot: ProviderAnalyticsSessionSnapshot | null): void => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.changed, snapshot);
      }
    });
  };
  const permissionManager = PermissionManager.getInstance();
  const entitlementVerifier = EntitlementVerifier.getInstance();
  const toPlanState = (status: EntitlementStatus = entitlementVerifier.getStatus()) => ({
    plan: status.isPremium ? status.plan : 'free',
    isActive: status.isPremium,
    provider: status.provider,
    isPremium: status.isPremium,
    status: status.status,
    trial: status.trial,
    expiresAt: status.expiresAt,
    graceUntil: status.graceUntil,
    lastSuccessfulSyncAt: status.lastSuccessfulSyncAt,
    entitlementVersion: status.entitlement?.entitlementVersion,
    features: status.features,
  });
  const validateLicenseSender = (event: any): boolean => {
    const senderId = event?.sender?.id;
    const allowedWindows = [
      appState.getWindowHelper?.().getLauncherWindow?.(),
      appState.settingsWindowHelper?.getSettingsWindow?.(),
    ].filter(Boolean);
    return allowedWindows.some((win: BrowserWindow) => !win.isDestroyed() && win.webContents.id === senderId);
  };
  const rejectUntrustedLicenseSender = (event: any) => {
    if (!validateLicenseSender(event)) {
      console.warn('[IPC] Blocked licensing IPC from untrusted sender');
      return { success: false, error: 'unauthorized_sender' };
    }
    return null;
  };
  const broadcastLicenseState = () => {
    const status = entitlementVerifier.getStatus();
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) win.webContents.send('license-status-changed', toPlanState(status));
    });
  };

  const showOpenDialogNormalized = async (options: OpenDialogOptions): Promise<OpenDialogReturnValue> => {
    const result = await dialog.showOpenDialog(options as any);
    if (Array.isArray(result)) {
      return {
        canceled: result.length === 0,
        filePaths: result,
        bookmarks: [],
      };
    }
    return result;
  };

  const buildSessionExportSaveFilters = (format: SessionExportDeliveryFormat): FileFilter[] => {
    if (format === 'pdf') {
      return [
        { name: 'PDF Report', extensions: ['pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ];
    }

    if (format === 'html') {
      return [
        { name: 'HTML Report', extensions: ['html'] },
        { name: 'All Files', extensions: ['*'] },
      ];
    }

    return [
      { name: 'Markdown Report', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] },
    ];
  };

  const renderSessionExportPdfFromHtml = async (html: string): Promise<Buffer> => {
    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const htmlDataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      await pdfWindow.loadURL(htmlDataUrl);
      const renderPromise = pdfWindow.webContents.printToPDF({
        displayHeaderFooter: false,
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: 'Letter',
        generateTaggedPDF: true,
        generateDocumentOutline: true,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`PDF render timed out after ${SESSION_EXPORT_PDF_RUNTIME_BUDGETS.renderTimeoutMs}ms.`));
        }, SESSION_EXPORT_PDF_RUNTIME_BUDGETS.renderTimeoutMs);
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

  /**
   * Returns true if the user has an active premium license OR an unexpired free trial.
   * Used to gate profile intelligence features (resume upload, JD upload, company research, etc.).
   */
  const isProOrTrialActive = (): boolean => entitlementVerifier.hasPremiumAccess();
  const hasActiveProPlan = (): boolean => entitlementVerifier.hasPremiumAccess();

  const broadcastNegotiationStateChanged = (): void => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return;
      const tracker = orchestrator.getNegotiationTracker();
      const payload = {
        enabled: orchestrator.isNegotiationContextEnabled?.() ?? tracker.isActive(),
        isActive: tracker.isActive(),
        state: tracker.getState(),
      };
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('negotiation_state_changed', payload);
        }
      });
    } catch (error) {
      console.warn('[IPC] Failed to broadcast negotiation state change:', error);
    }
  };

  // Clears the active mode when the pro license is lost so non-general mode prompts
  // and reference files stop being injected into LLM calls.
  const clearActiveModeOnLicenseLoss = (): void => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const manager = ModesManager.getInstance();
      const fallbackGeneralMode = manager.getModes().find((mode: any) => mode.templateType === 'general');
      manager.setSelectedMode(fallbackGeneralMode?.id ?? null);
      manager.setActiveMode(fallbackGeneralMode?.id ?? null);
      broadcastModesState();
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('modes-active-cleared');
      });
      console.log('[IPC] Active mode cleared due to license loss');
    } catch (e) { /* non-fatal */ }
  };

  const broadcastModesState = (): void => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const manager = ModesManager.getInstance();
      const state = manager.getState();
      const activeMode = manager.getActiveMode();

      BrowserWindow.getAllWindows().forEach(win => {
        if (win.isDestroyed()) return;
        win.webContents.send('modes-state-changed', state);
        win.webContents.send('mode-changed', {
          id: activeMode?.id ?? null,
          name: activeMode?.name ?? null,
          templateId: activeMode?.templateType ?? null,
        });
      });
    } catch (error) {
      console.warn('[IPC] Failed to broadcast modes state:', error);
    }
  };

  const { CalendarIntelligence } = require('./calendar/CalendarIntelligence');
  const calendarIntelligence = CalendarIntelligence.getInstance();

  const broadcastCalendarRecommendation = (recommendation = calendarIntelligence.getRecommendation()): void => {
    try {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('calendar-intelligence-changed', recommendation);
        }
      });
    } catch (error) {
      console.warn('[IPC] Failed to broadcast calendar recommendation:', error);
    }
  };

  calendarIntelligence.on('recommendation-changed', (recommendation: any) => {
    broadcastCalendarRecommendation(recommendation);
  });

  // --- NEW Test Helper ---
  safeDevelopmentHandle("test-release-fetch", async () => {
    try {
      console.log("[IPC] Manual Test Fetch triggered (forcing refresh)...");
      const { ReleaseNotesManager } = require('./update/ReleaseNotesManager');
      const notes = await ReleaseNotesManager.getInstance().fetchReleaseNotes('latest', true);

      if (notes) {
        console.log("[IPC] Notes fetched for:", notes.version);
        const info = {
          version: notes.version || 'latest',
          files: [] as any[],
          path: '',
          sha512: '',
          releaseName: notes.summary,
          releaseNotes: notes.fullBody,
          parsedNotes: notes
        };
        // Send to renderer
        appState.getMainWindow()?.webContents.send("update-available", info);
        return { success: true };
      }
      return { success: false, error: "No notes returned" };
    } catch (err: any) {
      console.error("[IPC] test-release-fetch failed:", err);
      return { success: false, error: err.message };
    }
  });

  safeHandle("license:activate", async (event, payload: string | { licenseKey?: string; trial?: boolean }) => {
    const rejected = rejectUntrustedLicenseSender(event);
    if (rejected) return rejected;
    const result = typeof payload === 'object' && payload?.trial
      ? await entitlementVerifier.startTrial()
      : await entitlementVerifier.activateLicense(typeof payload === 'string' ? payload : payload?.licenseKey || '');
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
        features: result.entitlement.features,
      } : undefined,
    };
  });

  safeHandle("license:sync", async (event) => {
    const rejected = rejectUntrustedLicenseSender(event);
    if (rejected) return rejected;
    const status = await entitlementVerifier.sync('manual');
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
        console.log('[IPC] Knowledge mode auto-disabled due to license deactivation');
      }
    } catch (e) { /* ignore */ }
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
    return RECOGNITION_LANGUAGES;
  });

  safeHandle("get-ai-response-languages", async () => {
    return AI_RESPONSE_LANGUAGES;
  });

  safeHandle("set-ai-response-language", async (_, language: string) => {
    // Validate: must be a non-empty string
    if (!language || typeof language !== 'string' || !language.trim()) {
      console.warn('[IPC] set-ai-response-language: invalid or empty language received, ignoring.');
      return { success: false, error: 'Invalid language value' };
    }
    const sanitizedLanguage = language.trim();
    const { CredentialsManager } = require('./services/CredentialsManager');
    // Persist to disk
    CredentialsManager.getInstance().setAiResponseLanguage(sanitizedLanguage);
    // Update live in-memory LLMHelper (same instance used by IntelligenceEngine)
    const llmHelper = appState.processingHelper?.getLLMHelper?.();
    if (llmHelper) {
      llmHelper.setAiResponseLanguage(sanitizedLanguage);
      console.log(`[IPC] AI response language updated to: ${sanitizedLanguage}`);
    } else {
      console.warn('[IPC] set-ai-response-language: processingHelper or LLMHelper not ready, language saved to disk only.');
    }
    return { success: true };
  });

  safeHandle("get-stt-language", async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getSttLanguage();
  });

  safeHandle("get-ai-response-language", async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getAiResponseLanguage();
  });
  safeHandle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return

      const senderWebContents = event.sender
      const settingsWin = appState.settingsWindowHelper.getSettingsWindow()
      const overlayWin = appState.getWindowHelper().getOverlayWindow()
      const launcherWin = appState.getWindowHelper().getLauncherWindow()

      if (settingsWin && !settingsWin.isDestroyed() && settingsWin.webContents.id === senderWebContents.id) {
        appState.settingsWindowHelper.setWindowDimensions(settingsWin, width, height)
      } else if (
        overlayWin && !overlayWin.isDestroyed() && overlayWin.webContents.id === senderWebContents.id
      ) {
        // TeamSyncInterface logic - Resize ONLY the overlay window using dedicated method
        appState.getWindowHelper().setOverlayDimensions(width, height)
      } else if (
        launcherWin && !launcherWin.isDestroyed() && launcherWin.webContents.id === senderWebContents.id
      ) {
        // EC-05 fix: launcher window resize events were previously silently ignored.
        // Log them so that if the launcher ever sends this IPC it's visible in logs.
        console.log(`[IPC] update-content-dimensions: launcher window resize request ${width}x${height} (ignored — launcher has fixed dimensions)`);
      }
    }
  )

  safeHandle("set-window-mode", async (event, mode: 'launcher' | 'overlay', inactive?: boolean) => {
    appState.getWindowHelper().setWindowMode(mode, inactive);
    return { success: true };
  })

  safeHandle("set-overlay-v2-layout", async (_, enabled: boolean) => {
    appState.getWindowHelper().setOverlayUsesV2Layout(!!enabled);
    return { success: true };
  })

  safeHandle(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.set, async (_, snapshot: ProviderAnalyticsSessionSnapshot | null): Promise<ProviderAnalyticsSessionSnapshotSetResult> => {
    const validation = validateProviderAnalyticsSessionSnapshot(snapshot);
    const quarantine = applyProviderAnalyticsSessionSnapshotQuarantine({
      currentSnapshot: providerAnalyticsSessionSnapshot,
      incomingSnapshot: snapshot,
      validation,
    });
    if (validation.status !== 'valid') {
      console.warn('[ProviderAnalytics] session snapshot guardrail', {
        status: validation.status,
        quarantined: quarantine.setResult.quarantined,
        responseCount: validation.responseCount,
        ownershipEntryCount: validation.ownershipEntryCount,
        serializedBytes: validation.serializedBytes,
        issues: validation.issues,
      });
    }
    providerAnalyticsSessionSnapshot = quarantine.currentSnapshot;
    if (quarantine.shouldBroadcast) {
      broadcastProviderAnalyticsSessionSnapshot(quarantine.broadcastSnapshot);
    }
    return quarantine.setResult;
  })

  safeHandle(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.get, async (): Promise<ProviderAnalyticsSessionSnapshot | null> => {
    return providerAnalyticsSessionSnapshot;
  })

  safeHandle(SESSION_EXPORT_DELIVERY_IPC.save, async (event, request: unknown): Promise<SessionExportSaveResult> => {
    const validation = validateSessionExportSaveRequest(request);
    if (!validation.valid) {
      const diagnostic = buildSessionExportIpcBoundaryDiagnostic({
        channel: SESSION_EXPORT_DELIVERY_IPC.save,
        operation: 'validate_request',
        code: 'export_save_request_invalid',
        valid: false,
        error: validation.error,
        message: validation.error ?? 'Invalid export save request.',
      });
      console.warn('[SessionExport] save request rejected:', diagnostic.error);
      return { success: false, error: diagnostic.error ?? 'Invalid export save request.', diagnostic };
    }

    const saveRequest = request as SessionExportSaveRequest;
    const extension = getSessionExportFileExtension(saveRequest.format);
    const fallbackName = buildSessionExportDefaultFileName(saveRequest.format, saveRequest.generatedAt);
    const requestedName = saveRequest.suggestedFileName?.trim()
      ? saveRequest.suggestedFileName.trim().split(/[\\/]/).pop()
      : undefined;
    const defaultPath = requestedName || fallbackName;
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: `Save ${saveRequest.format === 'html' ? 'HTML' : 'Markdown'} Session Report`,
      defaultPath,
      filters: buildSessionExportSaveFilters(saveRequest.format),
      properties: ['createDirectory'] as Array<'createDirectory'>,
    };
    try {
      const rawResult = parentWindow && !parentWindow.isDestroyed()
        ? await dialog.showSaveDialog(parentWindow, options)
        : await dialog.showSaveDialog(options);
      const result = typeof rawResult === 'string'
        ? { canceled: rawResult.length === 0, filePath: rawResult }
        : rawResult;

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      const selectedPath = path.extname(result.filePath)
        ? result.filePath
        : `${result.filePath}.${extension}`;
      await fs.promises.writeFile(selectedPath, saveRequest.content, 'utf8');

      return {
        success: true,
        filePath: selectedPath,
      };
    } catch (error) {
      const message = sanitizeSessionExportDeliveryError(error, 'Unable to save report.');
      const diagnostic = buildSessionExportIpcBoundaryDiagnostic({
        channel: SESSION_EXPORT_DELIVERY_IPC.save,
        operation: 'write_file',
        code: 'export_save_failed',
        success: false,
        error: message,
        message,
      });
      console.warn('[SessionExport] save failed:', message);
      return { success: false, error: message, diagnostic };
    }
  })

  safeHandle(SESSION_EXPORT_DELIVERY_IPC.savePdf, async (event, request: unknown): Promise<SessionExportPdfSaveResult> => {
    const validation = validateSessionExportPdfSaveRequest(request);
    if (!validation.valid) {
      const diagnostic = buildSessionExportIpcBoundaryDiagnostic({
        channel: SESSION_EXPORT_DELIVERY_IPC.savePdf,
        operation: 'validate_request',
        code: 'export_pdf_save_request_invalid',
        valid: false,
        error: validation.error,
        message: validation.error ?? 'Invalid PDF export save request.',
      });
      console.warn('[SessionExport] PDF save request rejected:', diagnostic.error);
      return { success: false, error: diagnostic.error ?? 'Invalid PDF export save request.', diagnostic };
    }

    const pdfRequest = request as SessionExportPdfSaveRequest;
    const extension = getSessionExportFileExtension('pdf');
    const fallbackName = buildSessionExportDefaultFileName('pdf', pdfRequest.generatedAt);
    const requestedName = pdfRequest.suggestedFileName?.trim()
      ? pdfRequest.suggestedFileName.trim().split(/[\\/]/).pop()
      : undefined;
    const defaultPath = requestedName || fallbackName;
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Save PDF Session Report',
      defaultPath,
      filters: buildSessionExportSaveFilters('pdf'),
      properties: ['createDirectory'] as Array<'createDirectory'>,
    };
    const rawResult = parentWindow && !parentWindow.isDestroyed()
      ? await dialog.showSaveDialog(parentWindow, options)
      : await dialog.showSaveDialog(options);
    const result = typeof rawResult === 'string'
      ? { canceled: rawResult.length === 0, filePath: rawResult }
      : rawResult;

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    try {
      const selectedPath = path.extname(result.filePath)
        ? result.filePath
        : `${result.filePath}.${extension}`;
      const pdfBuffer = await renderSessionExportPdfFromHtml(pdfRequest.html);
      const pdfValidation = validateSessionExportPdfBuffer(pdfBuffer);
      if (!pdfValidation.valid) {
        throw new Error(pdfValidation.error ?? 'Generated PDF failed validation.');
      }
      if (pdfValidation.warning) {
        console.warn('[SessionExport] PDF output warning:', {
          warning: pdfValidation.warning,
          byteLength: pdfValidation.byteLength,
          budget: SESSION_EXPORT_PDF_RUNTIME_BUDGETS.warningPdfBytes,
        });
      }
      await fs.promises.writeFile(selectedPath, pdfBuffer);

      return {
        success: true,
        filePath: selectedPath,
      };
    } catch (error) {
      const message = sanitizeSessionExportDeliveryError(error, 'Unable to save PDF report.');
      const diagnostic = buildSessionExportIpcBoundaryDiagnostic({
        channel: SESSION_EXPORT_DELIVERY_IPC.savePdf,
        operation: 'save_pdf_report',
        code: 'export_pdf_save_failed',
        success: false,
        error: message,
        message,
      });
      console.warn('[SessionExport] PDF save failed:', message);
      return { success: false, error: message, diagnostic };
    }
  })


  safeHandle("delete-screenshot", async (event, filePath: string) => {
    // Guard: only allow deletion of files within the app's own userData directory
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] delete-screenshot: path outside userData rejected:', filePath);
      return { success: false, error: 'Path not allowed' };
    }
    return appState.deleteScreenshot(resolved);
  })

  safeHandle("take-screenshot", async (_event, options?: { requireVision?: boolean }) => {
    try {
      if (options?.requireVision) {
        appState.assertVisionCaptureSupported();
      }
      const screenshotPath = await appState.takeScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      // console.error("Error taking screenshot:", error)
      throw error
    }
  })

  safeHandle("take-selective-screenshot", async (_event, options?: { requireVision?: boolean }) => {
    try {
      if (options?.requireVision) {
        appState.assertVisionCaptureSupported();
      }
      const screenshotPath = await appState.takeSelectiveScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      // EC-04 fix: cast unknown error to Error before accessing .message
      if ((error as Error).message === "Selection cancelled") {
        return { cancelled: true }
      }
      throw error
    }
  })

  safeHandle("get-screenshots", async () => {
    // console.log({ view: appState.getView() })
    try {
      let previews = []
      if (appState.getView() === "queue") {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      }
      // previews.forEach((preview: any) => console.log(preview.path))
      return previews
    } catch (error) {
      // console.error("Error getting screenshots:", error)
      throw error
    }
  })

  safeHandle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  safeHandle("show-window", async (event, inactive?: boolean) => {
    // Default show main window (Launcher usually)
    appState.showMainWindow(inactive)
  })

  safeHandle("hide-window", async () => {
    appState.hideMainWindow()
  })

  safeHandle("show-overlay", async () => {
    appState.getWindowHelper().showOverlay();
  })

  safeHandle("hide-overlay", async () => {
    appState.getWindowHelper().hideOverlay();
  })

  safeHandle("get-meeting-active", async () => {
    return appState.getIsMeetingActive();
  })

  safeHandle("reset-queues", async () => {
    try {
      appState.clearQueues()
      // console.log("Screenshot queues have been cleared.")
      return { success: true }
    } catch (error: any) {
      // console.error("Error resetting queues:", error)
      return { success: false, error: error.message }
    }
  })

  // Donation IPC Handlers
  safeHandle("get-donation-status", async () => {
    const { DonationManager } = require('./DonationManager');
    const manager = DonationManager.getInstance();
    return {
      shouldShow: manager.shouldShowToaster(),
      hasDonated: manager.getDonationState().hasDonated,
      lifetimeShows: manager.getDonationState().lifetimeShows
    };
  });

  safeHandle("mark-donation-toast-shown", async () => {
    const { DonationManager } = require('./DonationManager');
    DonationManager.getInstance().markAsShown();
    return { success: true };
  });

  safeHandle("set-donation-complete", async () => {
    const { DonationManager } = require('./DonationManager');
    DonationManager.getInstance().setHasDonated(true);
    return { success: true };
  });


  // Generate suggestion from transcript - TeamSync-style text-only reasoning
  safeHandle("generate-suggestion", async (event, context: string, lastQuestion: string) => {
    try {
      const suggestion = await appState.getIntelligenceManager().handleAction('what_to_answer', {
        message: lastQuestion,
        additionalContext: context,
      });
      return { suggestion }
    } catch (error: any) {
      // console.error("Error generating suggestion:", error)
      throw error
    }
  })

  safeHandle("finalize-mic-stt", async () => {
    await appState.finalizeMicSTT();
  });

  safeHandle("gemini-chat", async (event, message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean }) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().chatWithGemini(message, imagePaths, context, options?.skipSystemPrompt);

      console.log(`[IPC] gemini-chat responseLength=${result?.length ?? 0} redacted=true`);

      // Don't process empty responses
      if (!result || result.trim().length === 0) {
        console.warn("[IPC] Empty response from LLM, not updating IntelligenceManager");
        return "I apologize, but I couldn't generate a response. Please try again.";
      }

      // Sync with IntelligenceManager so Follow-Up/Recap work
      const intelligenceManager = appState.getIntelligenceManager();

      // 1. Add user question to context (as 'user')
      // CRITICAL: Skip refinement check to prevent auto-triggering follow-up logic
      // The user's manual question is a NEW input, not a refinement of previous answer.
      intelligenceManager.addTranscript({
        text: message,
        speaker: 'user',
        timestamp: Date.now(),
        final: true,
        _sessionId: intelligenceManager.getSessionId(),
      }, true);

      // 2. Add assistant response and set as last message
      console.log(`[IPC] Updating IntelligenceManager with assistant message...`);
      intelligenceManager.addAssistantMessage(result);
      console.log(`[IPC] Updated IntelligenceManager.Last message length=${intelligenceManager.getLastAssistantMessage()?.length ?? 0} redacted=true`);

      // Log Usage
      intelligenceManager.logUsage('chat', message, result);

      return result;
    } catch (error: any) {
      // console.error("Error in gemini-chat handler:", error);
      throw error;
    }
  });

  // Streaming IPC Handler
  // SECURITY FIX (P0-1): Monotonic stream ID prevents interleaved tokens from concurrent stream requests.
  // Each new invocation increments the ID; any in-flight iteration bails as soon as it detects
  // that a newer stream has taken over.
  const activeChatStreams = new Map<number, { streamId: number; requestId?: string; stream: AsyncGenerator<string, void, unknown> | null }>();

  const cancelActiveChatStream = async (senderId?: number): Promise<void> => {
    const targets = senderId !== undefined
      ? [[senderId, activeChatStreams.get(senderId)] as const]
      : Array.from(activeChatStreams.entries());

    for (const [targetSenderId, active] of targets) {
      if (!active) continue;
      activeChatStreams.set(targetSenderId, {
        streamId: active.streamId + 1,
        requestId: active.requestId,
        stream: null,
      });
      if (active.requestId) {
        appState.getIntelligenceManager().getEngine()?.cancelRequest(active.requestId);
      }
      if (!active.stream?.return) continue;
      try {
        await active.stream.return(undefined);
      } catch (error) {
        console.warn('[IPC] Failed to cancel active gemini-chat-stream cleanly:', error);
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

  // Targeted per-request cancellation — does NOT reset the entire engine
  safeHandle("cancel-intelligence-by-request", async (_, requestId: string) => {
    if (!requestId) return { success: false, error: 'Missing requestId' };
    appState.getIntelligenceManager().getEngine()?.cancelRequest(requestId);
    return { success: true };
  });

  safeHandle("gemini-chat-stream", async (
    event,
    message: string,
    imagePaths?: string[],
    context?: string,
    options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean, requestId?: string }
  ) => {
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
      let ragContext: { content: string; scope: 'live'; title?: string } | null = null;

      // Context Injection for "Answer" button (short rolling window)
      // TOKEN-OPT: Only inject auto-context if it contains meaningful conversation
      // (multiple speaker turns, >200 chars). This preserves the lightweight first-request
      // path in streamChat when the user sends a simple standalone question.
      if (!additionalContext) {
        try {
          const autoContext = intelligenceManager.getFormattedContext(60);
          if (autoContext && autoContext.trim().length > 200) {
            // Block-based: include or drop entirely (no slicing)
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

      // Block-based overflow: drop context entirely if over limit (no string slicing)
      if (additionalContext && additionalContext.length > 2000) {
        console.warn(`[IPC] Context too large (${additionalContext.length} chars), dropped entirely`);
        additionalContext = undefined;
      }

      try {
        const ragManager = appState.getRAGManager();
        if (!imagePaths?.length && ragManager?.isReady() && ragManager.isLiveIndexingActive('live-meeting-current')) {
          try {
            const liveContext = await ragManager.retrieveMeetingContext('live-meeting-current', message);
            ragContext = {
              content: liveContext.formattedContext,
              scope: 'live',
              title: 'RAG MEMORY (LIVE)',
            };
          } catch (ragError: any) {
            const ragMessage = ragError?.message || '';
            if (!ragMessage.includes('NO_RELEVANT_CONTEXT') && !ragMessage.includes('NO_MEETING_EMBEDDINGS')) {
              console.warn('[IPC] Live RAG prefetch failed for gemini-chat-stream:', ragError);
            }
          }
        }

        const onToken = (payload: any) => {
          if (payload?.requestId !== requestId || payload?.intent !== 'manual_chat') return;
          const liveState = activeChatStreams.get(senderId);
          if (!liveState || liveState.streamId !== myStreamId) {
            return;
          }
          event.sender.send("gemini-stream-token", { token: payload.token, requestId });
        };
        const onResult = (payload: any) => {
          if (payload?.requestId !== requestId || payload?.intent !== 'manual_chat') return;
          if (activeChatStreams.get(senderId)?.streamId === myStreamId) {
            event.sender.send("gemini-stream-done", {
              requestId,
              content: payload.content,
              debugMetadata: payload.debugMetadata,
            });
          }
        };
        const onError = (error: any, mode: string, failedRequestId?: string | null) => {
          if (failedRequestId !== requestId) return;
          if (activeChatStreams.get(senderId)?.streamId === myStreamId) {
            event.sender.send("gemini-stream-error", { error: error?.message || "Unknown streaming error", requestId });
          }
        };

        intelligenceManager.on('action_token', onToken);
        intelligenceManager.on('action_result', onResult);
        intelligenceManager.on('error', onError);

        try {
          await intelligenceManager.handleAction('manual_chat', {
            message,
            imagePaths,
            requestId,
            additionalContext: additionalContext,
            rag: ragContext,
            profilePreference: options?.ignoreKnowledgeMode ? 'force_off' : 'default',
          });
        } finally {
          intelligenceManager.off('action_token', onToken);
          intelligenceManager.off('action_result', onResult);
          intelligenceManager.off('error', onError);
        }
      } finally {
        if (activeChatStreams.get(senderId)?.streamId === myStreamId) {
          activeChatStreams.set(senderId, { streamId: myStreamId, requestId, stream: null });
        }
      }

      return null; // Return null as data is sent via events

    } catch (error: any) {
      console.error("[IPC] Error in gemini-chat-stream setup:", error);
      throw error;
    }
  });



  safeHandle("quit-app", () => {
    app.quit()
  })

  safeHandle("quit-and-install-update", async () => {
    try {
      console.log('[IPC] Quit and install update requested')
      await appState.quitAndInstallUpdate()
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] quit-and-install-update failed:', err)
      return { success: false, error: err.message }
    }
  })

  safeHandle("delete-meeting", async (_, id: string) => {
    return DatabaseManager.getInstance().deleteMeeting(id);
  });

  safeHandle("check-for-updates", async () => {
    try {
      console.log('[IPC] Manual update check requested')
      await appState.checkForUpdates()
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] check-for-updates failed:', err)
      return { success: false, error: err.message }
    }
  })

  safeHandle("download-update", async () => {
    try {
      console.log('[IPC] Download update requested')
      appState.downloadUpdate()
      return { success: true }
    } catch (err: any) {
      console.error('[IPC] download-update failed:', err)
      return { success: false, error: err.message }
    }
  })

  safeHandle("get-updater-cache-info", async () => {
    try {
      return await appState.getUpdaterCacheInfo()
    } catch (err: any) {
      console.error('[IPC] get-updater-cache-info failed:', err)
      return {
        cacheDir: '',
        pendingDir: '',
        downloadedFiles: [],
        totalSize: 0,
        currentVersion: app.getVersion(),
        latestVersion: null,
        error: err?.message || 'Unable to read updater cache info',
      }
    }
  })

  safeHandle("open-updater-cache-folder", async () => {
    try {
      const cacheInfo = await appState.getUpdaterCacheInfo()
      const errorMessage = await shell.openPath(cacheInfo.cacheDir)
      if (errorMessage) {
        return { success: false, error: errorMessage }
      }
      return { success: true, path: cacheInfo.cacheDir }
    } catch (err: any) {
      console.error('[IPC] open-updater-cache-folder failed:', err)
      return { success: false, error: err?.message || 'Unable to open updater cache folder' }
    }
  })

  // Window movement handlers
  safeHandle("move-window-left", async () => {
    appState.moveWindowLeft()
  })

  safeHandle("move-window-right", async () => {
    appState.moveWindowRight()
  })

  safeHandle("move-window-up", async () => {
    appState.moveWindowUp()
  })

  safeHandle("move-window-down", async () => {
    appState.moveWindowDown()
  })

  safeHandle("center-and-show-window", async () => {
    appState.centerAndShowWindow()
  })

  // Window Controls
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

  // Settings Window
  safeHandle("toggle-settings-window", (event, { x, y } = {}) => {
    appState.settingsWindowHelper.toggleWindow(x, y)
  })

  // Open the launcher's SettingsOverlay on a specific tab (callable from any window)
  safeHandle("settings:open-tab", (_, tab: string) => {
    const launcherWin = appState.getWindowHelper().getLauncherWindow();
    if (launcherWin && !launcherWin.isDestroyed()) {
      launcherWin.webContents.send('settings:open-tab', tab);
      launcherWin.show();
      launcherWin.focus();
    }
  })

  safeHandle("close-settings-window", () => {
    appState.settingsWindowHelper.closeWindow()
  })



  safeHandle("set-undetectable", async (_, state: boolean) => {
    appState.setUndetectable(state)
    return { success: true }
  })

  safeHandle("set-disguise", async (_, mode: 'terminal' | 'settings' | 'activity' | 'none') => {
    appState.setDisguise(mode)
    return { success: true }
  })

  safeHandle("get-undetectable", async () => {
    return appState.getUndetectable()
  })

  // Adapted from public PR #113 — verify premium interaction
  safeHandle("set-overlay-mouse-passthrough", async (_, enabled: boolean) => {
    appState.setOverlayMousePassthrough(enabled)
    return { success: true }
  })

  safeHandle("toggle-overlay-mouse-passthrough", async () => {
    const enabled = appState.toggleOverlayMousePassthrough()
    return { success: true, enabled }
  })

  safeHandle("get-overlay-mouse-passthrough", async () => {
    return appState.getOverlayMousePassthrough()
  })

  safeHandle("get-disguise", async () => {
    return appState.getDisguise()
  })

  // ── Advanced Stealth Mode IPC ─────────────────────────────────────────────
  const { StealthManager } = require('./services/StealthManager');

  safeHandle("stealth:engage", async () => {
    try {
      StealthManager.getInstance().engage();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  })

  safeHandle("stealth:disengage", async () => {
    try {
      StealthManager.getInstance().disengage();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  })

  safeHandle("stealth:get-state", async () => {
    try {
      return StealthManager.getInstance().getState();
    } catch (e: any) {
      return { level: 'off', processDisguised: false, windowsProtected: false, dockHidden: false, eventsBlocked: false, watchdogActive: false };
    }
  })

  safeHandle("stealth:get-config", async () => {
    try {
      return StealthManager.getInstance().getConfig();
    } catch (e: any) {
      return null;
    }
  })

  safeHandle("stealth:update-config", async (_, patch: Record<string, any>) => {
    try {
      StealthManager.getInstance().updateConfig(patch);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  })

  safeHandle("stealth:is-engaged", async () => {
    try {
      return StealthManager.getInstance().isEngaged();
    } catch {
      return false;
    }
  })

  safeHandle("set-open-at-login", async (_, openAtLogin: boolean) => {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: false,
      path: app.getPath('exe') // Explicitly point to executable for production reliability
    });
    return { success: true };
  });

  safeHandle("get-open-at-login", async () => {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  });

  safeHandle("get-verbose-logging", async () => {
    return appState.getVerboseLogging();
  });

  safeHandle("set-verbose-logging", async (_, enabled: boolean) => {
    appState.setVerboseLogging(enabled);
    return { success: true };
  });

  safeHandle("get-log-file-path", async () => {
    try {
      return path.join(app.getPath('documents'), 'teamsync_debug.log');
    } catch {
      return null;
    }
  });

  safeHandle("open-log-file", async () => {
    try {
      const logPath = path.join(app.getPath('documents'), 'teamsync_debug.log');
      // Ensure the file exists before opening
      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, '');
      }
      await shell.openPath(logPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Fire-and-forget: renderer forwards its console output to the main-process log file.
  // Only written when verbose logging is enabled.
  ipcMain.on("forward-log-to-file", (_event, level: string, msg: string) => {
    if (!appState.getVerboseLogging()) return;
    const tag = level === 'error' ? '[RENDERER-ERROR]' : level === 'warn' ? '[RENDERER-WARN]' : '[RENDERER]';
    console.log(`${tag} ${msg}`);
  });

  safeHandle("get-arch", async () => {
    return process.arch;
  });

  safeHandle("get-os-version", async () => {
    const platform = process.platform;
    if (platform === 'darwin') {
      const darwinMajor = parseInt(os.release().split('.')[0] || '0', 10);
      // Darwin 25+ = macOS 26+ (calendar-year scheme), Darwin 20-24 = macOS 11-15
      const macosMajor = darwinMajor >= 25
        ? darwinMajor + 1
        : darwinMajor >= 20
          ? darwinMajor - 9
          : null;
      return macosMajor ? `macOS ${macosMajor}` : `macOS ${os.release()}`;
    }
    if (platform === 'win32') {
      const release = os.release();
      // Windows 11 build starts at 22000
      const majorBuild = parseInt(release.split('.')[2] || '0', 10);
      return majorBuild >= 22000 ? `Windows 11` : `Windows 10`;
    }
    return os.type();
  });

  // LLM Model Management Handlers
  safeHandle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
        isOllama: llmHelper.isUsingOllama()
      };
    } catch (error: any) {
      // console.error("Error getting current LLM config:", error);
      throw error;
    }
  });

  safeHandle("get-available-ollama-models", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const models = await llmHelper.getOllamaModels();
      return models;
    } catch (error: any) {
      // console.error("Error getting Ollama models:", error);
      throw error;
    }
  });

  safeHandle("switch-to-ollama", async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToOllama(model, url);
      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Ollama:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("force-restart-ollama", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const success = await llmHelper.forceRestartOllama();
      return { success };
    } catch (error: any) {
      console.error("Error force restarting Ollama:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('restart-ollama', async () => {
    try {
      // First try to kill it if it's running
      await appState.processingHelper.getLLMHelper().forceRestartOllama();
      
      // The forceRestartOllama now calls OllamaManager.getInstance().init() internally
      // so we don't need to do it again here.
      
      return true;
    } catch (error: any) {
      console.error("[IPC restart-ollama] Failed to restart:", error);
      return false;
    }
  });

  safeHandle("ensure-ollama-running", async () => {
    try {
      const { OllamaManager } = require('./services/OllamaManager');
      await OllamaManager.getInstance().init();
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });

  safeHandle("switch-to-gemini", async (_, apiKey?: string, modelId?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToGemini(apiKey, modelId);

      // Persist API key if provided
      if (apiKey) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        CredentialsManager.getInstance().setGeminiApiKey(apiKey);
      }

      return { success: true };
    } catch (error: any) {
      // console.error("Error switching to Gemini:", error);
      return { success: false, error: error.message };
    }
  });

  // Dedicated API key setters (for Settings UI Save buttons)
  safeHandle("set-gemini-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGeminiApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setApiKey(apiKey);

      // CQ-06 fix: cancel any in-flight LLM stream before swapping LLM clients.
      // Use resetEngine() (NOT reset()) so session transcript is preserved mid-meeting.
      // initializeLLMs() now also calls engine.reset() internally for double-safety.
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Gemini API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-groq-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Groq API key:", error);
      return { success: false, error: error.message };
    }
  });

  // ── Groq Provider Vault ───────────────────────────────────────────────────
  // Multi-key management: CRUD + health. All mutations sync the in-memory pool.

  safeHandle("groq-vault:get-keys", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const vault = cm.getGroqKeyVault();
      const llmHelper = appState.processingHelper.getLLMHelper();
      const keyManager = llmHelper.getGroqKeyManager();
      const runtimeStates = keyManager.getKeyStates();

      // Merge vault metadata with runtime health. Never return raw keys.
      const keys = vault.map((entry: any) => {
        const runtime = runtimeStates.find((s: any) => s.apiKey === entry.key);
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
          isAvailable: runtime?.isAvailable ?? entry.enabled,
        };
      });

      return { success: true, keys };
    } catch (error: any) {
      console.error('[IPC] groq-vault:get-keys error:', error);
      return { success: false, error: error.message, keys: [] };
    }
  });

  safeHandle("groq-vault:add-key", async (_, apiKey: string, label?: string) => {
    try {
      const trimmed = (apiKey || '').trim();
      if (!trimmed) return { success: false, error: 'API key is required' };

      // Validate the key against Groq API before adding
      let validationStatus: 'healthy' | 'invalid' = 'healthy';
      let validationError: string | undefined;
      try {
        const Groq = require('groq-sdk').default || require('groq-sdk');
        const testClient = new Groq({ apiKey: trimmed });
        await testClient.models.list();
      } catch (e: any) {
        const status = e?.status ?? e?.statusCode ?? 0;
        if (status === 401 || status === 403) {
          validationStatus = 'invalid';
          validationError = 'Invalid API key — authentication failed';
        } else if (status === 429) {
          // Rate limited but key is valid
          validationStatus = 'healthy';
        } else {
          // Network or transient error — accept the key but warn
          validationStatus = 'healthy';
          validationError = `Key accepted (could not verify: ${e.message?.slice(0, 60)})`;
        }
      }

      if (validationStatus === 'invalid') {
        return { success: false, error: validationError, validationStatus };
      }

      const { CredentialsManager } = require('./services/CredentialsManager');
      const entry = CredentialsManager.getInstance().addGroqVaultKey(trimmed, label);

      // Sync pool
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
          label: entry.label,
        },
        validationStatus,
        validationError,
      };
    } catch (error: any) {
      console.error('[IPC] groq-vault:add-key error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("groq-vault:remove-key", async (_, id: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().removeGroqVaultKey(id);

      // Sync pool
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.reloadGroqVault();

      return { success: true };
    } catch (error: any) {
      console.error('[IPC] groq-vault:remove-key error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("groq-vault:toggle-key", async (_, id: string, enabled: boolean) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().toggleGroqVaultKey(id, enabled);

      // Sync pool
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.reloadGroqVault();

      return { success: true };
    } catch (error: any) {
      console.error('[IPC] groq-vault:toggle-key error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("groq-vault:get-health", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const keyManager = llmHelper.getGroqKeyManager();
      const report = keyManager.getHealthReport();
      return { success: true, ...report };
    } catch (error: any) {
      console.error('[IPC] groq-vault:get-health error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-openai-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenaiApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setOpenaiApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving OpenAI API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-claude-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setClaudeApiKey(apiKey);

      // Also update the LLMHelper immediately
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setClaudeApiKey(apiKey);

      // CQ-06 fix: cancel in-flight stream before re-init (engine only, not session)
      appState.getIntelligenceManager().resetEngine();
      // Re-init IntelligenceManager
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error saving Claude API key:", error);
      return { success: false, error: error.message };
    }
  });

  // ── Usage cache (60-second TTL, keyed by API key) ──────────────────────────
  const _usageCache = new Map<string, { data: any; ts: number }>();
  const USAGE_CACHE_TTL_MS = 60_000;

  safeHandle("set-teamsync-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const prevSttProvider = cm.getSttProvider();
      cm.setTeamSyncApiKey(apiKey);

      // Update LLMHelper immediately (same pattern as other provider keys)
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setTeamSyncKey(apiKey || null);

      // Sync the model into LLMHelper and notify the UI whenever the effective default changed
      const defaultModel = cm.getDefaultModel();
      const providers = [...(cm.getCurlProviders() || []), ...(cm.getCustomProviders() || [])];
      llmHelper.setModel(defaultModel, providers);
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('model-changed', defaultModel);
      });

      // If setTeamSyncApiKey auto-promoted the STT provider to 'teamsync', reconfigure
      // the audio pipeline immediately — without this, the in-memory pipeline still uses
      // the old STT provider (e.g. Google) until the app restarts.
      const newSttProvider = cm.getSttProvider();
      if (newSttProvider !== prevSttProvider) {
        console.log(`[IPC] set-teamsync-api-key: STT provider changed ${prevSttProvider} → ${newSttProvider}, reconfiguring pipeline`);
        await appState.reconfigureSttProvider();
      }

      // TeamSync API keys no longer grant local Pro. Hosted APIs validate keys server-side,
      // while premium UI/features require a signed entitlement from the license service.
      if (apiKey) {
        console.log('[IPC] set-teamsync-api-key: key saved; no local premium entitlement granted.');
      }

      return { success: true };
    } catch (error: any) {
      console.error("Error saving TeamSync API key:", error);
      return { success: false, error: error.message };
    } finally {
      // Always bust the cache when the key changes so the next usage fetch is fresh
      _usageCache?.clear();
    }
  });


  safeHandle("get-teamsync-usage", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const key = CredentialsManager.getInstance().getTeamSyncApiKey();
      if (!key) return { ok: false, error: 'no_key' };

      // Return cached value if it's still fresh
      const cached = _usageCache.get(key);
      if (cached && Date.now() - cached.ts < USAGE_CACHE_TTL_MS) {
        return cached.data;
      }

      const res = await fetch(TEAMSYNC_USAGE_URL, {
        headers: { 'x-teamsync-key': key },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as any;
        return { ok: false, error: body.error || 'request_failed', status: res.status };
      }
      const data = await res.json() as any;
      const result = { ok: true, ...data };

      // Cache the successful response
      _usageCache.set(key, { data: result, ts: Date.now() });
      return result;
    } catch (error: any) {
      return { ok: false, error: error.message || 'network_error' };
    }
  });

  // Allow other handlers to force-invalidate the usage cache (e.g. after key change)
  safeHandle("invalidate-teamsync-usage-cache", () => {
    _usageCache.clear();
    return { ok: true };
  });

  // Wipe only Pro profile data (resume + JD + company dossiers) without clearing
  // credentials. Called automatically when a signed trial entitlement expires so
  // profile intelligence data can't linger in SQLite after the trial window closes.
  safeHandle("profile:wipe-trial-data", async (event) => {
    const rejected = rejectUntrustedLicenseSender(event);
    if (rejected) return rejected;
    try {
      // 1. Disable knowledge mode + wipe orchestrator in-memory caches
      try {
        const orchestrator = appState.getKnowledgeOrchestrator();
        if (orchestrator) {
          orchestrator.setKnowledgeMode(false);
          const { DocType } = require('../premium/electron/knowledge/types');
          orchestrator.deleteDocumentsByType(DocType.RESUME);
          orchestrator.deleteDocumentsByType(DocType.JD);
        }
      } catch { /* ignore — orchestrator may not be initialised */ }

      // 2. Wipe Pro-specific SQLite tables
      //    NOT wiped: meetings, transcripts, audio chunks (user's own recordings)
      try {
        const sqliteDb = DatabaseManager.getInstance().getDb();
        if (sqliteDb) {
          sqliteDb.exec(`
            DELETE FROM company_dossiers;
            DELETE FROM knowledge_documents;
            DELETE FROM resume_nodes;
            DELETE FROM user_profile;
          `);
        }
      } catch (dbErr: any) {
        console.warn('[IPC] profile:wipe-trial-data: SQLite wipe partial error:', dbErr.message);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[IPC] profile:wipe-trial-data error:', error);
      return { success: false, error: error.message };
    }
  });

  // Custom Provider Handlers
  safeHandle("get-custom-providers", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      // Merge new Curl Providers with legacy Custom Providers
      // New ones take precedence if IDs conflict (though unlikely as UUIDs)
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      return [...curlProviders, ...legacyProviders];
    } catch (error: any) {
      console.error("Error getting custom providers:", error);
      return [];
    }
  });

  safeHandle("save-custom-provider", async (_, provider: unknown) => {
    try {
      // SECURITY FIX (P1-2): Validate provider payload shape before persisting.
      // Prevents malformed/malicious renderer data from polluting CredentialsManager.
      if (
        typeof provider !== 'object' || provider === null ||
        typeof (provider as any).id !== 'string' ||
        typeof (provider as any).name !== 'string' ||
        typeof (provider as any).curlCommand !== 'string'
      ) {
        console.error('[IPC] save-custom-provider: invalid payload shape', typeof provider);
        return { success: false, error: 'Invalid provider payload' };
      }

      const curlCmd: string = (provider as any).curlCommand;
      // Require {{TEXT}} so the app always has a defined injection point for the user prompt.
      // We do NOT require the string to start with 'curl' — curlCommand is a template field,
      // not necessarily a raw CLI string, and over-constraining it would break valid providers.
      if (!curlCmd.includes('{{TEXT}}')) {
        return { success: false, error: 'curlCommand must contain {{TEXT}} placeholder for the prompt' };
      }

      const { CredentialsManager } = require('./services/CredentialsManager');
      // Save as CurlProvider (supports responsePath)
      CredentialsManager.getInstance().saveCurlProvider(provider);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving custom provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("delete-custom-provider", async (_, id: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      // Try deleting from both storages to be safe
      CredentialsManager.getInstance().deleteCurlProvider(id);
      CredentialsManager.getInstance().deleteCustomProvider(id);
      return { success: true };
    } catch (error: any) {
      console.error("Error deleting custom provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("switch-to-custom-provider", async (_, providerId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      // BUG-05 fix: providers may be in either the curl or legacy custom store —
      // merge both when looking up by id so neither store is silently ignored.
      const provider = [
        ...(cm.getCurlProviders() || []),
        ...(cm.getCustomProviders() || [])
      ].find((p: any) => p.id === providerId);

      if (!provider) {
        throw new Error("Provider not found");
      }

      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToCustom(provider);

      // Re-init IntelligenceManager (optional, but good for consistency)
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error switching to custom provider:", error);
      return { success: false, error: error.message };
    }
  });


  // cURL Provider Handlers
  safeHandle("get-curl-providers", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      return CredentialsManager.getInstance().getCurlProviders();
    } catch (error: any) {
      console.error("Error getting curl providers:", error);
      return [];
    }
  });

  safeHandle("save-curl-provider", async (_, provider: any) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().saveCurlProvider(provider);
      return { success: true };
    } catch (error: any) {
      console.error("Error saving curl provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("delete-curl-provider", async (_, id: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().deleteCurlProvider(id);
      return { success: true };
    } catch (error: any) {
      console.error("Error deleting curl provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("switch-to-curl-provider", async (_, providerId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const provider = CredentialsManager.getInstance().getCurlProviders().find((p: any) => p.id === providerId);

      if (!provider) {
        throw new Error("Provider not found");
      }

      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToCurl(provider);

      // Re-init IntelligenceManager (optional, but good for consistency)
      appState.getIntelligenceManager().initializeLLMs();

      return { success: true };
    } catch (error: any) {
      console.error("Error switching to curl provider:", error);
      return { success: false, error: error.message };
    }
  });

  // Get stored API keys (masked for UI display)
  safeHandle("get-stored-credentials", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const creds = CredentialsManager.getInstance().getAllCredentials();

      // Return masked versions for security (just indicate if set)
      const hasKey = (key?: string) => !!(key && key.trim().length > 0);

      // Groq vault check: user may have keys only in the vault (multi-key rotation)
      const cm = CredentialsManager.getInstance();
      const hasGroqVaultKey = (cm.getGroqKeyVault?.() || []).some((k: any) => k.enabled);
      const bedrockCredentials = cm.getBedrockCredentials();
      const safeBedrockCredentials = bedrockCredentials ? {
        authMode: bedrockCredentials.authMode,
        region: bedrockCredentials.region,
        profileName: bedrockCredentials.profileName,
        preferredModel: bedrockCredentials.preferredModel,
        hasAccessKeyId: hasKey(bedrockCredentials.accessKeyId),
        hasSecretAccessKey: hasKey(bedrockCredentials.secretAccessKey),
        hasSessionToken: hasKey(bedrockCredentials.sessionToken),
      } : undefined;

      return {
        hasGeminiKey: hasKey(creds.geminiApiKey),
        hasGroqKey: hasKey(creds.groqApiKey) || hasGroqVaultKey,
        hasOpenaiKey: hasKey(creds.openaiApiKey),
        hasClaudeKey: hasKey(creds.claudeApiKey),
        hasTeamSyncKey: hasKey(creds.teamsyncApiKey),
        googleServiceAccountPath: creds.googleServiceAccountPath || null,
        sttProvider: CredentialsManager.getInstance().getSttProvider(),
        groqSttModel: creds.groqSttModel || 'whisper-large-v3-turbo',
        hasSttGroqKey: hasKey(creds.groqSttApiKey),
        hasSttOpenaiKey: hasKey(creds.openAiSttApiKey),
        hasDeepgramKey: hasKey(creds.deepgramApiKey),
        hasElevenLabsKey: hasKey(creds.elevenLabsApiKey),
        hasAzureKey: hasKey(creds.azureApiKey),
        azureRegion: creds.azureRegion || 'eastus',
        hasIbmWatsonKey: hasKey(creds.ibmWatsonApiKey),
        ibmWatsonRegion: creds.ibmWatsonRegion || 'us-south',
        hasSonioxKey: hasKey(creds.sonioxApiKey),
        // STT key values — returned so the settings UI can pre-populate input fields.
        // AI model keys (Gemini/Groq/OpenAI/Claude) remain boolean-only; STT keys are
        // surfaced here because users need to see which key is active when switching providers.
        sttGroqKey: creds.groqSttApiKey || '',
        sttOpenaiKey: creds.openAiSttApiKey || '',
        sttDeepgramKey: creds.deepgramApiKey || '',
        sttElevenLabsKey: creds.elevenLabsApiKey || '',
        sttAzureKey: creds.azureApiKey || '',
        sttIbmKey: creds.ibmWatsonApiKey || '',
        sttSonioxKey: creds.sonioxApiKey || '',
        hasTavilyKey: hasKey(creds.tavilyApiKey),
        // Dynamic Model Discovery - preferred models
        geminiPreferredModel: creds.geminiPreferredModel || undefined,
        groqPreferredModel: creds.groqPreferredModel || undefined,
        openaiPreferredModel: creds.openaiPreferredModel || undefined,
        claudePreferredModel: creds.claudePreferredModel || undefined,
        bedrockPreferredModel: creds.bedrockPreferredModel || creds.bedrockCredentials?.preferredModel || undefined,
        groqFetchedModels: cm.getGroqFetchedModels(),
        bedrockCredentials: safeBedrockCredentials,
        bedrockFetchedModels: cm.getBedrockFetchedModels(),
        hasBedrockCredentials: cm.hasBedrockCredentials(),
      };
    } catch (error: any) {
      return { hasGeminiKey: false, hasGroqKey: false, hasOpenaiKey: false, hasClaudeKey: false, hasTeamSyncKey: false, hasBedrockCredentials: false, googleServiceAccountPath: null, sttProvider: 'deepgram', groqSttModel: 'whisper-large-v3-turbo', hasSttGroqKey: false, hasSttOpenaiKey: false, hasDeepgramKey: false, hasElevenLabsKey: false, hasAzureKey: false, azureRegion: 'eastus', hasIbmWatsonKey: false, ibmWatsonRegion: 'us-south', hasSonioxKey: false, hasTavilyKey: false, sttGroqKey: '', sttOpenaiKey: '', sttDeepgramKey: '', sttElevenLabsKey: '', sttAzureKey: '', sttIbmKey: '', sttSonioxKey: '' };
    }
  });

  // ==========================================
  // Dynamic Model Discovery Handlers
  // ==========================================

  safeHandle("fetch-provider-models", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'bedrock', apiKey: string) => {
    try {
      if (provider === 'bedrock') {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const models = await CredentialsManager.getInstance().fetchBedrockModels();
        return { success: true, models };
      }

      // Fall back to stored key if no key was explicitly provided
      let key = apiKey?.trim();
      if (!key) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const cm = CredentialsManager.getInstance();
        if (provider === 'gemini') key = cm.getGeminiApiKey();
        else if (provider === 'groq') {
          key = cm.getGroqApiKey();
          // Fallback: if no single key, use the first enabled vault key
          if (!key) {
            const vault = cm.getGroqKeyVault?.() || [];
            const firstEnabled = vault.find((k: any) => k.enabled);
            if (firstEnabled) key = firstEnabled.key;
          }
        }
        else if (provider === 'openai') key = cm.getOpenaiApiKey();
        else if (provider === 'claude') key = cm.getClaudeApiKey();
      }

      if (!key) {
        return { success: false, error: 'No API key available. Please save a key first.' };
      }

      const { fetchProviderModels } = require('./utils/modelFetcher');
      const models = await fetchProviderModels(provider, key);
      // Persist Groq catalog so overlay/window components can read without re-fetching
      if (provider === 'groq') {
        const { CredentialsManager: CM } = require('./services/CredentialsManager');
        CM.getInstance().setGroqFetchedModels(models);
      }
      return { success: true, models };
    } catch (error: any) {
      console.error(`[IPC] Failed to fetch ${provider} models:`, error);
      const msg = error?.response?.data?.error?.message || error.message || 'Failed to fetch models';
      return { success: false, error: msg };
    }
  });

  safeHandle("set-provider-preferred-model", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'bedrock', modelId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setPreferredModel(provider, modelId);
    } catch (error: any) {
      console.error(`[IPC] Failed to set preferred model for ${provider}:`, error);
    }
  });

  safeHandle("clear-groq-fetched-models", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().clearGroqFetchedModels();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-bedrock-credentials", async (_, credentials: any) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const stored = cm.getBedrockCredentials();
      const nextCredentials = {
        ...stored,
        ...credentials,
        authMode: credentials?.authMode || 'aws_cli',
        region: credentials?.region || stored?.region || 'us-east-1',
      };
      if (!credentials?.accessKeyId?.trim()) nextCredentials.accessKeyId = stored?.accessKeyId;
      if (!credentials?.secretAccessKey?.trim()) nextCredentials.secretAccessKey = stored?.secretAccessKey;
      if (credentials?.sessionToken === '') nextCredentials.sessionToken = stored?.sessionToken;
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
          preferredModel: saved.preferredModel,
        } : undefined,
      };
    } catch (error: any) {
      const { BedrockClient } = require('./services/BedrockClient');
      const msg = sanitizeErrorMessage(BedrockClient.normalizeError(error));
      console.error('[IPC] Bedrock credential save failed:', msg);
      return { success: false, error: msg };
    }
  });

  safeHandle("test-bedrock-connection", async (_, credentials: any) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const stored = cm.getBedrockCredentials();
      const nextCredentials = {
        ...stored,
        ...credentials,
        authMode: credentials?.authMode || 'aws_cli',
        region: credentials?.region || stored?.region || 'us-east-1',
      };
      if (!credentials?.accessKeyId?.trim()) nextCredentials.accessKeyId = stored?.accessKeyId;
      if (!credentials?.secretAccessKey?.trim()) nextCredentials.secretAccessKey = stored?.secretAccessKey;
      if (credentials?.sessionToken === '') nextCredentials.sessionToken = stored?.sessionToken;
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
          preferredModel: saved.preferredModel,
        } : undefined,
      };
    } catch (error: any) {
      const { BedrockClient } = require('./services/BedrockClient');
      const msg = sanitizeErrorMessage(BedrockClient.normalizeError(error));
      console.error('[IPC] Bedrock connection test failed:', msg);
      return { success: false, error: msg };
    }
  });

  safeHandle("fetch-bedrock-models", async (_, credentials?: any) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const models = await cm.fetchBedrockModels(credentials || undefined);
      return { success: true, models };
    } catch (error: any) {
      const { BedrockClient } = require('./services/BedrockClient');
      const msg = sanitizeErrorMessage(BedrockClient.normalizeError(error));
      console.error('[IPC] Bedrock model fetch failed:', msg);
      return { success: false, error: msg };
    }
  });

  // ==========================================
  // STT Provider Management Handlers
  // ==========================================

  const broadcastCredentialsChanged = () => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) win.webContents.send('credentials-changed');
    });
  };

  const autoSelectSttProviderForSavedKey = (
    provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox',
    apiKey: string,
  ) => {
    const trimmedKey = apiKey?.trim();
    if (!trimmedKey) {
      return;
    }

    const { CredentialsManager } = require('./services/CredentialsManager');
    const cm = CredentialsManager.getInstance();
    if (cm.getSttProvider() !== provider) {
      cm.setSttProvider(provider);
      console.log(`[IPC] Auto-promoted STT provider to ${provider} after key save`);
    }
  };

  safeHandle("set-stt-provider", async (_, provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'teamsync' | 'whisper') => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setSttProvider(provider);

      // Reconfigure the audio pipeline to use the new STT provider
      await appState.reconfigureSttProvider();

      // Notify all windows so the settings UI reflects the change immediately
      broadcastCredentialsChanged();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting STT provider:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("get-stt-provider", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      return CredentialsManager.getInstance().getSttProvider();
    } catch (error: any) {
      return 'none';
    }
  });

  safeHandle("stt:get-runtime-state", async () => {
    try {
      return appState.getSttRuntimeState();
    } catch (error: any) {
      return { user: null, interviewer: null, error: error.message };
    }
  });

  safeHandle("set-groq-stt-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttApiKey(apiKey);
      autoSelectSttProviderForSavedKey('groq', apiKey);

      // Reconfigure the in-memory audio pipeline so the new key takes effect immediately
      await appState.reconfigureSttProvider();

      broadcastCredentialsChanged();
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Groq STT API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-openai-stt-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setOpenAiSttApiKey(apiKey);
      autoSelectSttProviderForSavedKey('openai', apiKey);

      // Reconfigure the in-memory audio pipeline so the new key takes effect immediately
      await appState.reconfigureSttProvider();

      broadcastCredentialsChanged();
      return { success: true };
    } catch (error: any) {
      console.error("Error saving OpenAI STT API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-deepgram-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      cm.setDeepgramApiKey(apiKey);
      autoSelectSttProviderForSavedKey('deepgram', apiKey);

      // Reconfigure the in-memory audio pipeline so the new key takes effect immediately
      await appState.reconfigureSttProvider();

      broadcastCredentialsChanged();
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Deepgram API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-groq-stt-model", async (_, model: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGroqSttModel(model);

      // Reconfigure the audio pipeline to use the new model
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting Groq STT model:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-elevenlabs-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setElevenLabsApiKey(apiKey);
      autoSelectSttProviderForSavedKey('elevenlabs', apiKey);

      // Reconfigure the in-memory audio pipeline so the new key takes effect immediately
      await appState.reconfigureSttProvider();

      broadcastCredentialsChanged();
      return { success: true };
    } catch (error: any) {
      console.error("Error saving ElevenLabs API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-azure-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setAzureApiKey(apiKey);
      autoSelectSttProviderForSavedKey('azure', apiKey);

      await appState.reconfigureSttProvider();
      broadcastCredentialsChanged();
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Azure API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-azure-region", async (_, region: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setAzureRegion(region);

      // Reconfigure the pipeline since region changes the endpoint URL
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting Azure region:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-ibmwatson-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setIbmWatsonApiKey(apiKey);
      autoSelectSttProviderForSavedKey('ibmwatson', apiKey);

      await appState.reconfigureSttProvider();
      broadcastCredentialsChanged();
      return { success: true };
    } catch (error: any) {
      console.error("Error saving IBM Watson API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-soniox-api-key", async (_, apiKey: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setSonioxApiKey(apiKey);
      autoSelectSttProviderForSavedKey('soniox', apiKey);

      // Reconfigure the in-memory audio pipeline so the new key takes effect immediately
      await appState.reconfigureSttProvider();

      broadcastCredentialsChanged();
      return { success: true };
    } catch (error: any) {
      console.error("Error saving Soniox API key:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-ibmwatson-region", async (_, region: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setIbmWatsonRegion(region);

      // Reconfigure the pipeline since region changes the endpoint URL
      await appState.reconfigureSttProvider();

      return { success: true };
    } catch (error: any) {
      console.error("Error setting IBM Watson region:", error);
      return { success: false, error: error.message };
    }
  });

  // Helper to sanitize error messages (remove API key references)
  const sanitizeErrorMessage = (msg: string): string => {
    // Remove patterns like ": sk-***...***" or ": sdasdada***...dwwC"
    return msg.replace(/:\s*[a-zA-Z0-9*]+\*+[a-zA-Z0-9*]+\.?$/g, '').trim();
  };

  safeHandle("test-stt-connection", async (_, provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', apiKey: string, region?: string) => {
    console.log(`[IPC] Received test - stt - connection request for provider: ${provider} `);
    try {
      if (provider === 'deepgram') {
        const WebSocket = require('ws');
        const token = apiKey.trim();
        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          const url = 'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1';
          const ws = new WebSocket(url, {
            headers: { Authorization: `Token ${token}` },
          });

          const timeout = setTimeout(() => {
            ws.close();
            console.error('[IPC] Deepgram test failed: Connection timed out');
            resolve({ success: false, error: 'Connection timed out' });
          }, 15000);

          ws.on('open', () => {
            clearTimeout(timeout);
            try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch { }
            ws.close();
            resolve({ success: true });
          });

          ws.on('unexpected-response', (request: any, response: any) => {
            clearTimeout(timeout);
            const status = response.statusCode;
            let body = '';
            response.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            response.on('end', () => {
              const errMsg = `Unexpected server response: ${status} - ${body}`;
              console.error(`[IPC] Deepgram test failed: ${errMsg}`);
              resolve({ success: false, error: errMsg });
            });
          });

          ws.on('error', (err: any) => {
            clearTimeout(timeout);
            console.error(`[IPC] Deepgram test error: ${err.message}`);
            resolve({ success: false, error: err.message || 'Connection failed' });
          });
        });
      }

      if (provider === 'soniox') {
        // Test Soniox via WebSocket connection.
        // With a valid key, Soniox accepts the config and then silently waits for audio —
        // it never sends a response message. With an invalid key it immediately sends an
        // error message and closes. So the strategy is:
        //   • If we receive an error message → fail
        //   • If the connection errors at the WS level → fail
        //   • If 2.5 s pass after sending the config with no error → success
        const WebSocket = require('ws');
        return await new Promise<{ success: boolean; error?: string }>((resolve) => {
          let resolved = false;
          const done = (result: { success: boolean; error?: string }) => {
            if (resolved) return;
            resolved = true;
            try { ws.close(); } catch { }
            resolve(result);
          };

          const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

          // Hard connect timeout — server unreachable
          const connectTimeout = setTimeout(() => {
            done({ success: false, error: 'Connection timed out' });
          }, 10000);

          ws.on('open', () => {
            clearTimeout(connectTimeout);
            ws.send(JSON.stringify({
              api_key: apiKey,
              model: 'stt-rt-v4',
              audio_format: 'pcm_s16le',
              sample_rate: 16000,
              num_channels: 1,
            }));
            // Give Soniox 2.5 s to reject the key; silence means the key is valid
            setTimeout(() => done({ success: true }), 2500);
          });

          ws.on('message', (msg: any) => {
            try {
              const res = JSON.parse(msg.toString());
              if (res.error_code) {
                done({ success: false, error: `${res.error_code}: ${res.error_message}` });
              }
              // Non-error message is unexpected but treat as success
            } catch {
              // Unparseable message — treat as success
            }
          });

          ws.on('error', (err: any) => {
            clearTimeout(connectTimeout);
            done({ success: false, error: err.message || 'Connection failed' });
          });

          ws.on('close', (code: number) => {
            // Abnormal close before we resolved means the server rejected us
            if (!resolved && code !== 1000) {
              done({ success: false, error: `Server closed connection (code ${code})` });
            }
          });
        });
      }

      const axios = require('axios');
      const FormData = require('form-data');

      // Generate a tiny silent WAV (0.5s of silence at 16kHz mono 16-bit)
      const numSamples = 8000;
      const pcmData = Buffer.alloc(numSamples * 2);
      const wavHeader = Buffer.alloc(44);
      wavHeader.write('RIFF', 0);
      wavHeader.writeUInt32LE(36 + pcmData.length, 4);
      wavHeader.write('WAVE', 8);
      wavHeader.write('fmt ', 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20);
      wavHeader.writeUInt16LE(1, 22);
      wavHeader.writeUInt32LE(16000, 24);
      wavHeader.writeUInt32LE(32000, 28);
      wavHeader.writeUInt16LE(2, 32);
      wavHeader.writeUInt16LE(16, 34);
      wavHeader.write('data', 36);
      wavHeader.writeUInt32LE(pcmData.length, 40);
      const testWav = Buffer.concat([wavHeader, pcmData]);

      if (provider === 'elevenlabs') {
        // ElevenLabs: Use /v1/voices to validate the API key (minimal scope required).
        // Scoped keys may lack speech_to_text or user_read but still be usable once permissions are added.
        try {
          await axios.get('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': apiKey },
            timeout: 10000,
          });
        } catch (elErr: any) {
          const elStatus = elErr?.response?.data?.detail?.status;
          // If the error is "invalid_api_key", the key itself is wrong — fail.
          // Any other error (missing permission, etc.) means the key IS valid, just possibly scoped.
          if (elStatus === 'invalid_api_key') {
            throw elErr;
          }
          // Key is valid but scoped — pass with a warning
          console.log('[IPC] ElevenLabs key is valid but may have restricted scopes. Saving key.');
        }
      } else if (provider === 'azure') {
        // Azure: raw binary with subscription key
        const azureRegion = region || 'eastus';
        await axios.post(
          `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`,
          testWav,
          {
            headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'Content-Type': 'audio/wav' },
            timeout: 15000,
          }
        );
      } else if (provider === 'ibmwatson') {
        // IBM Watson: raw binary with Basic auth
        const ibmRegion = region || 'us-south';
        await axios.post(
          `https://api.${ibmRegion}.speech-to-text.watson.cloud.ibm.com/v1/recognize`,
          testWav,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}`,
              'Content-Type': 'audio/wav',
            },
            timeout: 15000,
          }
        );
      } else {
        // Groq / OpenAI: multipart FormData
        const endpoint = provider === 'groq'
          ? 'https://api.groq.com/openai/v1/audio/transcriptions'
          : 'https://api.openai.com/v1/audio/transcriptions';
        const model = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';

        const form = new FormData();
        form.append('file', testWav, { filename: 'test.wav', contentType: 'audio/wav' });
        form.append('model', model);

        await axios.post(endpoint, form, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...form.getHeaders(),
          },
          timeout: 15000,
        });
      }

      return { success: true };
    } catch (error: any) {
      const respData = error?.response?.data;
      const rawMsg = respData?.error?.message || respData?.detail?.message || respData?.message || error.message || 'Connection failed';
      const msg = sanitizeErrorMessage(rawMsg);
      console.error("STT connection test failed:", msg);
      return { success: false, error: msg };
    }
  });

  safeHandle("test-llm-connection", async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey?: string) => {
    console.log(`[IPC] Received test-llm-connection request for provider: ${provider}`);
    try {
      if (!apiKey || !apiKey.trim()) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const creds = CredentialsManager.getInstance();
        if (provider === 'gemini') apiKey = creds.getGeminiApiKey();
        else if (provider === 'groq') apiKey = creds.getGroqApiKey();
        else if (provider === 'openai') apiKey = creds.getOpenaiApiKey();
        else if (provider === 'claude') apiKey = creds.getClaudeApiKey();
      }

      if (!apiKey || !apiKey.trim()) {
        return { success: false, error: 'No API key provided' };
      }

      const axios = require('axios');
      let response;

      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent`;
        response = await axios.post(url, {
          contents: [{ parts: [{ text: "Hello" }] }]
        }, {
          headers: { 'x-goog-api-key': apiKey },
          timeout: 15000
        });
      } else if (provider === 'groq') {
        response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15000
        });
      } else if (provider === 'openai') {
        response = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15000
        });
      } else if (provider === 'claude') {
        response = await axios.post('https://api.anthropic.com/v1/messages', {
          model: "claude-sonnet-4-6",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hello" }]
        }, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          timeout: 15000
        });
      }

      if (response && (response.status === 200 || response.status === 201)) {
        return { success: true };
      } else {
        return { success: false, error: 'Request failed with status ' + response?.status };
      }

    } catch (error: any) {
      console.error("LLM connection test failed:", error);
      const rawMsg = error?.response?.data?.error?.message || error?.response?.data?.message || (error.response?.data?.error?.type ? `${error.response.data.error.type}: ${error.response.data.error.message}` : error.message) || 'Connection failed';
      const msg = sanitizeErrorMessage(rawMsg);
      return { success: false, error: msg };
    }
  });

  safeHandle("get-groq-fast-text-mode", () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return { enabled: llmHelper.getGroqFastTextMode() };
    } catch (error: any) {
      return { enabled: false };
    }
  });

  // Set Groq Fast Text Mode
  safeHandle("set-groq-fast-text-mode", (_, enabled: boolean) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqFastTextMode(enabled);

      const { SettingsManager } = require('./services/SettingsManager');
      SettingsManager.getInstance().set('groqFastTextMode', enabled);

      // Broadcast to all windows
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('groq-fast-text-changed', enabled);
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-model", async (_, modelId: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();

      // Get all providers (Curl + Custom)
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];

      llmHelper.setModel(modelId, allProviders);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      // Broadcast to all windows so TeamSyncInterface can update its selector (session-only update)
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('model-changed', modelId);
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error("Error setting model:", error);
      return { success: false, error: error.message };
    }
  });

  // Persist default model (from Settings) + update runtime + broadcast to all windows
  safeHandle("set-default-model", async (_, modelId: string) => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const { isBedrockModelId, resolveBedrockModelId } = require('./llm/BedrockModelIds');
      const cm = CredentialsManager.getInstance();
      const bedrockPreferred = cm.getPreferredModel('bedrock') || cm.getBedrockCredentials()?.preferredModel;
      const finalModelId = isBedrockModelId(modelId, bedrockPreferred)
        ? (resolveBedrockModelId(modelId, bedrockPreferred) || modelId)
        : modelId;
      cm.setDefaultModel(finalModelId);

      // Also update the runtime model
      const llmHelper = appState.processingHelper.getLLMHelper();
      const curlProviders = cm.getCurlProviders();
      const legacyProviders = cm.getCustomProviders() || [];
      const allProviders = [...curlProviders, ...legacyProviders];
      llmHelper.setModel(finalModelId, allProviders);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      // Broadcast to all windows so TeamSyncInterface can update its selector
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('model-changed', finalModelId);
        }
      });

      return { success: true };
    } catch (error: any) {
      console.error("Error setting default model:", error);
      return { success: false, error: error.message };
    }
  });

  // Read the persisted default model
  safeHandle("get-default-model", async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      return { model: cm.getDefaultModel() };
    } catch (error: any) {
      console.error("Error getting default model:", error);
      return { model: 'gemini-3.1-flash-lite-preview' };
    }
  });

  // --- Model Selector Window IPC ---

  safeHandle("show-model-selector", (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.showWindow(coords.x, coords.y);
  });

  safeHandle("hide-model-selector", () => {
    appState.modelSelectorWindowHelper.hideWindow();
  });

  safeHandle("toggle-model-selector", (_, coords: { x: number; y: number }) => {
    appState.modelSelectorWindowHelper.toggleWindow(coords.x, coords.y);
  });



  // Native Audio Service Handlers
  // Native Audio handlers removed as part of migration to driverless architecture
  safeHandle("native-audio-status", async () => {
    // Always return true or pseudo-status since it's "driverless"
    return { connected: true };
  });

  safeHandle("get-input-devices", async () => {
    return AudioDevices.getInputDevices();
  });

  safeHandle("get-output-devices", async () => {
    return AudioDevices.getOutputDevices();
  });

  safeHandle("start-audio-test", async (event, deviceId?: string) => {
    await appState.startAudioTest(deviceId);
    return { success: true };
  });

  safeHandle("stop-audio-test", async () => {
    appState.stopAudioTest();
    return { success: true };
  });

  safeHandle("set-recognition-language", async (_, key: string) => {
    appState.setRecognitionLanguage(key);
    return { success: true };
  });

  // ==========================================
  // Meeting Lifecycle Handlers
  // ==========================================

  safeHandle("start-meeting", async (event, metadata?: any) => {
    try {
      await appState.startMeeting(metadata);
      return { success: true };
    } catch (error: any) {
      console.error("Error starting meeting:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("end-meeting", async () => {
    try {
      await appState.endMeeting();
      return { success: true };
    } catch (error: any) {
      console.error("Error ending meeting:", error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("get-recent-meetings", async () => {
    // Fetch from SQLite (limit 50)
    return DatabaseManager.getInstance().getRecentMeetings(50);
  });

  safeHandle("get-meeting-details", async (event, id) => {
    // Helper to fetch full details
    return DatabaseManager.getInstance().getMeetingDetails(id);
  });

  safeHandle("update-meeting-title", async (_, { id, title }: { id: string; title: string }) => {
    return DatabaseManager.getInstance().updateMeetingTitle(id, title);
  });

  safeHandle("update-meeting-summary", async (_, { id, updates }: { id: string; updates: any }) => {
    return DatabaseManager.getInstance().updateMeetingSummary(id, updates);
  });

  safeHandle("seed-demo", async () => {
    DatabaseManager.getInstance().seedDemoMeeting();

    // Ensure RAG embeddings exist for the demo meeting.
    // Use ensureDemoMeetingProcessed so we skip if already embedded
    // (avoids re-clearing 14 queue items on every app launch once processed).
    const ragManager = appState.getRAGManager();
    if (ragManager && ragManager.isReady()) {
      ragManager.ensureDemoMeetingProcessed().catch(console.error);
    }

    return { success: true };
  });

  safeHandle("open-external", async (event, url: string) => {
    try {
      // For macOS System Settings, URL() parsing might act differently or we can just check string prefix
      if (url.startsWith('x-apple.systempreferences:')) {
        await shell.openExternal(url);
        return;
      }
      
      const parsed = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        await shell.openExternal(url);
      } else {
        console.warn(`[IPC] Blocked potentially unsafe open-external: ${url}`);
      }
    } catch {
      console.warn(`[IPC] Invalid URL in open-external: ${url}`);
    }
  });

  // ==========================================
  // Intelligence Mode Handlers
  // ==========================================

  // MODE 1: Assist (Passive observation)
  safeHandle("generate-assist", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const insight = await intelligenceManager.runAssistMode();
      return { insight };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle("session:get-mode", async () => {
    return { mode: appState.getIntelligenceManager().getSessionMode() };
  });

  safeHandle("session:get-id", async () => {
    return { sessionId: appState.getIntelligenceManager().getSessionId() };
  });

  safeHandle("session:set-mode", async (_, mode: 'behavioral' | 'coding' | 'follow_up' | 'general' | 'salary' | 'system_design') => {
    const intelligenceManager = appState.getIntelligenceManager();
    intelligenceManager.setSessionMode(mode);
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('session-mode-changed', { mode });
      }
    });
    return { success: true, mode };
  });

  safeHandle("generate-action", async (_, payload: {
    intent: 'what_to_answer' | 'recap' | 'clarify' | 'brainstorm' | 'follow_up_questions' | 'answer_now' | 'system_design_tradeoffs';
    message?: string;
    additionalContext?: string;
    imagePaths?: string[];
    requestId?: string;
    profilePreference?: 'default' | 'force_on' | 'force_off';
    modelOverride?: string;
    transcriptOverride?: string;
    actionContract?: 'default' | 'hint_only' | 'complexity_only' | 'edge_cases_only' | 'debugging_only' | 'bruteforce_only' | 'optimal_solution' | 'followup_questions_only';
    actionId?: string;
    contextTarget?: 'latest_turn' | 'active_context' | 'transcript';
  }) => {
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
      contextTarget: payload.contextTarget,
    });
    return { success: true, result };
  });

  // MODE 2: What Should I Say (Primary auto-answer)
  safeHandle("generate-what-to-say", async (_, question?: string, imagePaths?: string[], mode?: string, requestId?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.handleAction('what_to_answer', {
        message: question,
        imagePaths,
        requestId,
        modeOverride: mode as any,
      });
      return { answer, question: question || 'inferred from context' };
    } catch (error: any) {
      // Return graceful fallback instead of throwing
      return {
        question: question || 'unknown'
      };
    }
  });

  safeHandle("generate-clarify", async (_, requestId?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const clarification = await intelligenceManager.handleAction('clarify', {
        requestId,
        profilePreference: 'force_off',
      });
      // If null returned without throwing, the engine already set mode to idle.
      // We must still ensure the frontend un-sticks — emit an error so onIntelligenceError fires.
      if (clarification === null) {
        const win = appState.getMainWindow();
        win?.webContents.send('intelligence-error', {
          error: 'Could not generate a clarifying question. Try again after some audio context is available.',
          mode: 'clarify',
          requestId,
        });
      }
      return { clarification };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle("generate-code-hint", async (_, imagePaths?: string[], problemStatement?: string, requestId?: string) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const resolvedImagePaths: string[] =
        imagePaths && imagePaths.length > 0
          ? imagePaths
          : appState.getScreenshotQueue();

      console.log(`[IPC] generate-code-hint: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`);

      const intelligenceManager = appState.getIntelligenceManager();
      const hint = await intelligenceManager.runCodeHint(
        resolvedImagePaths.length > 0 ? resolvedImagePaths : undefined,
        problemStatement,
        requestId
      );
      return { hint };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle("generate-brainstorm", async (_, imagePaths?: string[], problemStatement?: string, requestId?: string) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const resolvedImagePaths: string[] =
        imagePaths && imagePaths.length > 0
          ? imagePaths
          : appState.getScreenshotQueue();

      console.log(`[IPC] generate-brainstorm: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`);

      const intelligenceManager = appState.getIntelligenceManager();
      const script = await intelligenceManager.runBrainstorm(
        resolvedImagePaths.length > 0 ? resolvedImagePaths : undefined,
        problemStatement,
        requestId
      );
      return { script };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle("generate-answer-now", async (_, question: string, imagePaths?: string[], context?: string, mode?: string, requestId?: string) => {
    try {
      const answer = await appState.getIntelligenceManager().handleAction('answer_now', {
        message: question,
        imagePaths,
        requestId,
        additionalContext: context,
        modeOverride: mode as any,
      });
      return { answer };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 9: Screen Scan (Context-Aware Screen Intelligence)
  safeHandle("generate-screen-scan", async (_, imagePaths?: string[], extractedText?: string, forcedMode?: string, requestId?: string) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const resolvedImagePaths: string[] =
        imagePaths && imagePaths.length > 0
          ? imagePaths
          : appState.getScreenshotQueue();

      console.log(`[IPC] generate-screen-scan: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'}), mode: ${forcedMode || 'auto'}`);

      const intelligenceManager = appState.getIntelligenceManager();
      const result = await intelligenceManager.runScreenScan(
        resolvedImagePaths,
        extractedText,
        forcedMode as any,
        requestId
      );
      return { result, mode: forcedMode || 'auto' };
    } catch (error: any) {
      throw error;
    }
  });

  // Dynamic Action Button Mode (Recap vs Brainstorm)
  safeHandle("get-action-button-mode", () => {
    const { SettingsManager } = require('./services/SettingsManager');
    const sm = SettingsManager.getInstance();
    return sm.get('actionButtonMode') ?? 'recap';
  });

  safeHandle("set-action-button-mode", (_, mode: 'recap' | 'brainstorm') => {
    const { SettingsManager } = require('./services/SettingsManager');
    const sm = SettingsManager.getInstance();
    sm.set('actionButtonMode', mode);

    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('action-button-mode-changed', mode);
      }
    });

    return { success: true };
  });

  safeHandle("get-personalization-preferences", () => {
    const { SettingsManager } = require('./services/SettingsManager');
    return SettingsManager.getInstance().getPersonalizationPreferences();
  });

  safeHandle("set-personalization-preferences", (_, patch: unknown) => {
    const { SettingsManager } = require('./services/SettingsManager');
    const preferences = SettingsManager.getInstance().setPersonalizationPreferences(patch as any);

    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('personalization-preferences-changed', preferences);
      }
    });

    return { success: true, preferences };
  });

  // MODE 3: Follow-Up (Refinement)
  safeHandle("generate-follow-up", async (_, intent: string, userRequest?: string, requestId?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const refined = await intelligenceManager.runFollowUp(intent, userRequest, requestId);
      return { refined, intent };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 4: Recap (Summary)
  safeHandle("generate-recap", async (_, requestId?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const summary = await intelligenceManager.handleAction('recap', {
        requestId,
        profilePreference: 'force_off',
      });
      return { summary };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 6: Follow-Up Questions
  safeHandle("generate-follow-up-questions", async (_, requestId?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const questions = await intelligenceManager.handleAction('follow_up_questions', {
        requestId,
        profilePreference: 'force_off',
      });
      return { questions };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle("generate-system-design-tradeoffs", async (_, requestId?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.runSystemDesignTradeoffs(requestId);
      return { answer };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 5: Manual Answer (Fallback)
  safeHandle("submit-manual-question", async (_, question: string, requestId?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.handleAction('manual_chat', {
        message: question,
        requestId,
      });
      return { answer, question };
    } catch (error: any) {
      throw error;
    }
  });

  // Get current intelligence context
  safeHandle("get-intelligence-context", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      return {
        context: intelligenceManager.getFormattedContext(),
        lastAssistantMessage: intelligenceManager.getLastAssistantMessage(),
        activeMode: intelligenceManager.getActiveMode()
      };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle("benchmark:get-summary", async () => {
    return BenchmarkManager.getInstance().getSummary();
  });

  safeHandle("benchmark:get-recent", async (_, limit: number = 20) => {
    return BenchmarkManager.getInstance().getRecent(limit);
  });

  // Reset intelligence state
  safeHandle("reset-intelligence", async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.reset();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });


  // Service Account Selection
  safeHandle("select-service-account", async () => {
    try {
      const result = await showOpenDialogNormalized({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      const filePath = result.filePaths[0];

      // Update backend state immediately
      appState.updateGoogleCredentials(filePath);

      // Persist the path for future sessions
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setGoogleServiceAccountPath(filePath);

      return { success: true, path: filePath };
    } catch (error: any) {
      console.error("Error selecting service account:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Theme System Handlers
  // ==========================================

  safeHandle("theme:get-mode", () => {
    const tm = appState.getThemeManager();
    return {
      mode: tm.getMode(),
      resolved: tm.getResolvedTheme()
    };
  });

  safeHandle("theme:set-mode", (_, mode: 'system' | 'light' | 'dark') => {
    appState.getThemeManager().setMode(mode);
    return { success: true };
  });

  // ==========================================
  // Calendar Integration Handlers
  // ==========================================

  safeHandle("calendar-intelligence:evaluate-events", async (_, events: any[]) => {
    return calendarIntelligence.observeUpcomingEvents(Array.isArray(events) ? events : []);
  });

  safeHandle("calendar-intelligence:get-recommendation", async () => {
    return calendarIntelligence.getRecommendation();
  });

  safeHandle("calendar-intelligence:dismiss", async (_, eventId: string) => {
    calendarIntelligence.dismissEvent(eventId);
    return { success: true };
  });

  // ==========================================
  // Follow-up Email Handlers
  // ==========================================

  safeHandle("generate-followup-email", async (_, input: any) => {
    try {
      const { FOLLOWUP_EMAIL_PROMPT, GROQ_FOLLOWUP_EMAIL_PROMPT } = require('./llm/prompts');
      const { buildFollowUpEmailPromptInput } = require('./utils/emailUtils');

      const llmHelper = appState.processingHelper.getLLMHelper();

      // Build the context string from input
      const contextString = buildFollowUpEmailPromptInput(input);

      // Build prompts
      const geminiPrompt = `${FOLLOWUP_EMAIL_PROMPT}\n\nMEETING DETAILS:\n${contextString}`;
      const groqPrompt = `${GROQ_FOLLOWUP_EMAIL_PROMPT}\n\nMEETING DETAILS:\n${contextString}`;

      // Use chatWithGemini with alternateGroqMessage for fallback
      const emailBody = await llmHelper.chatWithGemini(geminiPrompt, undefined, undefined, true, groqPrompt);

      return emailBody;
    } catch (error: any) {
      console.error("Error generating follow-up email:", error);
      throw error;
    }
  });

  safeHandle("extract-emails-from-transcript", async (_, transcript: Array<{ text: string }>) => {
    try {
      const { extractEmailsFromTranscript } = require('./utils/emailUtils');
      return extractEmailsFromTranscript(transcript);
    } catch (error: any) {
      console.error("Error extracting emails:", error);
      return [];
    }
  });

  safeHandle("get-calendar-attendees", async (_, eventId: string) => {
    try {
      console.warn("[IPC] get-calendar-attendees is unavailable without a hosted calendar event payload:", eventId);
      return [];
    } catch (error: any) {
      console.error("Error getting calendar attendees:", error);
      return [];
    }
  });

  safeHandle("open-mailto", async (_, { to, subject, body }: { to: string; subject: string; body: string }) => {
    try {
      const { buildMailtoLink } = require('./utils/emailUtils');
      const mailtoUrl = buildMailtoLink(to, subject, body);
      await shell.openExternal(mailtoUrl);
      return { success: true };
    } catch (error: any) {
      console.error("Error opening mailto:", error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // RAG (Retrieval-Augmented Generation) Handlers
  // ==========================================

  // Store active query abort controllers for cancellation
  const activeRAGQueries = new Map<string, AbortController>();
  const activeRAGActionRequestIds = new Map<string, string>();
  const activeLiveRagQueriesBySender = new Map<number, { queryKey: string; controller: AbortController; requestId?: string }>();

  // Query meeting with RAG (meeting-scoped)
  safeHandle("rag:query-meeting", async (event, { meetingId, query }: { meetingId: string; query: string }) => {
    const ragManager = appState.getRAGManager();
    const intelligenceManager = appState.getIntelligenceManager();

    if (!ragManager || !ragManager.isReady()) {
      // Fallback to regular chat if RAG not available
      console.log("[RAG] Not ready, falling back to regular chat");
      return { fallback: true };
    }

    // For completed meetings, check if post-meeting RAG is processed.
    // For live meetings with JIT indexing, let RAGManager.queryMeeting() decide.
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
      const onToken = (payload: any) => {
        if (payload?.intent !== 'manual_chat' || payload?.requestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-chunk", { meetingId, chunk: payload.token });
      };
      const onResult = (payload: any) => {
        if (payload?.intent !== 'manual_chat' || payload?.requestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-complete", { meetingId });
      };
      const onError = (error: any, _mode: string, failedRequestId?: string | null) => {
        if (failedRequestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-error", { meetingId, error: error?.message || 'Unknown error' });
      };

      intelligenceManager.on('action_token', onToken);
      intelligenceManager.on('action_result', onResult);
      intelligenceManager.on('error', onError);

      try {
        await intelligenceManager.handleAction('manual_chat', {
          message: query,
          requestId,
          rag: {
            content: retrieved.formattedContext,
            scope: 'meeting',
            title: 'RAG MEMORY (MEETING)',
          },
          profilePreference: 'force_off',
          additionalContext: [
            'Answer questions ONLY about this meeting.',
            'Be concise and natural.',
            'If the answer is not present, say so briefly and do not guess.',
          ].join('\n'),
        });
      } finally {
        intelligenceManager.off('action_token', onToken);
        intelligenceManager.off('action_result', onResult);
        intelligenceManager.off('error', onError);
      }

      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || "";
        // If specific RAG failures, return fallback to use transcript window
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
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

  // Query live meeting with JIT RAG
  safeHandle("rag:query-live", async (event, { query, requestId }: { query: string; requestId?: string }) => {
    const ragManager = appState.getRAGManager();
    const intelligenceManager = appState.getIntelligenceManager();
    const senderId = event.sender.id;

    if (!ragManager || !ragManager.isReady()) {
      return { fallback: true };
    }

    // Check if JIT indexing is active and has chunks
    if (!ragManager.isLiveIndexingActive('live-meeting-current')) {
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
      const retrieved = await ragManager.retrieveMeetingContext('live-meeting-current', query);
      const onToken = (payload: any) => {
        if (payload?.requestId !== requestId || payload?.intent !== 'manual_chat') return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-chunk", { live: true, chunk: payload.token, requestId });
      };
      const onResult = (payload: any) => {
        if (payload?.requestId !== requestId || payload?.intent !== 'manual_chat') return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-complete", { live: true, requestId });
      };
      const onError = (error: any, _mode: string, failedRequestId?: string | null) => {
        if (failedRequestId !== requestId || abortController.signal.aborted) return;
        event.sender.send("rag:stream-error", { live: true, error: error?.message || 'Unknown error', requestId });
      };

      intelligenceManager.on('action_token', onToken);
      intelligenceManager.on('action_result', onResult);
      intelligenceManager.on('error', onError);

      try {
        await intelligenceManager.handleAction('manual_chat', {
          message: query,
          requestId,
          rag: {
            content: retrieved.formattedContext,
            scope: 'live',
            title: 'RAG MEMORY (LIVE)',
          },
          profilePreference: 'force_off',
          additionalContext: [
            'Answer questions ONLY about the current live meeting.',
            'Be concise and natural.',
            'If the answer is not present, say so briefly and do not guess.',
          ].join('\n'),
        });
      } finally {
        intelligenceManager.off('action_token', onToken);
        intelligenceManager.off('action_result', onResult);
        intelligenceManager.off('error', onError);
      }

      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || "";
        // If JIT RAG failed (no embeddings yet, no relevant context), fallback to regular chat
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
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

  // Query global (cross-meeting search)
  safeHandle("rag:query-global", async (event, { query, requestId: providedRequestId }: { query: string; requestId?: string }) => {
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
      const onToken = (payload: any) => {
        if (payload?.intent !== 'manual_chat' || payload?.requestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-chunk", { global: true, chunk: payload.token, requestId });
      };
      const onResult = (payload: any) => {
        if (payload?.intent !== 'manual_chat' || payload?.requestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-complete", { global: true, requestId });
      };
      const onError = (error: any, _mode: string, failedRequestId?: string | null) => {
        if (failedRequestId !== requestId) return;
        if (abortController.signal.aborted) return;
        event.sender.send("rag:stream-error", { global: true, error: error?.message || 'Unknown error', requestId });
      };

      intelligenceManager.on('action_token', onToken);
      intelligenceManager.on('action_result', onResult);
      intelligenceManager.on('error', onError);

      try {
        await intelligenceManager.handleAction('manual_chat', {
          message: query,
          requestId,
          rag: {
            content: retrieved.formattedContext,
            scope: 'global',
            title: 'RAG MEMORY (GLOBAL)',
          },
          profilePreference: 'force_off',
          additionalContext: [
            'Answer by searching across meetings.',
            'Mention which meeting or time period the answer came from when possible.',
            'Be concise and do not guess.',
          ].join('\n'),
        });
      } finally {
        intelligenceManager.off('action_token', onToken);
        intelligenceManager.off('action_result', onResult);
        intelligenceManager.off('error', onError);
      }

      return { success: true };

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const msg = error.message || "";
        if (msg.includes('NO_RELEVANT_CONTEXT') || msg.includes('NO_MEETING_EMBEDDINGS')) {
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

  // Cancel active RAG query
  safeHandle("rag:cancel-query", async (_, { meetingId, global }: { meetingId?: string; global?: boolean }) => {
    const queryKey = global ? 'global' : `meeting-${meetingId}`;

    // Cancel any matching key
    for (const [key, controller] of activeRAGQueries) {
      if (key.startsWith(queryKey) || (global && key.startsWith('global'))) {
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

  // Check if meeting has RAG embeddings
  safeHandle('rag:is-meeting-processed', async (_, meetingId: string) => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      return ragManager.isMeetingProcessed(meetingId);
    } catch (error: any) {
      console.error('[IPC rag:is-meeting-processed] Error:', error);
      return false;
    }
  });

  safeHandle('rag:reindex-incompatible-meetings', async () => {
    try {
      const ragManager = appState.getRAGManager();
      if (!ragManager) throw new Error('RAGManager not initialized');
      await ragManager.reindexIncompatibleMeetings();
      return { success: true };
    } catch (error: any) {
      console.error('[IPC rag:reindex-incompatible-meetings] Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Get RAG queue status
  safeHandle("rag:get-queue-status", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { pending: 0, processing: 0, completed: 0, failed: 0 };
    return ragManager.getQueueStatus();
  });

  // Retry pending embeddings
  safeHandle("rag:retry-embeddings", async () => {
    const ragManager = appState.getRAGManager();
    if (!ragManager) return { success: false };
    await ragManager.retryPendingEmbeddings();
    return { success: true };
  });

  // ==========================================
  // Profile Engine IPC Handlers
  // ==========================================

  const getTavilyKey = (): string | null => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const key = CredentialsManager.getInstance().getTavilyApiKey();
      return typeof key === 'string' && key.trim() ? key.trim() : null;
    } catch {
      return null;
    }
  };

  const configureExplicitTavilyResearchProvider = (orchestrator: any): string | null => {
    if (!orchestrator) return null;
    const tavilyApiKey = getTavilyKey();
    if (!tavilyApiKey) {
      orchestrator.setCompanyResearchProvider?.(null);
      return null;
    }

    const { TavilySearchProvider } = require('../premium/electron/knowledge/TavilySearchProvider');
    orchestrator.setCompanyResearchProvider?.(new TavilySearchProvider(tavilyApiKey));
    return tavilyApiKey;
  };

  safeHandle("profile:upload-resume", async (_, filePath: string) => {
    try {
      // Premium gate: require active license or free trial for profile features
      if (!isProOrTrialActive()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      console.log(`[IPC] profile:upload-resume called with: ${filePath}`);
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized. Please ensure API keys are configured.' };
      }
      const { DocType } = require('../premium/electron/knowledge/types');
      const result = await orchestrator.ingestDocument(filePath, DocType.RESUME);
      return result;
    } catch (error: any) {
      console.error('[IPC] profile:upload-resume error:', error);
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
      // Map new KnowledgeStatus back to legacy UI shape temporarily
      const status = orchestrator.getStatus();
      return {
        hasProfile: status.hasResume,
        profileMode: status.activeMode,
        isReady: status.isReady,
        name: status.resumeSummary?.name,
        role: status.resumeSummary?.role,
        totalExperienceYears: status.resumeSummary?.totalExperienceYears
      };
    } catch (error: any) {
      return { hasProfile: false, profileMode: false, isReady: false };
    }
  });

  safeHandle("profile:set-mode", async (_, enabled: boolean) => {
    try {
      // Premium gate: only allow enabling profile mode with active license or free trial
      if (enabled && !isProOrTrialActive()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      orchestrator.setKnowledgeMode(enabled);

      const { SettingsManager } = require('./services/SettingsManager');
      SettingsManager.getInstance().set('knowledgeMode', enabled);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('profile-mode-changed', enabled);
        }
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:delete", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const { DocType } = require('../premium/electron/knowledge/types');
      orchestrator.deleteDocumentsByType(DocType.RESUME);
      return { success: true };
    } catch (error: any) {
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
          error: 'PRO_REQUIRED',
          engineReady: false,
        };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return null;
      const status = orchestrator.getStatus?.() || {};
      return {
        ...(orchestrator.getProfileData() || {}),
        hasResume: !!(status as any).hasResume,
        engineReady: !!orchestrator.isEngineReady?.()
      };
    } catch (error: any) {
      return null;
    }
  });

  safeHandle('get-tavily-key', async () => {
    return getTavilyKey();
  });

  safeHandle("profile:select-file", async () => {
    try {
      const result = await showOpenDialogNormalized({
        properties: ['openFile'],
        filters: [
          { name: 'Resume Files', extensions: ['pdf', 'docx', 'txt'] }
        ]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true };
      }

      return { success: true, filePath: result.filePaths[0] };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // JD & Research IPC Handlers
  // ==========================================

  safeHandle("profile:upload-jd", async (_, filePath: string) => {
    try {
      // Premium gate
      if (!isProOrTrialActive()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      console.log(`[IPC] profile:upload-jd called with: ${filePath}`);
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized. Please ensure API keys are configured.' };
      }
      const { DocType } = require('../premium/electron/knowledge/types');
      const result = await orchestrator.ingestDocument(filePath, DocType.JD);
      return result;
    } catch (error: any) {
      console.error('[IPC] profile:upload-jd error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:delete-jd", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const { DocType } = require('../premium/electron/knowledge/types');
      orchestrator.deleteDocumentsByType(DocType.JD);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:research-company", async (_, companyName: string) => {
    try {
      // Premium gate
      if (!isProOrTrialActive()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const profileData = orchestrator.getProfileData();
      const tavilyApiKey = configureExplicitTavilyResearchProvider(orchestrator);
      if (!tavilyApiKey) {
        return { success: false, error: 'MISSING_API_KEY' };
      }
      const result = await orchestrator.runCompanyResearch?.(
        companyName,
        profileData?.activeJD?.title || '',
        { forceRefresh: true }
      );
      if (!result) {
        return { success: false, error: 'Company research flow unavailable' };
      }
      return { success: true, status: result.status, research: result.research ?? null };
    } catch (error: any) {
      console.error('[IPC] profile:research-company error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('run_company_research', async (_, payload: { company: string; role?: string; forceRefresh?: boolean }) => {
    try {
      if (!isProOrTrialActive()) {
        return { success: false, error: 'LICENSE_REQUIRED' };
      }
      if (!appState.isBootstrapReady()) {
        await appState.bootstrapPersistentState();
      }

      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'ENGINE_NOT_INITIALIZED' };
      }

      const tavilyApiKey = configureExplicitTavilyResearchProvider(orchestrator);
      if (!tavilyApiKey) {
        return { success: false, error: 'MISSING_API_KEY' };
      }

      const result = await orchestrator.runCompanyResearch?.(
        payload?.company || '',
        payload?.role || '',
        { forceRefresh: !!payload?.forceRefresh }
      );

      if (!result) {
        return { success: false, error: 'RESEARCH_UNAVAILABLE' };
      }

      return {
        success: true,
        status: result.status,
        research: result.research ?? null,
      };
    } catch (error: any) {
      console.error('[IPC] run_company_research error:', error);
      return {
        success: false,
        error: error?.message || 'UNKNOWN_ERROR',
      };
    }
  });

  safeHandle("profile:generate-negotiation", async (_, force: boolean = false) => {
    try {
      // Premium gate
      if (!isProOrTrialActive()) {
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine unavailable' };
      }
      if (typeof orchestrator.isEngineReady === 'function' && !orchestrator.isEngineReady()) {
        const restoredScript = orchestrator.getNegotiationScript?.();
        if (restoredScript) {
          return { success: true, script: restoredScript };
        }
        return { success: false, error: 'Knowledge engine is still restoring. Please try again in a moment.' };
      }
      const status = orchestrator.getStatus();
      if (!status.hasResume) {
        return { success: false, error: 'No resume loaded' };
      }

      // Use cache unless force-regenerating
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
        return { success: false, error: 'Could not generate negotiation script. Ensure a resume and job description are uploaded.' };
      }
      if (orchestrator.isNegotiationContextEnabled?.()) {
        orchestrator.setNegotiationContextEnabled(true);
        broadcastNegotiationStateChanged();
      }
      if (regenerated && hashChanged) {
        const aotState = appState.getAOTState();
        BrowserWindow.getAllWindows().forEach(win => {
          if (!win.isDestroyed()) {
            win.webContents.send('negotiation_regenerated', {
              regenerated: true,
              updatedAt: aotState.negotiation.updatedAt,
              version: aotState.negotiation.version,
              hash: aotState.negotiation.hash
            });
          }
        });
      }
      return { success: true, script };
    } catch (error: any) {
      console.error('[IPC] profile:generate-negotiation error:', error);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // System Design Mode (renderer → main telemetry)
  // ==========================================

  safeHandle("overlay:log-system-design-mode", async (_, enabled: boolean) => {
    console.log(`[IPC] System Design Mode ${enabled ? 'ON' : 'OFF'}`);
    return { success: true };
  });

  safeHandle("profile:get-negotiation-state", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false, error: 'Engine not ready' };
      const tracker = orchestrator.getNegotiationTracker();
      return {
        success: true,
        enabled: orchestrator.isNegotiationContextEnabled?.() ?? tracker.isActive(),
        state: tracker.getState(),
        isActive: tracker.isActive(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:set-negotiation-context-enabled", async (_, enabled: boolean) => {
    try {
      if (!isProOrTrialActive()) {
        console.warn('[IPC] Negotiation toggle blocked — Pro license required');
        return { success: false, error: 'Pro license required. Please activate a license key to use Profile Intelligence features.' };
      }
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        console.warn('[IPC] Negotiation toggle blocked — engine not ready');
        return { success: false, error: 'Engine not ready' };
      }
      const hasScript = !!orchestrator.getNegotiationScript?.();
      if (enabled && !hasScript) {
        console.warn('[IPC] Negotiation toggle blocked — no script generated yet');
        return { success: false, error: 'Generate a negotiation script first.' };
      }
      const result = orchestrator.setNegotiationContextEnabled(Boolean(enabled));
      console.log(`[IPC] Negotiation context ${enabled ? 'ON' : 'OFF'} → phase=${result.state?.phase}`);
      broadcastNegotiationStateChanged();
      return {
        success: true,
        enabled: result.enabled,
        isActive: result.state.phase !== 'INACTIVE',
        state: result.state,
        hasScript,
      };
    } catch (error: any) {
      console.error('[IPC] Negotiation toggle error:', error.message);
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
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Profile Custom Notes
  // ==========================================

  safeHandle("profile:get-notes", async () => {
    try {
      const content = DatabaseManager.getInstance().getCustomNotes();
      return { success: true, content };
    } catch (error: any) {
      return { success: false, content: '', error: error.message };
    }
  });

  safeHandle("profile:save-notes", async (_, content: string) => {
    try {
      // Enforce a max length of 4000 chars to prevent prompt bloat
      const trimmed = typeof content === 'string' ? content.slice(0, 4000) : '';
      DatabaseManager.getInstance().saveCustomNotes(trimmed);

      // Propagate to orchestrator (premium path) and LLMHelper (all-provider path)
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (orchestrator?.setCustomNotes) orchestrator.setCustomNotes(trimmed);

      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      if (llmHelper?.setCustomNotes) llmHelper.setCustomNotes(trimmed);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Custom Context Toggle (overlay real-time control)
  // ==========================================

  safeHandle("set-custom-notes-enabled", async (_, enabled: boolean) => {
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
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("get-custom-notes-enabled", async () => {
    try {
      const llmHelper = appState.processingHelper?.getLLMHelper?.();
      return { success: true, enabled: llmHelper?.getCustomNotesEnabled?.() ?? true };
    } catch (error: any) {
      return { success: false, enabled: true, error: error.message };
    }
  });

  // ==========================================
  // Tavily Search API Credentials
  // ==========================================

  safeHandle("set-tavily-api-key", async (_, apiKey: string) => {
    try {
      if (apiKey && !apiKey.startsWith('tvly-')) {
        return { success: false, error: 'Invalid Tavily API key. Keys must start with "tvly-".' };
      }
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().setTavilyApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Overlay Opacity (Stealth Mode)
  // ==========================================

  safeHandle("set-overlay-opacity", async (_, opacity: number) => {
    // Clamp to valid range
    const clamped = Math.min(1.0, Math.max(0.35, opacity));
    // Broadcast to all renderer windows so the overlay picks it up in real-time
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('overlay-opacity-changed', clamped);
      }
    });
    return;
  });

  // ── Permissions ──────────────────────────────────────────────
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

  safeHandle("permissions:openSettings", async (_, permission: PermissionKind) => {
    return permissionManager.openSettings(permission);
  });

  // ==========================================
  // Modes IPC Handlers
  // ==========================================

  const isGeneralModeId = (mgr: any, modeId: string): boolean =>
    mgr.getModes().some((mode: any) => mode.id === modeId && mode.templateType === 'general');

  const ownsGeneralSection = (mgr: any, sectionId: string): boolean =>
    mgr.getState().userModes.some((mode: any) =>
      mode.templateId === 'general' && mode.notesTemplate.some((section: any) => section.id === sectionId)
    );

  const ownsGeneralReferenceFile = (mgr: any, fileId: string): boolean =>
    mgr.getState().userModes.some((mode: any) =>
      mode.templateId === 'general' && mode.referenceFiles.some((file: any) => file.id === fileId)
    );

  safeHandle("modes:get-state", async () => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      return ModesManager.getInstance().getState();
    } catch (e: any) {
      console.error('[IPC] modes:get-state error:', e);
      return {
        templates: [],
        userModes: [],
        selectedModeId: null,
        activeModeId: null,
      };
    }
  });

  safeHandle("modes:get-templates", async () => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      return ModesManager.getInstance().getTemplates();
    } catch (e: any) {
      console.error('[IPC] modes:get-templates error:', e);
      return [];
    }
  });

  safeHandle("modes:get-all", async () => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      const modes = mgr.getModes();
      // Attach reference file counts
      return modes.map((m: any) => ({
        ...m,
        referenceFileCount: mgr.getReferenceFiles(m.id).length,
      }));
    } catch (e: any) {
      console.error('[IPC] modes:get-all error:', e);
      return [];
    }
  });

  safeHandle("modes:get-active", async () => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      return ModesManager.getInstance().getActiveMode();
    } catch (e: any) {
      console.error('[IPC] modes:get-active error:', e);
      return null;
    }
  });

  safeHandle("modes:create", async (_, params: { name?: string; templateType?: string; templateId?: string }) => {
    try {
      if (!isProOrTrialActive()) return { success: false, error: 'pro_required' };
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      const mode = mgr.createMode({
        name: params.name,
        templateId: (params.templateId ?? params.templateType ?? 'general') as any,
      });
      broadcastModesState();
      return { success: true, mode, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:create error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle("modes:update", async (_, id: string, updates: { name?: string; templateType?: string; templateId?: string; customContext?: string; userPrompt?: string }) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      // Gate: changing templateType to a non-general template requires pro.
      // Also gate if the existing mode is already non-general (editing a pro mode requires pro).
      if (!isProOrTrialActive()) {
        const requestedTemplate = updates.templateId ?? updates.templateType;
        if (requestedTemplate && requestedTemplate !== 'general') {
          return { success: false, error: 'pro_required' };
        }
        const existing = mgr.getModes().find((m: any) => m.id === id);
        if (existing && existing.templateType !== 'general') {
          return { success: false, error: 'pro_required' };
        }
      }
      mgr.updateMode(id, updates);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:update error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle("modes:delete", async (_, id: string) => {
    try {
      if (!isProOrTrialActive()) return { success: false, error: 'pro_required' };
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      mgr.deleteMode(id);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:delete error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle("modes:set-selected", async (_, id: string | null) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      mgr.setSelectedMode(id);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:set-selected error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle("modes:set-active", async (_, id: string | null) => {
    try {
      // Allow clearing (null) or setting general mode without pro; all other modes require pro
      if (id !== null) {
        const { ModesManager } = require('./services/ModesManager');
        const targetMode = ModesManager.getInstance().getModes().find((m: any) => m.id === id);
        if (targetMode && targetMode.templateType !== 'general' && !isProOrTrialActive()) {
          return { success: false, error: 'pro_required' };
        }
      }
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      mgr.setActiveMode(id);
      const activeMode = id ? mgr.getModes().find((m: any) => m.id === id) : null;
      console.log(`[IPC] modes:set-active → id: ${id}, name: "${activeMode?.name ?? '(none)'}", template: ${activeMode?.templateType ?? 'N/A'}`);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:set-active error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle("modes:get-reference-files", async (_, modeId: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      return ModesManager.getInstance().getReferenceFiles(modeId);
    } catch (e: any) {
      console.error('[IPC] modes:get-reference-files error:', e);
      return [];
    }
  });

  safeHandle("modes:upload-reference-file", async (_, modeId: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !isGeneralModeId(mgr, modeId)) return { success: false, error: 'pro_required' };
      const result = await showOpenDialogNormalized({
        properties: ['openFile'],
        filters: [
          { name: 'Text & Documents', extensions: ['txt', 'md', 'pdf', 'docx'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePaths.length) {
        return { success: false, cancelled: true };
      }
      const filePath = result.filePaths[0];
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();

      let content = '';
      if (ext === '.md') {
        content = fs.readFileSync(filePath, 'utf8');
      } else {
        const { extractDocumentText } = require('../premium/electron/knowledge/DocumentReader');
        content = await extractDocumentText(filePath);
      }

      if (!content.trim()) {
        return { success: false, error: 'No readable text found in the selected file.' };
      }

      const file = mgr.addReferenceFile({ modeId, fileName, content, filePath });
      broadcastModesState();
      return { success: true, file, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:upload-reference-file error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle("modes:delete-reference-file", async (_, id: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !ownsGeneralReferenceFile(mgr, id)) return { success: false, error: 'pro_required' };
      mgr.deleteReferenceFile(id);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:delete-reference-file error:', e);
      return { success: false, error: e.message };
    }
  });

  // ── Note Sections ──────────────────────────────────────────────

  safeHandle("modes:get-note-sections", async (_, modeId: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      return ModesManager.getInstance().getNoteSections(modeId);
    } catch (e: any) {
      console.error('[IPC] modes:get-note-sections error:', e);
      return [];
    }
  });

  safeHandle("modes:add-note-section", async (_, modeId: string, title: string, description: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !isGeneralModeId(mgr, modeId)) return { success: false, error: 'pro_required' };
      const section = mgr.addNoteSection({ modeId, title, description });
      broadcastModesState();
      return { success: true, section, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:add-note-section error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle("modes:update-note-section", async (_, id: string, updates: { title?: string; description?: string }) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !ownsGeneralSection(mgr, id)) return { success: false, error: 'pro_required' };
      mgr.updateNoteSection(id, updates);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:update-note-section error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle("modes:delete-note-section", async (_, id: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !ownsGeneralSection(mgr, id)) return { success: false, error: 'pro_required' };
      mgr.deleteNoteSection(id);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:delete-note-section error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle("modes:remove-all-note-sections", async (_, modeId: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !isGeneralModeId(mgr, modeId)) return { success: false, error: 'pro_required' };
      mgr.removeAllNoteSections(modeId);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:remove-all-note-sections error:', e);
      return { success: false, error: e.message };
    }
  });

  safeHandle("modes:reset-note-sections", async (_, modeId: string) => {
    try {
      const { ModesManager } = require('./services/ModesManager');
      const mgr = ModesManager.getInstance();
      if (!isProOrTrialActive() && !isGeneralModeId(mgr, modeId)) return { success: false, error: 'pro_required' };
      mgr.resetNoteSections(modeId);
      broadcastModesState();
      return { success: true, state: mgr.getState() };
    } catch (e: any) {
      console.error('[IPC] modes:reset-note-sections error:', e);
      return { success: false, error: e.message };
    }
  });
}
