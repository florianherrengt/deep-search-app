import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useRef } from "react";

import { isTauri } from "@/lib/tauri-bridge";

type UpdateSetting = (key: "zoom_level", value: number) => Promise<void>;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const STEP = 0.1;

// Round to 2 decimals so repeated 0.1 steps don't drift (0.1 + 0.1 + 0.1 ≠ 0.3 in float).
const roundZoom = (value: number): number => Math.round(value * 100) / 100;
const clampZoom = (value: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, roundZoom(value)));

/**
 * Applies the persisted webview zoom on hydration and exposes zoom actions.
 * Safe in browser-only dev (`npm run dev`): no-ops when not in the Tauri host.
 */
export function useWebviewZoom(
  zoomLevel: number,
  updateSetting: UpdateSetting,
  hydrated: boolean,
) {
  // Keep a ref current each render so the action callbacks stay stable (the
  // app menu is rebuilt when its deps change, and we don't want zoom steps to
  // trigger that).
  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  const applyZoom = useCallback((next: number) => {
    if (!isTauri()) return;
    getCurrentWebview().setZoom(next).catch((error) => {
      console.error("[zoom] Failed to apply zoom:", error);
    });
  }, []);

  // Apply the persisted level once the settings have hydrated.
  useEffect(() => {
    if (hydrated) applyZoom(zoomLevelRef.current);
  }, [hydrated, applyZoom]);

  const zoomIn = useCallback(() => {
    const next = clampZoom(zoomLevelRef.current + STEP);
    void updateSetting("zoom_level", next);
    applyZoom(next);
  }, [updateSetting, applyZoom]);

  const zoomOut = useCallback(() => {
    const next = clampZoom(zoomLevelRef.current - STEP);
    void updateSetting("zoom_level", next);
    applyZoom(next);
  }, [updateSetting, applyZoom]);

  const resetZoom = useCallback(() => {
    void updateSetting("zoom_level", 1);
    applyZoom(1);
  }, [updateSetting, applyZoom]);

  return { zoomIn, zoomOut, resetZoom };
}
