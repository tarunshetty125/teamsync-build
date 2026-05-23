# TeamSync Codebase Map

Short version: this repo is a desktop app built with Vite + React for the UI, Electron for the desktop shell, a separate Node/Express backend for Google OAuth + MongoDB, and a Rust native module for audio-related system work. I excluded generated output like `dist-electron/` and `.agents/`.

## How Vite And Electron Work Together

1. `vite.config.mts` runs the React app in dev on `http://localhost:5180`.
2. `electron/main.ts` creates the desktop windows and loads either the Vite URL in dev or the built `dist/index.html` in production.
3. `electron/preload.ts` exposes a safe `window.electronAPI` bridge so the React app can call Electron features without direct Node access.
4. `electron/ipcHandlers.ts` is the main IPC router: it receives renderer requests and talks to audio, storage, auth, models, screenshots, and intelligence services.
5. `src/main.tsx` boots the React app, sets platform/theme state early, and mounts `App`.
6. `src/App.tsx` decides which window UI to render: launcher, overlay, settings, model selector, cropper, or onboarding.

## Architecture In One View

- Renderer: React + Vite UI in `src/`
- Desktop shell: Electron main process in `electron/`
- Bridge: `electron/preload.ts` + IPC handlers
- Backend: Express + MongoDB in `backend/`
- Native layer: Rust addon in `native-module/`
- Build tools: scripts in `scripts/`
- Premium layer: optional modules in `premium/` and `src/premium/`

## Root Files

- `package.json`: main app scripts, Electron/Vite build setup, and dependency list.
- `vite.config.mts`: Vite config, aliases, dev server port, and renderer chunk splitting.
- `tsconfig.json`: TypeScript config for the renderer app.
- `tsconfig.node.json`: TypeScript config for Node/Electron-side tooling.
- `postcss.config.js`: PostCSS setup for Tailwind builds.
- `tailwind.config.js`: Tailwind theme and content scanning config.
- `index.html`: Vite entry HTML for the renderer.
- `.env.example`: sample environment variables.
- `ocr_fallback.py`: Python fallback OCR path.
- `ocr_worker.py`: OCR worker process.
- `extract-ts.js`: helper script for extracting TypeScript-related content.
- `eng.traineddata`: Tesseract language data for OCR.
- `LICENSE`: project license.

## Backend Folder

### `backend/package.json`
- Defines the standalone backend server that handles OAuth, MongoDB user storage, and calendar validation.

### `backend/src/server.ts`
- Express server entry point.
- Connects to MongoDB, registers routes, exposes `/health`, and handles shutdown.

### `backend/src/routes/auth.ts`
- All Google auth and calendar endpoints.
- Handles OAuth start, callback polling, profile lookup, calendar fetch, and disconnect flow.

### `backend/src/services/googleAuth.ts`
- Google OAuth logic.
- Builds auth URLs, exchanges codes for tokens, stores users, signs JWTs, and fetches calendar events.

### `backend/src/db/mongodb.ts`
- MongoDB connection and collection helpers.
- Defines the user/session/license document shapes and creates indexes.

## Electron Folder

### Core Entry And Shell

- `electron/main.ts`: main process bootstrap, app state, window lifecycle, updates, permissions, audio, RAG, intelligence, and IPC wiring.
- `electron/preload.ts`: exposes the renderer API surface through `contextBridge`.
- `electron/ipcHandlers.ts`: maps renderer requests to Electron/native/backend actions.
- `electron/WindowHelper.ts`: creates and manages launcher/overlay windows.
- `electron/SettingsWindowHelper.ts`: opens and manages settings windows.
- `electron/ModelSelectorWindowHelper.ts`: manages the model picker window.
- `electron/CropperWindowHelper.ts`: manages the screenshot cropper window.
- `electron/ScreenshotHelper.ts`: captures screenshots and previews.
- `electron/ProcessingHelper.ts`: coordinates solution/debug processing.
- `electron/SessionTracker.ts`: tracks meeting/session lifecycle and state.
- `electron/ThemeManager.ts`: keeps the app theme in sync.
- `electron/verboseLog.ts`: controls verbose logging behavior.

### State, Storage, And Updates

- `electron/MeetingPersistence.ts`: saves and loads meeting data.
- `electron/ActionResponseCache.ts`: caches generated responses.
- `electron/ActionMetricsLogger.ts`: logs action timing and quality metrics.
- `electron/PromptDebugLogger.ts`: captures prompt/debug traces.
- `electron/update/ReleaseNotesManager.ts`: fetches and prepares release notes.
- `electron/DonationManager.ts`: handles donation-related flows.

### Permissions, Settings, And Input

- `electron/services/PermissionManager.ts`: macOS/Windows permission state and requests.
- `electron/services/SettingsManager.ts`: persistent app settings.
- `electron/services/CredentialsManager.ts`: API keys and trial credential storage.
- `electron/services/KeybindManager.ts`: global shortcut registration.
- `electron/services/StealthManager.ts`: stealth/disguise mode behavior.
- `electron/services/OllamaManager.ts`: local model download/runtime management.
- `electron/services/GoogleAuthManager.ts`: Electron-side auth coordination with the backend.
- `electron/services/ModesManager.ts`: mode selection and mode state.
- `electron/services/ModelVersionManager.ts`: model version tracking.
- `electron/services/InstallPingManager.ts`: install/telemetry ping flow.
- `electron/services/GroqKeyManager.ts`: Groq key handling.
- `electron/services/GroqClient.ts`: Groq client wrapper.

### Audio And Speech-To-Text

- `electron/audio/SystemAudioCapture.ts`: captures system audio.
- `electron/audio/MicrophoneCapture.ts`: captures microphone audio.
- `electron/audio/AudioDevices.ts`: enumerates audio devices.
- `electron/audio/SpeakerDiarizer.ts`: speaker separation and labeling.
- `electron/audio/nativeModuleLoader.ts`: loads the Rust addon.
- `electron/audio/OpenAIStreamingSTT.ts`: OpenAI streaming STT provider.
- `electron/audio/DeepgramStreamingSTT.ts`: Deepgram streaming STT provider.
- `electron/audio/GoogleSTT.ts`: Google STT integration.
- `electron/audio/ElevenLabsStreamingSTT.ts`: ElevenLabs STT provider.
- `electron/audio/SonioxStreamingSTT.ts`: Soniox STT provider.
- `electron/audio/RestSTT.ts`: REST-based STT fallback.
- `electron/audio/TeamSyncProSTT.ts`: TeamSync-provided STT path.
- `electron/audio/stt/SttSupervisor.ts`: chooses and supervises STT providers.
- `electron/audio/stt/SttRuntimeConfig.ts`: runtime STT settings.
- `electron/audio/stt/SttAdapter.ts`: shared STT adapter interface.
- `electron/audio/stt/DeepgramSttAdapter.ts`: Deepgram adapter implementation.
- `electron/audio/stt/GoogleStreamingSttAdapter.ts`: Google streaming adapter implementation.
- `electron/audio/stt/WhisperFallbackSttAdapter.ts`: Whisper fallback adapter.
- `electron/audio/stt/ElevenLabsShadowProbe.ts`: provider probing and fallback checks.
- `electron/audio/stt/SttLoadTester.ts`: STT stress/load testing.
- `electron/audio/stt/ReplayBuffer.ts`: keeps recent audio for recovery.
- `electron/audio/stt/WhisperWorker.ts`: worker for Whisper processing.

### Intelligence And RAG

- `electron/IntelligenceManager.ts`: high-level intelligence/session controller.
- `electron/IntelligenceEngine.ts`: core reasoning and action pipeline.
- `electron/LLMHelper.ts`: shared LLM orchestration helper.
- `electron/ActionContextBuilder.ts`: builds the prompt context.
- `electron/ActionOutputValidator.ts`: validates generated outputs.
- `electron/SummaryOutputValidator.ts`: validates summary outputs.
- `electron/PromptValidator.ts`: prompt shape and safety checks.
- `electron/TokenBudgetEnforcer.ts`: enforces token limits.
- `electron/PromptDebugLogger.ts`: prompt trace logging.
- `electron/db/DatabaseManager.ts`: local SQLite persistence for meetings, notes, and cache data.
- `electron/rag/RAGManager.ts`: retrieval pipeline coordinator.
- `electron/rag/VectorStore.ts`: vector storage and lookup.
- `electron/rag/EmbeddingPipeline.ts`: embedding generation pipeline.
- `electron/rag/LiveRAGIndexer.ts`: incremental indexing.
- `electron/rag/SemanticChunker.ts`: transcript chunking.
- `electron/rag/TranscriptPreprocessor.ts`: transcript cleanup before indexing.
- `electron/rag/RAGRetriever.ts`: retrieval logic.
- `electron/rag/EmbeddingProviderResolver.ts`: chooses embedding provider.
- `electron/rag/OllamaBootstrap.ts`: Ollama setup for embeddings.
- `electron/rag/vectorSearchWorker.ts`: worker for vector search.
- `electron/rag/prompts.ts`: RAG prompt templates.

### Intelligence Subsystems

- `electron/intelligence/brains/*`: domain-specific answer generators for coding, system design, behavioral, resume, screen analysis, and general responses.
- `electron/intelligence/planning/*`: plan generation and reasoning strategy.
- `electron/intelligence/confidence/*`: confidence scoring and normalization.
- `electron/intelligence/evidence/*`: evidence extraction and linking.
- `electron/intelligence/explainability/*`: explanation formatting and explainability output.
- `electron/intelligence/adaptive/*`: adaptive mode prediction and confidence signals.
- `electron/intelligence/timeline/*`: timeline event collection and signal emission.
- `electron/intelligence/memory/*`: short-term mode memory and retrieval.
- `electron/intelligence/capability/*`: capability registry and resolution.
- `electron/intelligence/resume/*`: resume/JD analysis.

### Calendar, Updates, And Utilities

- `electron/calendar/CalendarIntelligence.ts`: recommends meeting modes from calendar context.
- `electron/update/ReleaseNotesManager.ts`: release notes fetcher.
- `electron/utils/modelFetcher.ts`: downloads or resolves models.
- `electron/utils/emailUtils.ts`: email-related helpers.
- `electron/utils/curlUtils.ts`: curl parsing and conversion helpers.
- `electron/config/languages.ts`: STT and response language lists.

### Tests

- `electron/tests/*`: focused validation tests for action context, STT recovery, planning, speaker labeling, and related runtime behavior.

## Renderer Folder (`src/`)

### App Entrypoints

- `src/main.tsx`: React bootstrap and early theme/platform setup.
- `src/App.tsx`: top-level window router and app state coordinator.
- `src/index.css`: global styles and design tokens.
- `src/vite-env.d.ts`: Vite type declarations.

### Core Pages And Window Shells

- `src/_pages/Queue.tsx`: queue screen.
- `src/_pages/Solutions.tsx`: solution screen.
- `src/_pages/Debug.tsx`: debug screen.

### Main Components

- `src/components/TeamSyncInterface.tsx`: main launcher/assistant UI.
- `src/components/Launcher.tsx`: launcher window UI.
- `src/components/SettingsOverlay.tsx`: overlay settings panel.
- `src/components/SettingsPopup.tsx`: settings popup window.
- `src/components/ModelSelectorWindow.tsx`: model selection window UI.
- `src/components/Cropper.tsx`: screenshot selection UI.
- `src/components/GlobalChatOverlay.tsx`: chat overlay container.
- `src/components/MeetingChatOverlay.tsx`: meeting chat overlay.
- `src/components/SuggestionOverlay.tsx`: suggestion rendering layer.
- `src/components/ScreenScanOverlay.tsx`: screen scan UI.
- `src/components/StartupSequence.tsx`: startup bootstrap UI.
- `src/components/UpdateBanner.tsx`: update notice banner.
- `src/components/UpdateModal.tsx`: update dialog.
- `src/components/SupportToaster.tsx`: support/help prompts.
- `src/components/TeamSyncQuotaBanner.tsx`: quota status banner.
- `src/components/FeatureSpotlight.tsx`: feature highlight card.
- `src/components/AboutSection.tsx`: about/help content.
- `src/components/UpcomingEventsPanel.tsx`: calendar events panel.
- `src/components/FollowUpEmailModal.tsx`: follow-up email composer.
- `src/components/MeetingDetails.tsx`: meeting metadata/details view.
- `src/components/EditableTextBlock.tsx`: editable rich text block.
- `src/components/TopSearchPill.tsx`: compact search/input pill.
- `src/components/WindowControls.tsx`: window chrome controls.
- `src/components/TeamSyncLogoMark.tsx`: brand mark component.
- `src/components/EventCard.tsx`: calendar event card.

### Onboarding And Trials

- `src/components/onboarding/OnboardingFlow.tsx`: onboarding flow controller.
- `src/components/onboarding/WelcomeStep.tsx`: intro step.
- `src/components/onboarding/PermissionsStep.tsx`: permissions request step.
- `src/components/onboarding/PermissionCard.tsx`: permission card UI.
- `src/components/onboarding/ReadyStep.tsx`: completion step.
- `src/components/onboarding/GoogleSignIn.tsx`: Google sign-in UI.
- `src/components/onboarding/PermissionsToaster.tsx`: onboarding permission notices.
- `src/components/trial/FreeTrialBanner.tsx`: trial status banner.
- `src/components/trial/FreeTrialModal.tsx`: trial expiration modal.
- `src/components/trial/TrialPromoToaster.tsx`: trial promo notifications.

### Settings And UI Primitives

- `src/components/settings/Sidebar.tsx`: settings navigation.
- `src/components/settings/ProviderCard.tsx`: provider settings card.
- `src/components/settings/ModesSettings.tsx`: mode settings screen.
- `src/components/settings/AIProvidersSettings.tsx`: AI provider configuration.
- `src/components/settings/HelpSettings.tsx`: help and support settings.
- `src/components/settings/TeamSyncApiSettings.tsx`: TeamSync API settings.
- `src/components/ui/*`: reusable UI primitives like cards, dialogs, toasts, pills, buttons, drawers, transcripts, tables, and model selectors.

### Hooks, Stores, And Utilities

- `src/hooks/useProAccess.ts`: premium/pro access state.
- `src/hooks/useStreamBuffer.ts`: stream buffering helper.
- `src/hooks/useResolvedTheme.ts`: theme resolution hook.
- `src/hooks/useShortcuts.ts`: keyboard shortcut handling.
- `src/stores/usePermissionsStore.ts`: permissions state store.
- `src/lib/analytics/analytics.service.ts`: analytics tracking.
- `src/lib/permissions/utils.ts`: permission status helpers.
- `src/lib/permissions/types.ts`: permission type definitions.
- `src/lib/overlayAppearance.ts`: overlay opacity and appearance helpers.
- `src/lib/featureFlags.ts`: feature flag definitions.
- `src/lib/curl-validator.ts`: curl command validation.
- `src/lib/sttErrorMapper.ts`: maps STT errors to app-friendly messages.
- `src/lib/modes/*`: mode templates, types, and overlay config.
- `src/utils/*`: generic helpers for time, filtering, keyboard handling, platform checks, model parsing, transcript speaker formatting, PDF generation, and question detection.
- `src/config/*`: URL, language, and STT constants.
- `src/types/*`: shared TypeScript types for audio, solutions, and Electron bridge definitions.

### Premium Bridge

- `src/premium/index.tsx`: safe loader that imports premium UI/features when present and falls back to no-op components when they are not.

## Premium Folder

- `premium/src/*`: optional premium UI and feature modules loaded only when available.
- `premium/electron/*`: premium-only Electron services, licensing, and knowledge features.

## Native Module Folder

- `native-module/Cargo.toml`: Rust crate definition.
- `native-module/src/lib.rs`: native module entry point.
- `native-module/src/audio_config.rs`: audio config helpers.
- `native-module/src/microphone.rs`: microphone capture logic.
- `native-module/src/vad.rs`: voice activity detection.
- `native-module/src/resampler.rs`: audio resampling.
- `native-module/src/silence_suppression.rs`: silence handling.
- `native-module/src/license.rs`: native license helpers.
- `native-module/src/speaker/*`: platform-specific speaker capture/backing code.
- `native-module/index.js` / `index.d.ts`: JS bridge and typings for the Rust addon.

## Scripts Folder

- `scripts/build-electron.js`: builds the Electron side.
- `scripts/build-native.js`: builds the Rust/native module.
- `scripts/download-models.js`: downloads OCR/AI models.
- `scripts/ensure-sqlite-vec.js`: ensures the SQLite vector extension is available.
- `scripts/patch-electron-plist.js`: patches macOS plist entitlements.
- `scripts/ad-hoc-sign.js`: ad-hoc signing step for packaging.
- `scripts/raw-to-wav.js`: audio conversion helper.
- `scripts/VectorStoreRebuild.js`: rebuilds vector storage/indexes.

## Asset And Docs Folders

- `assets/`: packaged icons, entitlements, and macOS/Windows build resources.
- `resources/models/`: bundled AI/ML models.
- `docs/`: architecture notes, audits, and release docs.
- `.github/`: CI, release templates, and issue/PR templates.

## Mental Model For The Exam

- Vite is the renderer build system. It serves React in development and bundles it for production.
- Electron is the desktop container. `main.ts` owns windows, menus, tray, permissions, and native OS behavior.
- The renderer never talks to Node directly. It calls the preload bridge, which forwards to IPC handlers.
- The backend is separate from Electron. It runs Express on port `3456` for OAuth and MongoDB-backed account data.
- The Rust native module handles low-level audio and capture tasks that are awkward or slow in pure JS.

If you want, the next useful file would be a shorter one-page version of this that only lists the top 30 files you are most likely to be asked about.