<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SubgraphEdge, SubgraphNode } from "../types/api";

type Point = { x: number; y: number };
type EdgeGeometry = { from: Point; control: Point; to: Point };
type DragState =
  | { type: "node"; id: string }
  | { type: "pan"; startX: number; startY: number; originX: number; originY: number }
  | null;

const VIEWBOX_WIDTH = 1280;
const VIEWBOX_HEIGHT = 760;
const CENTER = { x: VIEWBOX_WIDTH / 2, y: VIEWBOX_HEIGHT / 2 };
const NODE_LABEL_ORDER = ["entity", "attribute", "keyword", "community"];
const RELATION_ORDER = [
  "has",
  "has_attribute",
  "owns",
  "uses",
  "transfers_to",
  "provides_to",
  "scores",
  "triggers",
  "member_of",
  "has_keyword",
  "represents_community",
  "represented_by",
  "represents_entity"
];
const EDGE_COLORS: Record<string, string> = {
  has: "oklch(0.82 0.17 92)",
  has_attribute: "oklch(0.70 0.18 36)",
  owns: "oklch(0.74 0.16 222)",
  uses: "oklch(0.76 0.17 184)",
  transfers_to: "oklch(0.68 0.20 28)",
  provides_to: "oklch(0.73 0.17 145)",
  scores: "oklch(0.76 0.18 304)",
  triggers: "oklch(0.72 0.20 14)",
  member_of: "oklch(0.72 0.18 270)",
  has_keyword: "oklch(0.80 0.17 68)",
  represents_community: "oklch(0.76 0.16 164)",
  represented_by: "oklch(0.72 0.17 332)",
  represents_entity: "oklch(0.74 0.18 248)"
};
const HOP_RINGS: Record<number, { rx: number; ry: number; label: string; labelX: number; labelY: number }> = {
  1: { rx: 210, ry: 136, label: "1-hop", labelX: CENTER.x + 156, labelY: CENTER.y - 118 },
  2: { rx: 390, ry: 252, label: "2-hop", labelX: CENTER.x + 330, labelY: CENTER.y - 232 },
  3: { rx: 548, ry: 334, label: "3-hop", labelX: CENTER.x + 486, labelY: CENTER.y - 310 }
};

const props = defineProps<{
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  hiddenRelations: string[];
  hiddenLabels?: string[];
  centerId?: string;
  selectedId?: string;
  selectedEdge?: SubgraphEdge | null;
  fullscreen?: boolean;
}>();

const emit = defineEmits<{
  selectNode: [node: SubgraphNode];
  selectEdge: [edge: SubgraphEdge];
  toggleLabel: [label: string];
  toggleRelation: [relation: string];
  toggleFullscreen: [];
}>();

const svgRef = ref<SVGSVGElement | null>(null);
const positions = ref<Record<string, Point>>({});
const dragState = ref<DragState>(null);
const viewport = ref({ x: 0, y: 0, scale: 1 });

const hiddenLabelSet = computed(() => new Set(props.hiddenLabels ?? []));
const drawableNodes = computed(() => props.nodes.filter((node) => !hiddenLabelSet.value.has(node.label)));
const drawableNodeIds = computed(() => new Set(drawableNodes.value.map((node) => node.id)));

const visibleEdges = computed(() =>
  props.edges.filter(
    (edge) =>
      !props.hiddenRelations.includes(edge.relation) &&
      drawableNodeIds.value.has(edge.source) &&
      drawableNodeIds.value.has(edge.target)
  )
);

const visibleNodeIds = computed(() => {
  const ids = new Set<string>();
  visibleEdges.value.forEach((edge) => {
    ids.add(edge.source);
    ids.add(edge.target);
  });
  if (props.centerId && drawableNodeIds.value.has(props.centerId)) ids.add(props.centerId);
  return ids;
});

const visibleNodes = computed(() => {
  if (!props.edges.length) return drawableNodes.value;
  return drawableNodes.value.filter((node) => visibleNodeIds.value.has(node.id));
});

const nodeById = computed(() => new Map(props.nodes.map((node) => [node.id, node])));
const isFullscreen = computed(() => Boolean(props.fullscreen));
const hasActiveCenter = computed(() => Boolean(props.centerId && nodeById.value.has(props.centerId)));
const canvasModeLabel = computed(() => (hasActiveCenter.value ? "Explore" : "Overview"));

const nodeLegend = computed(() => {
  const counts = new Map<string, number>();
  props.nodes.forEach((node) => counts.set(node.label, (counts.get(node.label) ?? 0) + 1));
  return sortWithOrder(Array.from(counts.entries()), NODE_LABEL_ORDER).map(([label, count]) => ({
    key: label,
    count,
    color: colorForLabel(label),
    hidden: hiddenLabelSet.value.has(label)
  }));
});

const edgeLegend = computed(() => {
  const counts = new Map<string, number>();
  props.edges.forEach((edge) => counts.set(edge.relation, (counts.get(edge.relation) ?? 0) + 1));
  return sortWithOrder(Array.from(counts.entries()), RELATION_ORDER).map(([relation, count]) => ({
    key: relation,
    count,
    color: edgeColorForRelation(relation),
    hidden: props.hiddenRelations.includes(relation)
  }));
});

const degreeByNode = computed(() => {
  const degrees = new Map<string, number>();
  visibleEdges.value.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  });
  return degrees;
});

const depthByNode = computed(() =>
  hasActiveCenter.value ? computeDepths(visibleNodes.value, visibleEdges.value) : new Map<string, number>()
);
const maxVisibleDepth = computed(() =>
  hasActiveCenter.value ? Math.max(0, ...visibleNodes.value.map((node) => Math.min(depthByNode.value.get(node.id) ?? 3, 3))) : 0
);

const neighborIds = computed(() => {
  const ids = new Set<string>();
  if (props.selectedId) {
    ids.add(props.selectedId);
    visibleEdges.value.forEach((edge) => {
      if (edge.source === props.selectedId) ids.add(edge.target);
      if (edge.target === props.selectedId) ids.add(edge.source);
    });
  }
  if (props.selectedEdge) {
    ids.add(props.selectedEdge.source);
    ids.add(props.selectedEdge.target);
  }
  return ids;
});

const layoutSignature = computed(() =>
  [
    props.centerId ?? "",
    props.nodes.map((node) => node.id).sort().join("|"),
    props.edges.map((edge) => `${edge.source}:${edge.relation}:${edge.target}`).sort().join("|")
  ].join("::")
);

watch(
  layoutSignature,
  () => {
    positions.value = computeInitialLayout(props.nodes, props.edges);
    viewport.value = { x: 0, y: 0, scale: 1 };
  },
  { immediate: true }
);

function sortWithOrder<T>(entries: Array<[string, T]>, order: string[]) {
  return entries.sort((a, b) => {
    const left = order.indexOf(a[0]);
    const right = order.indexOf(b[0]);
    const leftRank = left === -1 ? order.length : left;
    const rightRank = right === -1 ? order.length : right;
    return leftRank - rightRank || a[0].localeCompare(b[0]);
  });
}

function computeInitialLayout(nodes: SubgraphNode[], edges: SubgraphEdge[]) {
  if (!nodes.length) return {};
  return hasActiveCenter.value ? computeHopRingLayout(nodes, edges) : computeOverviewLayout(nodes, edges);
}

function computeHopRingLayout(nodes: SubgraphNode[], edges: SubgraphEdge[]) {
  return seedHopPositions(nodes, edges);
}

function seedHopPositions(nodes: SubgraphNode[], edges: SubgraphEdge[]) {
  const depths = computeDepths(nodes, edges);
  const layoutDegrees = computeDegrees(edges);
  const groups = new Map<number, SubgraphNode[]>();
  nodes.forEach((node) => {
    const depth = Math.min(depths.get(node.id) ?? 3, 3);
    groups.set(depth, [...(groups.get(depth) ?? []), node]);
  });

  const map: Record<string, Point> = {};
  const offsets: Record<number, number> = {
    0: -Math.PI / 2,
    1: -Math.PI / 2,
    2: -Math.PI / 2 + 0.34,
    3: -Math.PI / 2 - 0.18
  };

  Array.from(groups.entries()).forEach(([depth, group]) => {
    const ring = HOP_RINGS[depth] ?? HOP_RINGS[3];
    const sorted = group
      .slice()
      .sort((a, b) => (layoutDegrees.get(b.id) ?? 0) - (layoutDegrees.get(a.id) ?? 0) || a.id.localeCompare(b.id));

    sorted.forEach((node, index) => {
      if (depth === 0) {
        map[node.id] = { ...CENTER };
        return;
      }
      const angle = (offsets[depth] ?? offsets[3]) + (Math.PI * 2 * index) / Math.max(sorted.length, 1);
      const jitter = ((hashString(node.id) % 25) - 12) * 2.2;
      map[node.id] = {
        x: CENTER.x + Math.cos(angle) * (ring.rx + jitter),
        y: CENTER.y + Math.sin(angle) * (ring.ry + jitter * 0.45)
      };
    });
  });

  return map;
}

function computeOverviewLayout(nodes: SubgraphNode[], edges: SubgraphEdge[]) {
  const layoutDegrees = computeDegrees(edges);
  const groups = new Map<string, SubgraphNode[]>();
  nodes.forEach((node) => groups.set(node.label, [...(groups.get(node.label) ?? []), node]));

  const orderedGroups = sortWithOrder(Array.from(groups.entries()), NODE_LABEL_ORDER);
  const labelCount = orderedGroups.length;
  const map: Record<string, Point> = {};

  orderedGroups.forEach(([label, group], groupIndex) => {
    const sorted = group
      .slice()
      .sort((a, b) => (layoutDegrees.get(b.id) ?? 0) - (layoutDegrees.get(a.id) ?? 0) || a.id.localeCompare(b.id));
    const ring = overviewRing(label, groupIndex, labelCount);
    const start = -Math.PI / 2 + groupIndex * 0.22;

    if (sorted.length === 1 && labelCount === 1) {
      map[sorted[0].id] = { ...CENTER };
      return;
    }

    sorted.forEach((node, index) => {
      const angle = start + (Math.PI * 2 * index) / Math.max(sorted.length, 1);
      const jitter = ((hashString(node.id) % 19) - 9) * 1.8;
      map[node.id] = {
        x: CENTER.x + Math.cos(angle) * (ring.rx + jitter),
        y: CENTER.y + Math.sin(angle) * (ring.ry + jitter * 0.45)
      };
    });
  });

  return map;
}

function overviewRing(label: string, groupIndex: number, labelCount: number) {
  if (label === "community") return { rx: labelCount > 1 ? 165 : 410, ry: labelCount > 1 ? 108 : 270 };
  if (label === "keyword") return { rx: labelCount > 1 ? 332 : 420, ry: labelCount > 1 ? 216 : 276 };
  if (label === "attribute") return { rx: labelCount > 1 ? 552 : 430, ry: labelCount > 1 ? 338 : 280 };
  if (label === "entity" && labelCount > 1) return { rx: 284, ry: 176 };
  const base = 360 + groupIndex * 72;
  return { rx: Math.min(base, 548), ry: Math.min(226 + groupIndex * 46, 338) };
}

function computeDegrees(edges: SubgraphEdge[]) {
  const degrees = new Map<string, number>();
  edges.forEach((edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  });
  return degrees;
}

function computeDepths(nodes: SubgraphNode[], edges: SubgraphEdge[]) {
  const map = new Map<string, number>();
  const idSet = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();

  edges.forEach((edge) => {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) return;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  });

  const start = props.centerId && idSet.has(props.centerId) ? props.centerId : "";
  if (!start) return map;

  const queue = [start];
  map.set(start, 0);
  while (queue.length) {
    const current = queue.shift() as string;
    const nextDepth = (map.get(current) ?? 0) + 1;
    for (const next of adjacency.get(current) ?? []) {
      if (map.has(next)) continue;
      map.set(next, nextDepth);
      queue.push(next);
    }
  }
  return map;
}

function point(id: string) {
  return positions.value[id] ?? CENTER;
}

function graphTransform() {
  return `translate(${viewport.value.x} ${viewport.value.y}) scale(${viewport.value.scale})`;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function colorForLabel(label: string) {
  if (label === "community") return "var(--moss)";
  if (label === "keyword") return "var(--amber)";
  if (label === "attribute") return "var(--rust)";
  return "var(--cyan)";
}

function colorFor(node: SubgraphNode) {
  return colorForLabel(node.label);
}

function edgeColorForRelation(relation: string) {
  return EDGE_COLORS[relation] ?? "oklch(0.62 0.03 86 / 0.58)";
}

function edgeColor(edge: SubgraphEdge) {
  return edgeColorForRelation(edge.relation);
}

function legendStyle(color: string) {
  return { "--legend-color": color };
}

function radiusFor(node: SubgraphNode) {
  if (props.centerId === node.id) return 20;
  if (node.label === "community") return 17;
  if (node.label === "keyword") return 10;
  if (node.label === "attribute") return 7;
  const degree = degreeByNode.value.get(node.id) ?? 0;
  return Math.min(18, 10 + degree * 1.05);
}

function nodeDisplayName(node: SubgraphNode) {
  if (node.label === "attribute") {
    const value = stripPropertyPrefix(node.properties?.attr_value ?? node.properties?.value ?? node.properties?.name, node.properties?.attr_key);
    if (value) return value;
  }
  if (node.label === "community") return communityDisplayName(node);
  const name = stripPropertyPrefix(node.properties?.name, node.properties?.attr_key);
  return name || node.display_id || stripInternalId(node.id);
}

function communityDisplayName(node: SubgraphNode) {
  const representative = typeof node.properties?.representative === "string" ? node.properties.representative : "";
  if (representative) return `${nodeReferenceLabel(representative)}社区`;

  const keywordEntities = Array.isArray(node.properties?.keyword_entities) ? node.properties.keyword_entities : [];
  const firstKeyword = keywordEntities.find((item): item is string => typeof item === "string");
  if (firstKeyword) return `${nodeReferenceLabel(firstKeyword)}社区`;

  const name = stripPropertyPrefix(node.properties?.name, node.properties?.attr_key);
  if (name && !/^community[_-]/i.test(name)) return name;
  return node.display_id || stripInternalId(node.id);
}

function nodeReferenceLabel(id: string) {
  const node = nodeById.value.get(id);
  if (!node) return stripInternalId(id);
  if (node.label === "attribute") {
    const value = stripPropertyPrefix(node.properties?.attr_value ?? node.properties?.value ?? node.properties?.name, node.properties?.attr_key);
    if (value) return value;
  }
  return stripPropertyPrefix(node.properties?.name, node.properties?.attr_key) || node.display_id || stripInternalId(node.id);
}

function stripInternalId(value: string) {
  if (value.startsWith("attr::")) {
    const parts = value.split("::");
    return parts[2] || value.replace(/^attr::/, "");
  }
  return value;
}

function stripPropertyPrefix(value: unknown, key?: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (text.startsWith("attr::")) return stripInternalId(text);
  const keyText = typeof key === "string" ? key.trim() : "";
  if (keyText && text.startsWith(`${keyText}:`)) return text.slice(keyText.length + 1).trim();
  return text.replace(/^(description|risk_level|schema_type|type|domain|owner|region|entity_class):\s*/i, "").trim();
}

function shortLabel(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 16)}...`;
}

function shouldShowLabel(node: SubgraphNode) {
  if (node.id === props.centerId || node.id === props.selectedId) return true;
  if (props.selectedEdge && (props.selectedEdge.source === node.id || props.selectedEdge.target === node.id)) return true;
  if (node.label === "community") return true;
  if (visibleNodes.value.length <= 28 && node.label !== "attribute") return true;
  return (degreeByNode.value.get(node.id) ?? 0) >= 5 && node.label !== "attribute";
}

function edgeGeometry(edge: SubgraphEdge, index: number): EdgeGeometry {
  const sourceCenter = point(edge.source);
  const targetCenter = point(edge.target);
  const sourceNode = nodeById.value.get(edge.source);
  const targetNode = nodeById.value.get(edge.target);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const unitX = dx / distance;
  const unitY = dy / distance;
  const sourceGap = (sourceNode ? radiusFor(sourceNode) : 10) + 5;
  const targetGap = (targetNode ? radiusFor(targetNode) : 10) + 13;
  const from = {
    x: sourceCenter.x + unitX * sourceGap,
    y: sourceCenter.y + unitY * sourceGap
  };
  const to = {
    x: targetCenter.x - unitX * targetGap,
    y: targetCenter.y - unitY * targetGap
  };
  const bend = ((hashString(`${edge.source}:${edge.target}:${edge.relation}:${index}`) % 7) - 3) * 7;
  const midX = (from.x + to.x) / 2 - (dy / distance) * bend;
  const midY = (from.y + to.y) / 2 + (dx / distance) * bend;
  return { from, control: { x: midX, y: midY }, to };
}

function edgePath(edge: SubgraphEdge, index: number) {
  const geometry = edgeGeometry(edge, index);
  return `M ${geometry.from.x} ${geometry.from.y} Q ${geometry.control.x} ${geometry.control.y} ${geometry.to.x} ${geometry.to.y}`;
}

function edgePoint(edge: SubgraphEdge, index: number, t: number) {
  const geometry = edgeGeometry(edge, index);
  const inverse = 1 - t;
  return {
    x: inverse * inverse * geometry.from.x + 2 * inverse * t * geometry.control.x + t * t * geometry.to.x,
    y: inverse * inverse * geometry.from.y + 2 * inverse * t * geometry.control.y + t * t * geometry.to.y
  };
}

function edgeTangent(edge: SubgraphEdge, index: number, t: number) {
  const geometry = edgeGeometry(edge, index);
  const inverse = 1 - t;
  return {
    x: 2 * inverse * (geometry.control.x - geometry.from.x) + 2 * t * (geometry.to.x - geometry.control.x),
    y: 2 * inverse * (geometry.control.y - geometry.from.y) + 2 * t * (geometry.to.y - geometry.control.y)
  };
}

function edgeArrowPoints(edge: SubgraphEdge, index: number, t = 1, length = 16, width = 8) {
  const tip = edgePoint(edge, index, t);
  const tangent = edgeTangent(edge, index, t);
  const distance = Math.max(Math.sqrt(tangent.x * tangent.x + tangent.y * tangent.y), 1);
  const unitX = tangent.x / distance;
  const unitY = tangent.y / distance;
  const base = {
    x: tip.x - unitX * length,
    y: tip.y - unitY * length
  };
  const normalX = -unitY;
  const normalY = unitX;
  return [
    `${tip.x},${tip.y}`,
    `${base.x + normalX * width},${base.y + normalY * width}`,
    `${base.x - normalX * width},${base.y - normalY * width}`
  ].join(" ");
}

function edgeMidpoint(edge: SubgraphEdge, index: number) {
  return edgePoint(edge, index, 0.5);
}

function isNodeDimmed(node: SubgraphNode) {
  return neighborIds.value.size > 0 && !neighborIds.value.has(node.id);
}

function isEdgeDimmed(edge: SubgraphEdge) {
  if (props.selectedEdge) return props.selectedEdge !== edge;
  if (!props.selectedId) return false;
  return edge.source !== props.selectedId && edge.target !== props.selectedId;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function screenToWorld(event: PointerEvent | WheelEvent) {
  const svg = svgRef.value;
  if (!svg) return { ...CENTER };
  const rect = svg.getBoundingClientRect();
  const svgX = ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
  const svgY = ((event.clientY - rect.top) / rect.height) * VIEWBOX_HEIGHT;
  return {
    x: (svgX - viewport.value.x) / viewport.value.scale,
    y: (svgY - viewport.value.y) / viewport.value.scale
  };
}

function beginNodeDrag(event: PointerEvent, node: SubgraphNode) {
  event.stopPropagation();
  (event.currentTarget as SVGGElement).setPointerCapture(event.pointerId);
  dragState.value = { type: "node", id: node.id };
}

function beginPan(event: PointerEvent) {
  if (event.button !== 0) return;
  dragState.value = {
    type: "pan",
    startX: event.clientX,
    startY: event.clientY,
    originX: viewport.value.x,
    originY: viewport.value.y
  };
}

function onPointerMove(event: PointerEvent) {
  const drag = dragState.value;
  if (!drag) return;
  if (drag.type === "node") {
    const world = screenToWorld(event);
    positions.value = {
      ...positions.value,
      [drag.id]: {
        x: clamp(world.x, 45, VIEWBOX_WIDTH - 45),
        y: clamp(world.y, 45, VIEWBOX_HEIGHT - 45)
      }
    };
    return;
  }
  viewport.value = {
    ...viewport.value,
    x: drag.originX + event.clientX - drag.startX,
    y: drag.originY + event.clientY - drag.startY
  };
}

function endDrag() {
  dragState.value = null;
}

function onWheel(event: WheelEvent) {
  const before = screenToWorld(event);
  const factor = event.deltaY < 0 ? 1.12 : 0.88;
  const nextScale = clamp(viewport.value.scale * factor, 0.48, 2.6);
  const svg = svgRef.value;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const svgX = ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
  const svgY = ((event.clientY - rect.top) / rect.height) * VIEWBOX_HEIGHT;
  viewport.value = {
    scale: nextScale,
    x: svgX - before.x * nextScale,
    y: svgY - before.y * nextScale
  };
}

function zoomBy(factor: number) {
  const nextScale = clamp(viewport.value.scale * factor, 0.48, 2.6);
  viewport.value = {
    scale: nextScale,
    x: CENTER.x - (CENTER.x - viewport.value.x) * (nextScale / viewport.value.scale),
    y: CENTER.y - (CENTER.y - viewport.value.y) * (nextScale / viewport.value.scale)
  };
}

function resetViewport() {
  viewport.value = { x: 0, y: 0, scale: 1 };
}

function resetLayout() {
  positions.value = computeInitialLayout(props.nodes, props.edges);
  resetViewport();
}

</script>

<template>
  <div class="graph-canvas" :class="{ panning: dragState?.type === 'pan', fullscreen: isFullscreen }">
    <div class="graph-control-strip">
      <div class="graph-control-copy">
        <strong>{{ canvasModeLabel }}</strong>
        <span>{{ visibleNodes.length }} nodes / {{ visibleEdges.length }} edges</span>
      </div>
      <div class="graph-control-actions">
        <button type="button" class="icon-control" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" :aria-label="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="emit('toggleFullscreen')">
          {{ isFullscreen ? "Esc" : "⛶" }}
        </button>
        <button type="button" title="Zoom out" @click="zoomBy(0.86)">-</button>
        <span>{{ Math.round(viewport.scale * 100) }}%</span>
        <button type="button" title="Zoom in" @click="zoomBy(1.16)">+</button>
        <button type="button" title="Reset viewport" @click="resetViewport">Fit</button>
        <button type="button" title="Re-run layout" @click="resetLayout">Layout</button>
      </div>
    </div>

    <aside v-if="nodes.length" class="graph-map-legend" aria-label="Graph legend">
      <section v-if="nodeLegend.length">
        <h4>Nodes <span>({{ nodes.length }})</span></h4>
        <div class="legend-stack">
          <button
            v-for="item in nodeLegend"
            :key="item.key"
            type="button"
            class="legend-node-pill"
            :class="{ muted: item.hidden }"
            :style="legendStyle(item.color)"
            :aria-pressed="!item.hidden"
            :title="item.hidden ? `Show ${item.key}` : `Hide ${item.key}`"
            @click="emit('toggleLabel', item.key)"
          >
            <i></i>
            <b>{{ item.key }}</b>
            <em>{{ item.count }}</em>
          </button>
        </div>
      </section>
      <section v-if="edgeLegend.length">
        <h4>Edges <span>({{ edges.length }})</span></h4>
        <div class="legend-stack">
          <button
            v-for="item in edgeLegend"
            :key="item.key"
            type="button"
            class="legend-edge-pill"
            :class="{ muted: item.hidden }"
            :style="legendStyle(item.color)"
            :aria-pressed="!item.hidden"
            :title="item.hidden ? `Show ${item.key}` : `Hide ${item.key}`"
            @click="emit('toggleRelation', item.key)"
          >
            <i></i>
            <b>{{ item.key }}</b>
            <em>{{ item.count }}</em>
          </button>
        </div>
      </section>
    </aside>

    <div v-if="!nodes.length" class="graph-empty">
      <strong>等待子图加载</strong>
      <span>选择 graph 后可直接加载，填写 node_id 时会按 hops 展开邻域</span>
    </div>
    <div v-else-if="!visibleNodes.length" class="graph-empty">
      <strong>当前筛选条件下没有可见节点</strong>
      <span>恢复部分关系或切换图层后再查看</span>
    </div>
    <svg
      v-else
      ref="svgRef"
      :viewBox="`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`"
      role="img"
      aria-label="Interactive subgraph canvas"
      @pointerdown="beginPan"
      @pointermove="onPointerMove"
      @pointerup="endDrag"
      @pointerleave="endDrag"
      @wheel.prevent="onWheel"
      @dblclick="resetViewport"
    >
      <g v-if="hasActiveCenter" class="ring-layer" aria-hidden="true">
        <g :transform="graphTransform()">
          <template v-for="depth in [1, 2, 3]" :key="depth">
            <ellipse v-if="maxVisibleDepth >= depth" :cx="CENTER.x" :cy="CENTER.y" :rx="HOP_RINGS[depth].rx" :ry="HOP_RINGS[depth].ry" />
            <text v-if="maxVisibleDepth >= depth" :x="HOP_RINGS[depth].labelX" :y="HOP_RINGS[depth].labelY">
              {{ HOP_RINGS[depth].label }}
            </text>
          </template>
        </g>
      </g>

      <g class="graph-world" :transform="graphTransform()">
        <g class="edge-layer">
          <g v-for="(edge, index) in visibleEdges" :key="`${edge.source}-${edge.target}-${edge.relation}-${index}`">
            <path
              :d="edgePath(edge, index)"
              class="graph-edge-hit"
              @click.stop="emit('selectEdge', edge)"
            />
            <path
              :d="edgePath(edge, index)"
              class="graph-edge"
              :class="{ selected: selectedEdge === edge, dimmed: isEdgeDimmed(edge) }"
              :stroke="edgeColor(edge)"
              @click.stop="emit('selectEdge', edge)"
            >
              <title>{{ edge.source }} -> {{ edge.target }} / {{ edge.relation }}</title>
            </path>
            <polygon
              class="graph-edge-flow"
              :class="{ selected: selectedEdge === edge, dimmed: isEdgeDimmed(edge) }"
              :points="edgeArrowPoints(edge, index, 0.62, 10, 5)"
              :fill="edgeColor(edge)"
              @click.stop="emit('selectEdge', edge)"
            />
            <polygon
              class="graph-edge-arrow"
              :class="{ selected: selectedEdge === edge, dimmed: isEdgeDimmed(edge) }"
              :points="edgeArrowPoints(edge, index)"
              :fill="edgeColor(edge)"
              @click.stop="emit('selectEdge', edge)"
            />
            <text
              v-if="selectedEdge === edge"
              :x="edgeMidpoint(edge, index).x"
              :y="edgeMidpoint(edge, index).y - 8"
              class="edge-label selected"
            >
              {{ edge.relation }}
            </text>
          </g>
        </g>

        <g class="node-layer">
          <g
            v-for="node in visibleNodes"
            :key="node.id"
            class="graph-node"
            :class="{
              selected: selectedId === node.id,
              center: centerId === node.id,
              dimmed: isNodeDimmed(node),
              dragging: dragState?.type === 'node' && dragState.id === node.id
            }"
            :transform="`translate(${point(node.id).x}, ${point(node.id).y})`"
            @pointerdown="beginNodeDrag($event, node)"
            @click.stop="emit('selectNode', node)"
          >
            <circle class="node-halo" :r="radiusFor(node) + 9" />
            <circle :r="radiusFor(node)" :fill="colorFor(node)" />
            <text v-if="shouldShowLabel(node)" :y="-(radiusFor(node) + 11)">{{ shortLabel(nodeDisplayName(node)) }}</text>
            <title>{{ nodeDisplayName(node) }} / {{ node.display_id || stripInternalId(node.id) }} / {{ node.label }}</title>
          </g>
        </g>
      </g>
    </svg>
  </div>
</template>

