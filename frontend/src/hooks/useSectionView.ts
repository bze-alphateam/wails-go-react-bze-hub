import { useCallback, useEffect, useState } from "react";
import { GetSettings, UpdateSetting } from "../../wailsjs/go/main/App";
import type { SectionId } from "../theme";

export type SectionView = "simple" | "advanced";

/** Every section defaults to Simple on a fresh install. */
export const DEFAULT_SECTION_VIEW: SectionView = "simple";

/** Settings key under which a section's view preference is persisted. */
export function sectionViewKey(section: SectionId): string {
  return `view.${section}`;
}

function isSectionView(v: unknown): v is SectionView {
  return v === "simple" || v === "advanced";
}

export interface UseSectionView {
  /** The view to render right now. */
  view: SectionView;
  /** Switch view; the choice is persisted for this section. */
  setView: (v: SectionView) => void;
  /** True once the stored preference has been read (or an override applied). */
  loaded: boolean;
}

/**
 * Per-section Simple/Advanced view state, backed by app settings.
 *
 * - Defaults to Simple.
 * - Reads the stored preference for `section` on mount and persists any
 *   explicit user change via the Wails settings bindings.
 * - `override` (e.g. from a deep-link) forces the view for this visit only and
 *   is never persisted; the stored preference changes solely when the user
 *   flips the tab through `setView`.
 */
export function useSectionView(
  section: SectionId,
  override?: SectionView,
): UseSectionView {
  const [view, setViewState] = useState<SectionView>(
    override ?? DEFAULT_SECTION_VIEW,
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // A per-visit override wins over the stored value and short-circuits the
    // read — it must not persist, so we never touch it again here.
    if (override) {
      setViewState(override);
      setLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    GetSettings()
      .then((settings: Record<string, unknown>) => {
        if (cancelled) return;
        const stored = settings?.[sectionViewKey(section)];
        setViewState(isSectionView(stored) ? stored : DEFAULT_SECTION_VIEW);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setViewState(DEFAULT_SECTION_VIEW);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [section, override]);

  const setView = useCallback(
    (v: SectionView) => {
      setViewState(v);
      // Persist the user's explicit choice; failures are non-fatal (the UI
      // still reflects the change for this session).
      UpdateSetting(sectionViewKey(section), v).catch((e) => {
        console.error("persist section view:", e);
      });
    },
    [section],
  );

  return { view, setView, loaded };
}
