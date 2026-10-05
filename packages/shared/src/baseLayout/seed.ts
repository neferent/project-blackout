import { baseLayoutConfigSchema, type BaseLayoutConfig, type BaseLayoutConfigInput } from "./config.js";

/** Seed rule set. Everything here is data; see docs/base-layout.md for the format. */
const seed: BaseLayoutConfigInput = {
  version: 1,
  bonusCap: 0.25,
  maxPenalty: 0.5,
  items: [
    // --- Stations ---
    {
      id: "forge", name: "Forge", kind: "station", slots: ["indoor", "paved", "yard"],
      tags: ["workstation", "heat"], weight: 8, size: 3, placeHours: 2, moveBaseHours: 0.5,
      capabilities: ["heat", "smelting"],
    },
    {
      id: "anvil", name: "Anvil", kind: "station", slots: ["indoor", "paved", "yard"],
      tags: ["workstation"], weight: 10, size: 2, placeHours: 1, moveBaseHours: 0.5,
      capabilities: ["hammering"],
    },
    {
      id: "workbench", name: "Workbench", kind: "station", slots: ["indoor", "paved"],
      tags: ["workstation"], weight: 6, size: 3, placeHours: 1.5, moveBaseHours: 0.4,
      capabilities: ["assembly"], daylightBonus: 0.04,
    },
    {
      id: "still", name: "Still", kind: "station", slots: ["indoor"],
      tags: ["workstation", "chemistry"], weight: 4, size: 2, placeHours: 1.5, moveBaseHours: 0.3,
      capabilities: ["distilling"], daylightBonus: 0.03,
    },
    {
      id: "garden_plot", name: "Garden plot", kind: "station", slots: ["garden"],
      tags: ["food"], weight: 2, size: 3, placeHours: 1, moveBaseHours: 0.2,
      capabilities: ["growing"],
    },
    {
      id: "storage_shelf", name: "Storage shelf", kind: "station", slots: ["indoor", "paved", "yard"],
      tags: ["storage", "flammable"], weight: 3, size: 2, placeHours: 0.5, moveBaseHours: 0.2,
      capabilities: ["storage"],
    },
    // --- Attachments ---
    {
      id: "vice", name: "Vice", kind: "attachment", slots: ["indoor", "paved", "yard"],
      tags: ["tool"], weight: 3, size: 1, placeHours: 0.3, moveBaseHours: 0.1,
      grants: ["clamping"],
    },
    {
      id: "tool_rack", name: "Tool rack", kind: "attachment", slots: ["indoor", "paved", "yard"],
      tags: ["tool", "flammable"], weight: 2, size: 1, placeHours: 0.3, moveBaseHours: 0.1,
      grants: ["tools"],
    },
    {
      id: "bellows", name: "Bellows", kind: "attachment", slots: ["indoor", "paved", "yard"],
      tags: ["tool"], weight: 2, size: 1, placeHours: 0.3, moveBaseHours: 0.1,
      grants: ["forced_air"], sides: [3],
    },
    {
      id: "quench_barrel", name: "Quench barrel", kind: "attachment", slots: ["indoor", "paved", "yard"],
      tags: ["tool"], weight: 5, size: 1, placeHours: 0.3, moveBaseHours: 0.2,
      grants: ["quenching"],
    },
    {
      id: "grindstone", name: "Grindstone", kind: "attachment", slots: ["indoor", "paved", "yard"],
      tags: ["tool"], weight: 6, size: 1, placeHours: 0.4, moveBaseHours: 0.2,
      grants: ["grinding"],
    },
    {
      id: "lamp", name: "Work lamp", kind: "attachment", slots: ["indoor", "paved", "yard"],
      tags: ["tool"], weight: 1, size: 1, placeHours: 0.1, moveBaseHours: 0.05,
      grants: ["light"],
    },
    // --- Door ---
    {
      id: "door", name: "Door", kind: "door", slots: ["indoor", "paved", "yard"],
      weight: 5, size: 1, placeHours: 1, moveBaseHours: 0.5,
    },
  ],
  synergies: [
    { id: "forge-anvil", label: "Forge + anvil", a: "forge", b: "anvil", mode: "range", range: 2, falloff: 2, bonus: 0.1, farPenalty: 0.04 },
    { id: "bench-rack", label: "Workbench + tool rack", a: "workbench", b: "tool_rack", mode: "adjacent", bonus: 0.08, applies: "a" },
    { id: "bench-vice", label: "Workbench + vice", a: "workbench", b: "vice", mode: "adjacent", bonus: 0.06, applies: "a" },
    { id: "forge-bellows", label: "Forge + bellows", a: "forge", b: "bellows", mode: "adjacent", bonus: 0.05, applies: "a" },
    { id: "storage-near", label: "Storage nearby", a: "#workstation", b: "storage_shelf", mode: "range", range: 3, falloff: 3, bonus: 0.04, applies: "a" },
  ],
  hazards: [
    { id: "forge-flammable", a: "forge", b: "#flammable", within: 1, penalty: 0.1, message: "Forge beside flammable storage" },
    { id: "chem-food", a: "#chemistry", b: "#food", within: 2, penalty: 0.08, message: "Chemistry too close to food" },
  ],
};

export const SEED_BASE_LAYOUT_CONFIG: BaseLayoutConfig = baseLayoutConfigSchema.parse(seed);
