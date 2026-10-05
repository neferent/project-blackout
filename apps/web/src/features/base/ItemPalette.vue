<script setup lang="ts">
import { computed } from "vue";
import { getItemDef, SEED_BASE_LAYOUT_CONFIG, type LayoutItemInstance } from "@blackout/shared";

const props = defineProps<{
  itemIds: string[];
  items: Record<string, LayoutItemInstance>;
  selectedId: string | null;
  disabled?: boolean;
}>();
defineEmits<{ (e: "down", payload: { itemId: string; clientX: number; clientY: number }): void }>();

const chips = computed(() =>
  props.itemIds
    .map((id) => {
      const instance = props.items[id];
      const def = instance && getItemDef(SEED_BASE_LAYOUT_CONFIG, instance.definitionId);
      return def ? { id, name: def.name, kind: def.kind, quality: instance.quality } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    // Stations first, then attachments, then the door; by name within a kind.
    .sort((a, b) => ["station", "attachment", "door"].indexOf(a.kind) - ["station", "attachment", "door"].indexOf(b.kind) || a.name.localeCompare(b.name)),
);
</script>

<template>
  <div class="palette" :class="{ disabled }">
    <p v-if="chips.length === 0" class="empty">Everything you own is placed.</p>
    <div
      v-for="chip in chips"
      :key="chip.id"
      class="chip"
      :class="[chip.kind, { selected: chip.id === selectedId }]"
      @pointerdown.prevent="!disabled && $emit('down', { itemId: chip.id, clientX: $event.clientX, clientY: $event.clientY })"
    >
      <span class="name">{{ chip.name }}</span>
      <span class="q">Q{{ chip.quality.toFixed(0) }}</span>
    </div>
  </div>
</template>

<style scoped>
.palette {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 150px;
  overflow-y: auto;
}
.palette.disabled {
  opacity: 0.5;
}
.empty {
  margin: 0;
  font-size: 12px;
  color: #8a8578;
}
.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid #55534a;
  border-radius: 4px;
  background: #1c1b17;
  font-size: 12px;
  touch-action: none;
  user-select: none;
  cursor: grab;
}
.chip.station {
  border-color: #8a6a2b;
}
.chip.door {
  border-color: #5f7f93;
}
.chip.selected {
  outline: 2px solid #f2d27a;
}
.q {
  color: #8a8578;
  font-size: 11px;
}
</style>
