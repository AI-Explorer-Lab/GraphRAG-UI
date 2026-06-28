<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { fetchSubgraph } from "../api/client";
import type { SubgraphEdge, SubgraphNode, SubgraphResponse } from "../types/api";
import GraphCanvas from "./GraphCanvas.vue";

type LayerMode = "business" | "entity_attribute" | "semantic" | "full" | "custom";

const businessRelations = ["owns", "uses", "transfers_to", "provides_to", "scores", "triggers"];
const systemRelations = ["has_attribute", "member_of", "represents_community", "represented_by", "has_keyword", "represents_entity"];
const defaultHiddenRelations = ["has_attribute", "represents_community", "represented_by", "has_keyword", "represents_entity"];
const defaultHiddenLabels = ["attribute", "keyword", "community"];
const nodeLabels = ["entity", "attribute", "keyword", "community"];

const props = defineProps<{ graphId: string; graphIds?: string[]; centerNodeId?: string }>();
const emit = defineEmits<{ updateGraphId: [graphId: string] }>();

const localGraphId = ref(props.graphId);
const nodeId = ref("");
const activeCenterNodeId = ref("");
const hops = ref(2);
const loading = ref(false);
const error = ref("");
const subgraph = ref<SubgraphResponse | null>(null);
const hiddenRelations = ref<string[]>([...defaultHiddenRelations]);
const hiddenLabels = ref<string[]>([...defaultHiddenLabels]);
const layerMode = ref<LayerMode>("business");
const selectedNode = ref<SubgraphNode | null>(null);
const selectedEdge = ref<SubgraphEdge | null>(null);
const lastSearch = ref<{ nodeId: string; found: boolean } | null>(null);
const requestSerial = ref(0);

const graphOptions = computed(() => {
  return [...(props.graphIds ?? [])].sort();
});

const layerModes: Array<{ value: LayerMode; label: string; description: string }> = [
  { value: "business", label: "业务主干", description: "只看实体和业务关系" },
  { value: "entity_attribute", label: "实体 + 属性", description: "排查字段、标签和属性节点" },
  { value: "semantic", label: "语义聚合", description: "加入关键词和社区聚合层" },
  { value: "full", label: "完整四层", description: "展示后端返回的全部层级" }
];

watch(
  () => props.graphId,
  (value) => {
    localGraphId.value = value;
    nodeId.value = "";
    if (value) void loadGraphOverview(value);
    else clearGraphState();
  },
  { immediate: true }
);

watch(
  () => props.centerNodeId,
  (value) => {
    if (!value) return;
    nodeId.value = value;
    localGraphId.value = props.graphId;
    void searchNode(value);
  },
  { immediate: true }
);

const relationCounts = computed(() => {
  const counts = new Map<string, number>();
  subgraph.value?.edges.forEach((edge) => counts.set(edge.relation, (counts.get(edge.relation) ?? 0) + 1));
  return counts;
});

const visibleBusinessRelations = computed(() => businessRelations.filter((relation) => (relationCounts.value.get(relation) ?? 0) > 0));
const visibleSystemRelations = computed(() => systemRelations.filter((relation) => (relationCounts.value.get(relation) ?? 0) > 0));

const labelCounts = computed(() => {
  const counts = new Map<string, number>();
  subgraph.value?.nodes.forEach((node) => counts.set(node.label, (counts.get(node.label) ?? 0) + 1));
  return counts;
});

const nodeById = computed(() => new Map((subgraph.value?.nodes ?? []).map((node) => [node.id, node])));
const hiddenLabelSet = computed(() => new Set(hiddenLabels.value));
const drawableNodes = computed(() => (subgraph.value?.nodes ?? []).filter((node) => !hiddenLabelSet.value.has(node.label)));
const drawableNodeIds = computed(() => new Set(drawableNodes.value.map((node) => node.id)));

const visibleEdges = computed(() =>
  (subgraph.value?.edges ?? []).filter(
    (edge) =>
      !hiddenRelations.value.includes(edge.relation) &&
      drawableNodeIds.value.has(edge.source) &&
      drawableNodeIds.value.has(edge.target)
  )
);

const visibleNodes = computed(() => {
  if (!subgraph.value?.edges.length) return drawableNodes.value;
  const ids = new Set<string>();
  visibleEdges.value.forEach((edge) => {
    ids.add(edge.source);
    ids.add(edge.target);
  });
  if (activeCenterNodeId.value && drawableNodeIds.value.has(activeCenterNodeId.value)) ids.add(activeCenterNodeId.value);
  return drawableNodes.value.filter((node) => ids.has(node.id));
});

const selectedNodeAttributes = computed(() => {
  if (!selectedNode.value || !subgraph.value) return [];
  return subgraph.value.edges
    .filter((edge) => edge.relation === "has_attribute" && edge.source === selectedNode.value?.id)
    .map((edge) => nodeById.value.get(edge.target))
    .filter((node): node is SubgraphNode => Boolean(node))
    .slice(0, 18);
});

const hasAttributesVisible = computed(() => !hiddenLabels.value.includes("attribute"));
const activeLayerDescription = computed(() => layerModes.find((item) => item.value === layerMode.value)?.description ?? "自定义筛选");

const searchedNode = computed(() => {
  if (!lastSearch.value?.found) return null;
  return nodeById.value.get(lastSearch.value.nodeId) ?? null;
});

const searchLayerMatches = computed(() => {
  if (!searchedNode.value) return [];
  return layerModes
    .filter((mode) => !hiddenLabelsForMode(mode.value).includes(searchedNode.value?.label ?? ""))
    .map((mode) => mode.label);
});

const searchResultText = computed(() => {
  if (!lastSearch.value) return "";
  if (!lastSearch.value.found) return `没有在当前 graph 中找到节点 ${lastSearch.value.nodeId}`;
  const node = searchedNode.value;
  if (!node) return `节点 ${lastSearch.value.nodeId} 不在当前返回结果中`;
  if (hiddenLabelSet.value.has(node.label)) {
    return `已找到 ${displayNodeId(node)}，但当前图层隐藏了 ${node.label} 节点；可见图层：${searchLayerMatches.value.join(" / ") || "无"}`;
  }
  if (!visibleNodes.value.some((item) => item.id === node.id)) {
    return `已找到 ${displayNodeId(node)}，但当前图层没有可见关系连接到它；请切换图层或放宽关系筛选`;
  }
  return `已找到 ${displayNodeId(node)}，当前图层可见`;
});

const searchResultTone = computed(() => {
  if (!lastSearch.value) return "";
  if (!lastSearch.value.found) return "warning";
  const node = searchedNode.value;
  if (!node || hiddenLabelSet.value.has(node.label) || !visibleNodes.value.some((item) => item.id === node.id)) return "muted";
  return "ok";
});

function clearGraphState() {
  error.value = "";
  subgraph.value = null;
  selectedNode.value = null;
  selectedEdge.value = null;
  activeCenterNodeId.value = "";
  lastSearch.value = null;
}

async function loadGraphOverview(graphIdOverride?: string) {
  const graphId = (graphIdOverride ?? localGraphId.value).trim();
  const serial = ++requestSerial.value;
  error.value = "";
  selectedNode.value = null;
  selectedEdge.value = null;
  activeCenterNodeId.value = "";
  lastSearch.value = null;
  applyLayerMode("business");

  if (!graphId) {
    clearGraphState();
    return;
  }

  loading.value = true;
  try {
    const response = await fetchSubgraph(graphId, undefined, hops.value);
    if (serial !== requestSerial.value) return;
    subgraph.value = response;
    emit("updateGraphId", graphId);
  } catch (err) {
    if (serial !== requestSerial.value) return;
    error.value = err instanceof Error ? err.message : String(err);
    subgraph.value = null;
  } finally {
    if (serial === requestSerial.value) loading.value = false;
  }
}

async function searchNode(explicitNodeId?: string) {
  const graphId = localGraphId.value.trim();
  const center = (explicitNodeId ?? nodeId.value).trim();
  const serial = ++requestSerial.value;
  error.value = "";
  selectedNode.value = null;
  selectedEdge.value = null;

  if (!graphId) {
    error.value = "graph_id 不能为空";
    return;
  }
  if (!center) {
    await loadGraphOverview(graphId);
    return;
  }

  loading.value = true;
  try {
    const response = await fetchSubgraph(graphId, center, hops.value);
    if (serial !== requestSerial.value) return;

    emit("updateGraphId", graphId);
    if (!response.nodes.length) {
      activeCenterNodeId.value = "";
      lastSearch.value = { nodeId: center, found: false };
      return;
    }

    subgraph.value = response;
    activeCenterNodeId.value = center;
    lastSearch.value = { nodeId: center, found: true };
    selectedNode.value = response.nodes.find((node) => node.id === center) ?? null;
  } catch (err) {
    if (serial !== requestSerial.value) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (serial === requestSerial.value) loading.value = false;
  }
}

function handleGraphSelection() {
  emit("updateGraphId", localGraphId.value);
  nodeId.value = "";
  void loadGraphOverview(localGraphId.value);
}

function toggleRelation(relation: string) {
  layerMode.value = "custom";
  hiddenRelations.value = hiddenRelations.value.includes(relation)
    ? hiddenRelations.value.filter((item) => item !== relation)
    : [...hiddenRelations.value, relation];
}

function toggleAttributes() {
  layerMode.value = "custom";
  if (hiddenLabels.value.includes("attribute")) {
    hiddenLabels.value = hiddenLabels.value.filter((label) => label !== "attribute");
    hiddenRelations.value = hiddenRelations.value.filter((relation) => relation !== "has_attribute");
  } else {
    hiddenLabels.value = [...hiddenLabels.value, "attribute"];
    if (!hiddenRelations.value.includes("has_attribute")) hiddenRelations.value = [...hiddenRelations.value, "has_attribute"];
  }
}

function hiddenLabelsForMode(mode: LayerMode) {
  if (mode === "business") return [...defaultHiddenLabels];
  if (mode === "entity_attribute") return ["keyword", "community"];
  if (mode === "semantic") return ["attribute"];
  if (mode === "full") return [];
  return [...hiddenLabels.value];
}

function hiddenRelationsForMode(mode: LayerMode) {
  if (mode === "business") return [...defaultHiddenRelations];
  if (mode === "entity_attribute") return defaultHiddenRelations.filter((relation) => relation !== "has_attribute");
  if (mode === "semantic") return ["has_attribute"];
  if (mode === "full") return [];
  return [...hiddenRelations.value];
}

function applyLayerMode(mode: LayerMode) {
  layerMode.value = mode;
  hiddenLabels.value = hiddenLabelsForMode(mode);
  hiddenRelations.value = hiddenRelationsForMode(mode);
}

function resetView() {
  applyLayerMode("business");
  selectedEdge.value = null;
}

function selectNode(node: SubgraphNode) {
  selectedNode.value = node;
  selectedEdge.value = null;
}

function selectEdge(edge: SubgraphEdge) {
  selectedEdge.value = edge;
  selectedNode.value = null;
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function stripInternalId(value: string) {
  if (value.startsWith("attr::")) {
    const parts = value.split("::");
    return parts[2] || value.replace(/^attr::/, "");
  }
  return value;
}

function displayNodeId(node: SubgraphNode) {
  return node.display_id || stripInternalId(node.id);
}

function nodeDisplayName(node: SubgraphNode) {
  if (node.label === "attribute") {
    const value = stripPropertyPrefix(node.properties?.attr_value ?? node.properties?.value ?? node.properties?.name, node.properties?.attr_key);
    if (value) return value;
  }
  return stripPropertyPrefix(node.properties?.name, node.properties?.attr_key) || displayNodeId(node);
}

function attributeDisplayName(attr: SubgraphNode) {
  return (
    stripPropertyPrefix(
      attr.properties?.attr_value ?? attr.properties?.value ?? attr.properties?.name ?? attr.properties?.description,
      attr.properties?.attr_key
    ) || displayNodeId(attr)
  );
}

function displayProperties(node: SubgraphNode) {
  const properties = { ...node.properties };
  if (typeof properties.name === "string") {
    properties.name = stripPropertyPrefix(properties.name, properties.attr_key);
  }
  if (typeof properties.attr_value === "string") {
    properties.attr_value = stripPropertyPrefix(properties.attr_value, properties.attr_key);
  }
  return properties;
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
</script>

<template>
  <section class="subgraph-workbench">
    <div class="subgraph-toolbar">
      <div class="subgraph-title">
        <span class="panel-kicker">Graph exploration</span>
        <h2>以节点为中心的多层子图</h2>
        <p>选择 graph 后自动加载业务主干；输入 node_id 和 hops 后搜索邻域，并按当前图层判断结果是否可见</p>
      </div>

      <div class="subgraph-query">
        <label>
          graph_id
          <select v-model="localGraphId" @change="handleGraphSelection">
            <option disabled value="">请选择已导入的 graph</option>
            <option v-for="id in graphOptions" :key="id" :value="id">{{ id }}</option>
          </select>
        </label>
        <label>node_id <span>search optional</span><input v-model="nodeId" @keyup.enter="searchNode()" /></label>
        <label class="hop-field">hops<input v-model.number="hops" type="number" min="1" max="3" /></label>
        <button class="primary-btn" type="button" :disabled="loading" @click="searchNode()">
          {{ loading ? "加载中..." : "搜索" }}
        </button>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div v-if="lastSearch" class="search-result" :class="searchResultTone">
        <strong>搜索结果</strong>
        <span>{{ searchResultText }}</span>
      </div>
    </div>

    <div class="subgraph-layout">
      <main class="graph-stage">
        <div class="stage-header">
          <div>
            <h3>Neighborhood Graph</h3>
            <div class="graph-metrics">
              <span>返回节点 {{ subgraph?.nodes.length ?? 0 }}</span>
              <span>返回边 {{ subgraph?.edges.length ?? 0 }}</span>
              <span>可见节点 {{ visibleNodes.length }}</span>
              <span>可见边 {{ visibleEdges.length }}</span>
            </div>
          </div>

          <div class="view-actions">
            <label class="layer-select">
              图层视图
              <select v-model="layerMode" @change="applyLayerMode(layerMode)">
                <option v-for="mode in layerModes" :key="mode.value" :value="mode.value">{{ mode.label }}</option>
                <option v-if="layerMode === 'custom'" value="custom">自定义筛选</option>
              </select>
              <span>{{ activeLayerDescription }}</span>
            </label>
            <button class="view-pill" type="button" :class="{ active: hasAttributesVisible }" @click="toggleAttributes">
              {{ hasAttributesVisible ? "隐藏属性节点" : "显示属性节点" }}
            </button>
            <button class="view-pill" type="button" @click="resetView">恢复业务主干</button>
          </div>
        </div>

        <div class="filter-dock">
          <div class="filter-group">
            <span>节点层级</span>
            <div class="chip-row">
              <span v-for="label in nodeLabels" :key="label" class="layer-chip" :class="{ muted: hiddenLabels.includes(label) }">
                {{ label }} <b>{{ labelCounts.get(label) ?? 0 }}</b>
              </span>
            </div>
          </div>

          <div v-if="visibleBusinessRelations.length" class="filter-group">
            <span>业务关系</span>
            <div class="chip-row">
              <button
                v-for="relation in visibleBusinessRelations"
                :key="relation"
                type="button"
                class="filter-chip compact"
                :class="{ muted: hiddenRelations.includes(relation) }"
                @click="toggleRelation(relation)"
              >
                {{ relation }} <b>{{ relationCounts.get(relation) ?? 0 }}</b>
              </button>
            </div>
          </div>

          <div v-if="visibleSystemRelations.length" class="filter-group system-relations">
            <span>系统关系</span>
            <div class="chip-row">
              <button
                v-for="relation in visibleSystemRelations"
                :key="relation"
                type="button"
                class="filter-chip compact"
                :class="{ muted: hiddenRelations.includes(relation) }"
                @click="toggleRelation(relation)"
              >
                {{ relation }} <b>{{ relationCounts.get(relation) ?? 0 }}</b>
              </button>
            </div>
          </div>
        </div>

        <GraphCanvas
          :nodes="subgraph?.nodes ?? []"
          :edges="subgraph?.edges ?? []"
          :hidden-relations="hiddenRelations"
          :hidden-labels="hiddenLabels"
          :center-id="activeCenterNodeId"
          :selected-id="selectedNode?.id"
          :selected-edge="selectedEdge"
          @select-node="selectNode"
          @select-edge="selectEdge"
        />

        <div class="graph-legend">
          <span><i class="legend-dot user"></i>实体/业务对象</span>
          <span><i class="legend-dot attribute"></i>属性/字段</span>
          <span><i class="legend-dot community"></i>社区/关键词</span>
          <span><i class="legend-line"></i>方向关系</span>
        </div>
      </main>

      <aside class="inspector-drawer">
        <div class="inspector-heading">
          <div>
            <span class="panel-kicker">Inspector</span>
            <h3>节点与证据</h3>
          </div>
          <span class="chip">backend fields</span>
        </div>

        <template v-if="selectedNode">
          <section class="inspector-section">
            <span class="node-type">{{ selectedNode.label }}</span>
            <h4>{{ nodeDisplayName(selectedNode) }}</h4>
            <p class="muted-copy">{{ displayNodeId(selectedNode) }}</p>
            <dl class="metadata-list compact">
              <div><dt>level</dt><dd>{{ selectedNode.level }}</dd></div>
              <div><dt>risk_level</dt><dd>{{ formatValue(selectedNode.properties?.risk_level) }}</dd></div>
              <div><dt>entity_class</dt><dd>{{ formatValue(selectedNode.properties?.entity_class ?? selectedNode.properties?.type) }}</dd></div>
              <div><dt>attributes</dt><dd>{{ selectedNodeAttributes.length }}</dd></div>
            </dl>
          </section>

          <section v-if="selectedNodeAttributes.length" class="inspector-section">
            <h4>关联属性</h4>
            <ul class="attribute-list">
              <li v-for="attr in selectedNodeAttributes" :key="attr.id">
                <span>{{ displayNodeId(attr) }}</span>
                <b>{{ attributeDisplayName(attr) }}</b>
              </li>
            </ul>
          </section>

          <section class="inspector-section">
            <h4>properties</h4>
            <pre>{{ JSON.stringify(displayProperties(selectedNode), null, 2) }}</pre>
          </section>
        </template>

        <template v-else-if="selectedEdge">
          <section class="inspector-section">
            <span class="relation-chip">{{ selectedEdge.relation }}</span>
            <h4>{{ selectedEdge.source }} -> {{ selectedEdge.target }}</h4>
            <dl class="metadata-list compact">
              <div><dt>evidence_refs</dt><dd>{{ selectedEdge.evidence_refs.length }}</dd></div>
            </dl>
          </section>

          <section class="inspector-section">
            <h4>relation_properties</h4>
            <pre>{{ JSON.stringify(selectedEdge.relation_properties, null, 2) }}</pre>
          </section>

          <section v-if="selectedEdge.evidence_refs.length" class="inspector-section">
            <h4>evidence_refs</h4>
            <ul class="code-list">
              <li v-for="ref in selectedEdge.evidence_refs" :key="ref">{{ ref }}</li>
            </ul>
          </section>
        </template>

        <div v-else class="empty-state">
          点击画布中的节点或边，查看后端返回的 properties、relation_properties 和 evidence_refs
        </div>
      </aside>
    </div>
  </section>
</template>
