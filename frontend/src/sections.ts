import {
  LuHouse, LuWallet, LuArrowLeftRight, LuSprout, LuFlame, LuHammer,
} from "react-icons/lu";
import type { IconType } from "react-icons";
import type { SectionId } from "./theme";

export interface SectionDef {
  id: SectionId;
  label: string;
  icon: IconType;
  /**
   * For placeholder sections only: the milestone the section is expected to
   * ship in. Real, implemented sections omit this. Placeholders are acceptable
   * only during v1 development and must name their milestone.
   */
  milestone?: string;
}

/**
 * The full top-navigation, in display order. Dashboard and Earn (staking) are
 * live; the rest are placeholders until their milestone lands.
 */
export const SECTIONS: SectionDef[] = [
  { id: "dashboard", label: "Dashboard", icon: LuHouse },
  { id: "portfolio", label: "Portfolio", icon: LuWallet },
  { id: "trade", label: "Trade", icon: LuArrowLeftRight },
  { id: "earn", label: "Earn", icon: LuSprout },
  { id: "burner", label: "Burner", icon: LuFlame, milestone: "M5" },
  { id: "create", label: "Create", icon: LuHammer, milestone: "M6" },
];

/** Sections that render a "coming soon" placeholder card. */
export const PLACEHOLDER_SECTIONS = SECTIONS.filter((s) => s.milestone);
