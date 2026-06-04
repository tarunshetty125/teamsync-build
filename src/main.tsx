import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"

const THEME_CACHE_KEY = 'teamsync_resolved_theme';
const THEME_MODE_CACHE_KEY = 'teamsync_theme_mode';

// Set platform attribute synchronously — before React renders — so CSS selectors
// like html[data-platform="win32"] work immediately without a flash on first paint.
document.documentElement.setAttribute(
  'data-platform',
  window.electronAPI?.platform ?? (typeof process !== 'undefined' ? process.platform : '')
);

// Step 1: Apply cached theme synchronously — before React renders.
// First launch defaults to dark. Once the user chooses a theme, the resolved
// value is cached and reused to avoid a flash before the main process replies.
const cachedThemeMode = localStorage.getItem(THEME_MODE_CACHE_KEY) as 'system' | 'light' | 'dark' | null;
const cachedTheme = cachedThemeMode
  ? localStorage.getItem(THEME_CACHE_KEY) as 'light' | 'dark' | null
  : null;
document.documentElement.setAttribute('data-theme', cachedTheme ?? 'dark');

// Step 2: Confirm/correct from main process (authoritative) and keep cache in sync.
if (window.electronAPI?.getThemeMode) {
  window.electronAPI.getThemeMode().then(({ mode, resolved }) => {
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem(THEME_MODE_CACHE_KEY, mode);
    localStorage.setItem(THEME_CACHE_KEY, resolved);
  });

  window.electronAPI?.onThemeChanged?.(({ mode, resolved }) => {
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem(THEME_MODE_CACHE_KEY, mode);
    localStorage.setItem(THEME_CACHE_KEY, resolved);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
