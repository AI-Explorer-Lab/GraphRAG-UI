<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { fetchSubgraph } from "../api/client";
import type { SubgraphEdge, SubgraphNode, SubgraphResponse } from "../types/api";
import GraphCanvas from "./GraphCanvas.vue";

type LayerMode = "level1_attributes" | "level2_relations" | "level3_keywords" | "level4_communities" | "full" | "custom";

const businessRelations = ["owns", "uses", "transfers_to", "provides_to", "scores", "triggers"];
const systemRelations = ["has", "has_attribute", "member_of", "represents_community", "represented_by", "has_keyword", "represents_entity"];
const defaultHiddenRelations = ["has", "has_attribute", "member_of", "represents_community", "represented_by", "has_keyword", "represents_entity"];
const defaultHiddenLabels = ["attribute", "keyword", "community"];
const nodeLabels = ["entity", "attribute", "keyword", "community"];
const propertyLabels: Record<string, string> = {
  attr_key: "属性名",
  attr_value: "属性值",
  description: "说明",
  domain: "业务域",
  entity_class: "实体类型",
  id: "节点 ID",
  keyword_entities: "关键词节点",
  members: "成员节点",
  name: "名称",
  owner: "负责人",
  raw_properties: "原始属性",
  reason: "关系说明",
  representative: "代表节点",
  risk_level: "风险等级",
  schema_type: "类型",
  type: "类型",
  value: "值"
};
const relationLabels: Record<string, string> = {
  has: "包含",
  has_attribute: "拥有属性",
  has_keyword: "关联关键词",
  member_of: "属于社区",
  owns: "拥有",
  provides_to: "提供给",
  represented_by: "由实体代表",
  represents_community: "代表社区",
  represents_entity: "代表实体",
  scores: "评分影响",
  transfers_to: "资金流向",
  triggers: "触发"
};

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
const layerMode = ref<LayerMode>("level2_relations");
const selectedNode = ref<SubgraphNode | null>(null);
const selectedEdge = ref<SubgraphEdge | null>(null);
const lastSearch = ref<{ nodeId: string; found: boolean } | null>(null);
const requestSerial = ref(0);
const graphStageRef = ref<HTMLElement | null>(null);
const nativeStageFullscreen = ref(false);
const fallbackStageFullscreen = ref(false);

const graphOptions = computed(() => {
  return [...(props.graphIds ?? [])].sort();
});
const isStageFullscreen = computed(() => nativeStageFullscreen.value || fallbackStageFullscreen.value);

const layerModes: Array<{ value: LayerMode; label: string; description: string }> = [
  { value: "level1_attributes", label: "L1 属性层", description: "实体属性与字段信息" },
  { value: "level2_relations", label: "L2 关系层", description: "实体之间的业务关系三元组" },
  { value: "level3_keywords", label: "L3 关键词层", description: "关键词索引与代表实体" },
  { value: "level4_communities", label: "L4 社区层", description: "社区结构与成员归属" },
  { value: "full", label: "全部层叠", description: "叠加展示 L1-L4 全部层级" }
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

onMounted(() => {
  document.addEventListener("fullscreenchange", syncStageFullscreenState);
});

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", syncStageFullscreenState);
});

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

async function loadGraphOverview(graphIdOverride?: string, resetLayer = true) {
  const graphId = (graphIdOverride ?? localGraphId.value).trim();
  const serial = ++requestSerial.value;
  error.value = "";
  selectedNode.value = null;
  selectedEdge.value = null;
  activeCenterNodeId.value = "";
  lastSearch.value = null;
  if (resetLayer) applyLayerMode("level2_relations");

  if (!graphId) {
    clearGraphState();
    return;
  }

  loading.value = true;
  try {
    const response = await fetchSubgraph(graphId, undefined, hops.value, backendViewForLayer());
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
    await loadGraphOverview(graphId, false);
    return;
  }

  loading.value = true;
  try {
    const response = await fetchSubgraph(graphId, center, hops.value, backendViewForLayer());
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
  hiddenRelations.value = hiddenRelations.value.includes(relation)
    ? hiddenRelations.value.filter((item) => item !== relation)
    : [...hiddenRelations.value, relation];
}

function toggleLabel(label: string) {
  hiddenLabels.value = hiddenLabels.value.includes(label)
    ? hiddenLabels.value.filter((item) => item !== label)
    : [...hiddenLabels.value, label];
}

function toggleAttributes() {
  if (hiddenLabels.value.includes("attribute")) {
    applyLayerMode("level1_attributes");
    reloadCurrentGraph();
    return;
  }
  hiddenLabels.value = [...hiddenLabels.value, "attribute"];
  hiddenRelations.value = Array.from(new Set([...hiddenRelations.value, "has", "has_attribute"]));
}

function hiddenLabelsForMode(mode: LayerMode) {
  if (mode === "level1_attributes") return ["keyword", "community"];
  if (mode === "level2_relations") return [...defaultHiddenLabels];
  if (mode === "level3_keywords") return ["attribute"];
  if (mode === "level4_communities") return ["attribute", "keyword"];
  if (mode === "full") return [];
  return [...hiddenLabels.value];
}

function hiddenRelationsForMode(mode: LayerMode) {
  if (mode === "level1_attributes") return defaultHiddenRelations.filter((relation) => relation !== "has_attribute");
  if (mode === "level2_relations") return defaultHiddenRelations.filter((relation) => relation !== "has");
  if (mode === "level3_keywords") return ["has", "has_attribute", ...businessRelations, "member_of", "represents_community", "represented_by"];
  if (mode === "level4_communities") return ["has", "has_attribute", ...businessRelations, "has_keyword", "represents_entity"];
  if (mode === "full") return [];
  return [...hiddenRelations.value];
}

function applyLayerMode(mode: LayerMode) {
  layerMode.value = mode;
  hiddenLabels.value = hiddenLabelsForMode(mode);
  hiddenRelations.value = hiddenRelationsForMode(mode);
}

function backendViewForLayer() {
  return layerMode.value === "custom" ? "full" : layerMode.value;
}

function reloadCurrentGraph() {
  const graphId = localGraphId.value.trim();
  if (!graphId) return;
  if (activeCenterNodeId.value) void searchNode(activeCenterNodeId.value);
  else void loadGraphOverview(graphId, false);
}

function handleLayerModeChange(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const mode = (target?.value || layerMode.value) as LayerMode;
  applyLayerMode(mode);
  reloadCurrentGraph();
}

function resetView() {
  applyLayerMode("level2_relations");
  selectedEdge.value = null;
  reloadCurrentGraph();
}

function syncStageFullscreenState() {
  nativeStageFullscreen.value = document.fullscreenElement === graphStageRef.value;
  if (nativeStageFullscreen.value) fallbackStageFullscreen.value = false;
}

async function toggleStageFullscreen() {
  const stage = graphStageRef.value;
  if (!stage) return;
  if (nativeStageFullscreen.value) {
    await document.exitFullscreen();
    return;
  }
  if (fallbackStageFullscreen.value) {
    fallbackStageFullscreen.value = false;
    return;
  }
  try {
    await stage.requestFullscreen();
  } catch {
    fallbackStageFullscreen.value = true;
  }
}

function selectNode(node: SubgraphNode) {
  if (selectedNode.value?.id === node.id) {
    selectedNode.value = null;
    selectedEdge.value = null;
    return;
  }
  selectedNode.value = node;
  selectedEdge.value = null;
}

function selectEdge(edge: SubgraphEdge) {
  if (selectedEdge.value && isSameEdge(selectedEdge.value, edge)) {
    selectedEdge.value = null;
    selectedNode.value = null;
    return;
  }
  selectedEdge.value = edge;
  selectedNode.value = null;
}

function isSameEdge(left: SubgraphEdge, right: SubgraphEdge) {
  if (left === right) return true;
  return (
    left.source === right.source &&
    left.target === right.target &&
    left.relation === right.relation &&
    JSON.stringify(left.relation_properties) === JSON.stringify(right.relation_properties) &&
    left.evidence_refs.join("|") === right.evidence_refs.join("|")
  );
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function propertyLabel(key: string) {
  return propertyLabels[key] ?? key.replace(/_/g, " ");
}

function relationDisplayName(relation: string) {
  return relationLabels[relation] ?? relation.replace(/_/g, " ");
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
  if (node.label === "community") return communityDisplayName(node);
  return stripPropertyPrefix(node.properties?.name, node.properties?.attr_key) || displayNodeId(node);
}

function communityDisplayName(node: SubgraphNode) {
  const representative = typeof node.properties?.representative === "string" ? node.properties.representative : "";
  if (representative) return `${nodeReferenceLabel(representative)}社区`;

  const keywordEntities = Array.isArray(node.properties?.keyword_entities) ? node.properties.keyword_entities : [];
  const firstKeyword = keywordEntities.find((item): item is string => typeof item === "string");
  if (firstKeyword) return `${nodeReferenceLabel(firstKeyword)}社区`;

  const name = stripPropertyPrefix(node.properties?.name, node.properties?.attr_key);
  if (name && !/^community[_-]/i.test(name)) return name;
  return displayNodeId(node);
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

function displayPropertyEntries(node: SubgraphNode) {
  if (node.label === "community") return displayCommunityPropertyEntries(node);
  return Object.entries(displayProperties(node)).map(([key, value]) => ({
    key,
    label: propertyLabel(key),
    value: formatValue(value)
  }));
}

function displayCommunityPropertyEntries(node: SubgraphNode) {
  const properties = displayProperties(node);
  const entries: Array<{ key: string; label: string; value: string }> = [];

  if (typeof properties.representative === "string" && properties.representative) {
    entries.push({
      key: "representative",
      label: propertyLabel("representative"),
      value: nodeReferenceLabel(properties.representative)
    });
  }

  if (Array.isArray(properties.keyword_entities) && properties.keyword_entities.length) {
    entries.push({
      key: "keyword_entities",
      label: propertyLabel("keyword_entities"),
      value: formatNodeReferenceList(properties.keyword_entities)
    });
  }

  if (Array.isArray(properties.members) && properties.members.length) {
    entries.push({
      key: "members",
      label: propertyLabel("members"),
      value: formatNodeReferenceList(properties.members)
    });
  }

  const description = typeof properties.description === "string" ? properties.description.trim() : "";
  if (description && !isGeneratedCommunityDescription(description)) {
    entries.push({
      key: "description",
      label: propertyLabel("description"),
      value: description
    });
  }

  Object.entries(properties)
    .filter(([key]) => !["name", "description", "representative", "keyword_entities", "members"].includes(key))
    .forEach(([key, value]) => {
      entries.push({
        key,
        label: propertyLabel(key),
        value: formatValue(value)
      });
    });

  return entries;
}

function displayRelationPropertyEntries(edge: SubgraphEdge) {
  return Object.entries(edge.relation_properties).map(([key, value]) => ({
    key,
    label: propertyLabel(key),
    value: formatValue(value)
  }));
}

function edgeEndpointLabel(id: string) {
  const node = nodeById.value.get(id);
  return node ? nodeDisplayName(node) : stripInternalId(id);
}

function nodeReferenceLabel(id: string) {
  const node = nodeById.value.get(id);
  if (!node) return stripInternalId(id);
  if (node.label === "attribute") {
    const value = stripPropertyPrefix(node.properties?.attr_value ?? node.properties?.value ?? node.properties?.name, node.properties?.attr_key);
    if (value) return value;
  }
  return stripPropertyPrefix(node.properties?.name, node.properties?.attr_key) || displayNodeId(node);
}

function formatNodeReferenceList(value: unknown[]) {
  return value.map((item) => (typeof item === "string" ? nodeReferenceLabel(item) : formatValue(item))).join("、");
}

function isGeneratedCommunityDescription(value: string) {
  return /^Representative:\s*.+;\s*Keywords:\s*.+$/i.test(value.trim());
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
        <p>选择 graph 后自动加载 L2 关系层；输入 node_id 和 hops 后搜索邻域，并按当前 level 判断结果是否可见</p>
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
      <main ref="graphStageRef" class="graph-stage" :class="{ fullscreen: isStageFullscreen }">
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
              <select v-model="layerMode" @change="handleLayerModeChange">
                <option v-for="mode in layerModes" :key="mode.value" :value="mode.value">{{ mode.label }}</option>
                <option v-if="layerMode === 'custom'" value="custom">自定义筛选</option>
              </select>
              <span>{{ activeLayerDescription }}</span>
            </label>
            <button class="view-pill" type="button" :class="{ active: hasAttributesVisible }" @click="toggleAttributes">
              {{ hasAttributesVisible ? "隐藏属性节点" : "显示属性节点" }}
            </button>
            <button class="view-pill" type="button" @click="resetView">恢复 L2 关系层</button>
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
          :fullscreen="isStageFullscreen"
          @select-node="selectNode"
          @select-edge="selectEdge"
          @toggle-label="toggleLabel"
          @toggle-relation="toggleRelation"
          @toggle-fullscreen="toggleStageFullscreen"
        />

      </main>

      <aside class="inspector-drawer">
        <div class="inspector-heading">
          <div>
            <span class="panel-kicker">Inspector</span>
            <h3>节点与证据</h3>
          </div>
          <span class="chip">数据详情</span>
        </div>

        <template v-if="selectedNode">
          <section class="inspector-section">
            <span class="node-type">{{ selectedNode.label }}</span>
            <h4>{{ nodeDisplayName(selectedNode) }}</h4>
            <p class="muted-copy">{{ displayNodeId(selectedNode) }}</p>
            <dl class="metadata-list compact">
              <div><dt>层级</dt><dd>{{ selectedNode.level }}</dd></div>
              <div><dt>风险等级</dt><dd>{{ formatValue(selectedNode.properties?.risk_level) }}</dd></div>
              <div><dt>实体类型</dt><dd>{{ formatValue(selectedNode.properties?.entity_class ?? selectedNode.properties?.type) }}</dd></div>
              <div><dt>关联属性</dt><dd>{{ selectedNodeAttributes.length }}</dd></div>
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
            <h4>节点详情</h4>
            <dl class="metadata-list compact detail-list">
              <div v-for="entry in displayPropertyEntries(selectedNode)" :key="entry.key">
                <dt>{{ entry.label }}</dt>
                <dd>{{ entry.value }}</dd>
              </div>
            </dl>
          </section>
        </template>

        <template v-else-if="selectedEdge">
          <section class="inspector-section">
            <span class="relation-chip">{{ relationDisplayName(selectedEdge.relation) }}</span>
            <h4>{{ edgeEndpointLabel(selectedEdge.source) }} -> {{ edgeEndpointLabel(selectedEdge.target) }}</h4>
            <dl class="metadata-list compact">
              <div><dt>证据引用</dt><dd>{{ selectedEdge.evidence_refs.length }}</dd></div>
            </dl>
          </section>

          <section class="inspector-section">
            <h4>关系说明</h4>
            <dl class="metadata-list compact detail-list">
              <div v-for="entry in displayRelationPropertyEntries(selectedEdge)" :key="entry.key">
                <dt>{{ entry.label }}</dt>
                <dd>{{ entry.value }}</dd>
              </div>
            </dl>
          </section>

          <section v-if="selectedEdge.evidence_refs.length" class="inspector-section">
            <h4>证据引用</h4>
            <ul class="code-list">
              <li v-for="ref in selectedEdge.evidence_refs" :key="ref">{{ ref }}</li>
            </ul>
          </section>
        </template>

        <div v-else class="empty-state">
          点击图中的节点或关系线，查看节点详情、关系说明和证据引用
        </div>
      </aside>
    </div>
  </section>
</template>
