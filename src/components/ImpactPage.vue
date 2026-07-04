<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { runImpact } from "../api/client";
import type { ImpactPath, ImpactResponse, RelationType, SubgraphEdge, SubgraphNode } from "../types/api";
import GraphCanvas from "./GraphCanvas.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";

const props = defineProps<{ graphId: string; graphIds?: string[] }>();
const emit = defineEmits<{ updateGraphId: [graphId: string] }>();

const relations: RelationType[] = ["owns", "uses", "transfers_to", "provides_to", "scores", "triggers"];
const impactExamples = [
  {
    id: "shared-phone-false-positive",
    label: "共享手机号误报",
    question: "如果共享手机号 138001 被判定为误报，会影响什么？",
    source: "phone_shared",
    target: "phone_shared",
    relation: "provides_to" as RelationType,
    maxDepth: 4,
    scope: "",
    targetNodeId: "report_sar",
    txtSource: "shared_phone_138001",
    txtTarget: "shared_phone_138001",
    txtTargetNodeId: "sar_report"
  },
  {
    id: "transaction-stream-delay",
    label: "实时交易流延迟",
    question: "如果实时交易流延迟，会影响哪些特征、模型和处置？",
    source: "src_transaction_stream",
    target: "src_transaction_stream",
    relation: "provides_to" as RelationType,
    maxDepth: 4,
    scope: "",
    targetNodeId: "report_sar",
    txtSource: "real_time_transaction_stream",
    txtTarget: "real_time_transaction_stream",
    txtTargetNodeId: "sar_report"
  },
  {
    id: "mule-feature-offline",
    label: "Mule 集群特征下线",
    question: "如果 Mule 集群特征下线，会影响哪些模型、评分和处置？",
    source: "feat_mule_cluster_score",
    target: "feat_mule_cluster_score",
    relation: "provides_to" as RelationType,
    maxDepth: 4,
    scope: "",
    targetNodeId: "report_sar",
    txtSource: "mule_cluster_feature",
    txtTarget: "mule_cluster_feature",
    txtTargetNodeId: "sar_report"
  }
];

const localGraphId = ref(props.graphId);
const selectedImpactExample = ref(impactExamples[0].id);
const scenarioQuestion = ref(impactExamples[0].question);
const source = ref(impactExamples[0].source);
const target = ref(impactExamples[0].target);
const relation = ref<RelationType>(impactExamples[0].relation);
const scope = ref(impactExamples[0].scope);
const targetNodeId = ref(impactExamples[0].targetNodeId);
const maxDepth = ref(impactExamples[0].maxDepth);
const loading = ref(false);
const error = ref("");
const result = ref<ImpactResponse | null>(null);
const selectedGraphNode = ref<SubgraphNode | null>(null);
const selectedGraphEdge = ref<SubgraphEdge | null>(null);

const graphOptions = computed(() => [...(props.graphIds ?? [])].sort());
const businessRelationSet = new Set<string>(relations);
const visibleEvidencePaths = computed(() => result.value?.evidence_paths.filter(isBusinessPath) ?? []);
const visibleDirectImpacts = computed(() => {
  return sortedLastNodes(visibleEvidencePaths.value.filter((path) => path.depth === 1));
});
const visibleIndirectImpacts = computed(() => {
  return sortedLastNodes(visibleEvidencePaths.value.filter((path) => path.depth > 1));
});
const visibleTargetImpact = computed(() => {
  return (result.value?.target_impact ?? []).filter((path) => path.split(" -> ").every((node) => !isSystemNode(node)));
});
const visibleScopedImpact = computed(() => (result.value?.scoped_impact ?? []).filter((node) => !isSystemNode(node)));
const maxPathDepth = computed(() => Math.max(1, ...(visibleEvidencePaths.value.map((path) => path.depth) ?? [1])));
const impactMarkdown = computed(() => {
  if (!result.value) return "";
  return findNarrative(result.value) || buildImpactMarkdown();
});
const impactSourceLabel = computed(() => {
  if (!result.value) return "业务节点";
  const source = result.value.answer_source;
  if (typeof source === "string" && source.trim()) return source.trim();
  return result.value.llm_called ? "llm" : "业务节点";
});
const impactGraphNodes = computed(() => {
  const visibleNodeIds = visibleImpactNodeIds();
  const backendNodes = result.value?.impact_subgraph?.nodes ?? [];
  if (backendNodes.length) {
    return backendNodes.filter((node) => visibleNodeIds.has(node.id));
  }

  const nodes = new Map<string, SubgraphNode>();
  visibleEvidencePaths.value.forEach((path) => {
    path.path.forEach((nodeId) => {
      if (nodes.has(nodeId)) return;
      nodes.set(nodeId, {
        id: nodeId,
        display_id: nodeId,
        label: "entity",
        level: nodeId === target.value.trim() ? 1 : 2,
        properties: {
          id: nodeId,
          name: prettifyNodeId(nodeId),
          type: nodeTypeHint(nodeId)
        }
      });
    });
  });
  return [...nodes.values()];
});
const impactGraphEdges = computed(() => {
  const backendEdges = result.value?.impact_subgraph?.edges ?? [];
  if (backendEdges.length) {
    const visibleEdges = visibleImpactEdgeKeys();
    return backendEdges.filter((edge) => visibleEdges.has(edgeKey(edge.source, edge.target, edge.relation)));
  }

  const edges = new Map<string, SubgraphEdge>();
  visibleEvidencePaths.value.forEach((path) => {
    path.relations.forEach((relationName, index) => {
      const sourceNode = path.path[index];
      const targetNode = path.path[index + 1];
      if (!sourceNode || !targetNode) return;
      const key = edgeKey(sourceNode, targetNode, relationName);
      if (edges.has(key)) return;
      edges.set(key, {
        source: sourceNode,
        target: targetNode,
        relation: relationName,
        relation_properties: { impact_depth: path.depth },
        evidence_refs: []
      });
    });
  });
  return [...edges.values()];
});
const impactGraphCenterId = computed(() => {
  const nodeIds = new Set(impactGraphNodes.value.map((node) => node.id));
  const requestedCandidates = [source.value.trim(), target.value.trim()].filter(Boolean);
  for (const candidate of requestedCandidates) {
    if (nodeIds.has(candidate)) return candidate;
  }

  for (const path of visibleEvidencePaths.value) {
    const firstNode = path.path[0];
    if (firstNode && nodeIds.has(firstNode)) return firstNode;
  }

  return "";
});
const selectedImpactSummary = computed(() => {
  if (selectedGraphNode.value) return `${selectedGraphNode.value.id} / ${selectedGraphNode.value.properties?.type ?? "node"}`;
  if (selectedGraphEdge.value) return `${selectedGraphEdge.value.source} -> ${selectedGraphEdge.value.target} / ${selectedGraphEdge.value.relation}`;
  return "点击节点或关系查看焦点";
});

watch(
  () => props.graphId,
  (value) => {
    localGraphId.value = value;
    applyImpactExample(selectedImpactExample.value);
  }
);

function applyImpactExample(exampleId: string) {
  const example = impactExamples.find((item) => item.id === exampleId);
  if (!example) return;
  const resolved = resolveImpactExample(example);
  selectedImpactExample.value = example.id;
  scenarioQuestion.value = example.question;
  source.value = resolved.source;
  target.value = resolved.target;
  relation.value = example.relation;
  maxDepth.value = example.maxDepth;
  scope.value = example.scope;
  targetNodeId.value = resolved.targetNodeId;
}

function resolveImpactExample(example: (typeof impactExamples)[number]) {
  if (!isTextGraph(localGraphId.value)) {
    return {
      source: example.source,
      target: example.target,
      targetNodeId: example.targetNodeId
    };
  }
  return {
    source: example.txtSource || example.source,
    target: example.txtTarget || example.target,
    targetNodeId: example.txtTargetNodeId || example.targetNodeId
  };
}

function isTextGraph(graphId: string) {
  return graphId.toLowerCase().includes("_txt");
}

applyImpactExample(selectedImpactExample.value);

function isSystemNode(nodeId: string) {
  return nodeId.startsWith("attr::") || nodeId.startsWith("comm_") || nodeId.startsWith("kw_");
}

function isBusinessPath(path: ImpactPath) {
  return path.path.every((node) => !isSystemNode(node)) && path.relations.every((item) => businessRelationSet.has(item));
}

function sortedLastNodes(paths: ImpactPath[]) {
  return [...new Set(paths.map((path) => path.path[path.path.length - 1]).filter(Boolean))].sort();
}

function visibleImpactNodeIds() {
  const ids = new Set<string>();
  visibleEvidencePaths.value.forEach((path) => {
    path.path.forEach((nodeId) => ids.add(nodeId));
  });
  return ids;
}

function visibleImpactEdgeKeys() {
  const keys = new Set<string>();
  visibleEvidencePaths.value.forEach((path) => {
    path.relations.forEach((relationName, index) => {
      const sourceNode = path.path[index];
      const targetNode = path.path[index + 1];
      if (!sourceNode || !targetNode) return;
      keys.add(edgeKey(sourceNode, targetNode, relationName));
    });
  });
  return keys;
}

function edgeKey(sourceNode: string, targetNode: string, relationName: string) {
  return `${sourceNode}->${targetNode}:${relationName}`;
}

function prettifyNodeId(nodeId: string) {
  return nodeId.replace(/^(usr|acct|wallet|phone|rule|dec|act|txn|biz|mch|feat|mdl|src|report)_/, "").replace(/_/g, " ");
}

function nodeTypeHint(nodeId: string) {
  if (nodeId.startsWith("rule_")) return "rule";
  if (nodeId.startsWith("dec_")) return "decision";
  if (nodeId.startsWith("act_")) return "action";
  if (nodeId.startsWith("report_")) return "report";
  if (nodeId.startsWith("usr_")) return "user";
  if (nodeId.startsWith("phone_")) return "signal";
  if (nodeId.startsWith("feat_")) return "feature";
  if (nodeId.startsWith("mdl_")) return "model";
  return "entity";
}

function selectImpactNode(node: SubgraphNode) {
  selectedGraphNode.value = selectedGraphNode.value?.id === node.id ? null : node;
  selectedGraphEdge.value = null;
}

function selectImpactEdge(edge: SubgraphEdge) {
  selectedGraphEdge.value =
    selectedGraphEdge.value?.source === edge.source &&
    selectedGraphEdge.value?.target === edge.target &&
    selectedGraphEdge.value?.relation === edge.relation
      ? null
      : edge;
  selectedGraphNode.value = null;
}

function findNarrative(response: ImpactResponse) {
  const fields = ["answer", "summary", "impact_summary", "analysis", "narrative"];
  for (const field of fields) {
    const value = response[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function buildImpactMarkdown() {
  const sections: Array<[string, string[]]> = [
    ["direct_impacts", visibleDirectImpacts.value],
    ["indirect_impacts", visibleIndirectImpacts.value],
    ["scoped_impact", scope.value ? visibleScopedImpact.value : ["scope 未启用"]],
    ["target_impact", targetNodeId.value ? visibleTargetImpact.value : ["target_node_id 可选"]]
  ];

  return sections
    .map(([title, items]) => {
      const body = items.length ? items.map((item) => `- \`${item}\``).join("\n") : "- 没有找到业务节点";
      return `### ${title}\n${body}`;
    })
    .join("\n\n");
}

async function run() {
  error.value = "";
  result.value = null;
  selectedGraphNode.value = null;
  selectedGraphEdge.value = null;
  if (!localGraphId.value.trim()) {
    error.value = "请先选择一个导入成功的 graph";
    return;
  }
  loading.value = true;
  try {
    result.value = await runImpact({
      graphId: localGraphId.value.trim(),
      scenario: scenarioQuestion.value.trim(),
      language: "zh",
      source: source.value.trim(),
      target: target.value.trim(),
      relation: relation.value,
      maxDepth: maxDepth.value,
      scope: scope.value.trim() || undefined,
      targetNodeId: targetNodeId.value.trim() || undefined
    });
    emit("updateGraphId", localGraphId.value.trim());
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="impact-layout">
    <aside class="query-panel panel">
      <div class="panel-header">
        <h3>Impact Scenario</h3>
      </div>
      <label>
        graph_id
        <select v-model="localGraphId" @change="emit('updateGraphId', localGraphId)">
          <option disabled value="">请选择已导入的 graph</option>
          <option v-for="id in graphOptions" :key="id" :value="id">{{ id }}</option>
        </select>
      </label>

      <label>
        影响场景
        <select v-model="selectedImpactExample" @change="applyImpactExample(selectedImpactExample)">
          <option v-for="item in impactExamples" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>

      <label>
        scenario
        <textarea v-model="scenarioQuestion" spellcheck="false" readonly />
      </label>

      <details class="schema-hint">
        <summary>高级参数</summary>
        <div class="advanced-fields">
          <label>source<input v-model="source" /></label>
          <label>target<input v-model="target" /></label>
          <label>
            relation
            <select v-model="relation">
              <option v-for="item in relations" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label>max_depth<input v-model.number="maxDepth" type="number" min="1" max="8" /></label>
          <label>scope <span>optional</span><input v-model="scope" placeholder="例如 controls" /></label>
          <label>target_node_id <span>optional</span><input v-model="targetNodeId" /></label>
        </div>
      </details>

      <button class="primary-btn full" type="button" :disabled="loading || !localGraphId" @click="run">
        {{ loading ? "分析中..." : "运行影响分析" }}
      </button>
      <p v-if="error" class="error-text">{{ error }}</p>
    </aside>

    <main class="impact-workspace">
      <section class="graph-stage impact-graph-stage">
        <div class="stage-header">
          <div>
            <h3>影响子图</h3>
          </div>
          <span class="chip">{{ impactGraphNodes.length }} nodes / {{ impactGraphEdges.length }} edges</span>
        </div>

        <GraphCanvas
          v-if="result && impactGraphNodes.length"
          :nodes="impactGraphNodes"
          :edges="impactGraphEdges"
          :hidden-relations="[]"
          :hidden-labels="[]"
          :center-id="impactGraphCenterId"
          :selected-id="selectedGraphNode?.id"
          :selected-edge="selectedGraphEdge"
          compact
          @select-node="selectImpactNode"
          @select-edge="selectImpactEdge"
          @toggle-label="() => {}"
          @toggle-relation="() => {}"
          @toggle-fullscreen="() => {}"
        />
        <div v-else class="empty-state">运行后展示本次影响传播子图</div>

        <div v-if="result && impactGraphNodes.length" class="impact-focus-strip">
          <strong>当前焦点</strong>
          <span>{{ selectedImpactSummary }}</span>
        </div>
      </section>

      <section class="impact-paths panel">
        <div class="panel-header">
          <h3>路径明细</h3>
          <span class="chip">from evidence_paths</span>
        </div>
        <div v-if="!result" class="empty-state">
          运行后根据后端返回的 evidence_paths 生成路径视图
        </div>
        <div v-else-if="!visibleEvidencePaths.length" class="empty-state">没有找到业务下游路径</div>
        <div v-else class="path-stack">
          <div v-for="(path, index) in visibleEvidencePaths" :key="index" class="impact-path">
            <div class="path-depth" :style="{ width: `${(path.depth / maxPathDepth) * 100}%` }">
              depth {{ path.depth }}
            </div>
            <div class="path-line">
              <template v-for="(node, nodeIndex) in path.path" :key="`${index}-${node}`">
                <span class="path-node">{{ node }}</span>
                <span v-if="path.relations[nodeIndex]" class="path-relation">{{ path.relations[nodeIndex] }}</span>
              </template>
            </div>
          </div>
        </div>
      </section>
    </main>

    <aside class="side-panel">
      <div class="panel impact-results">
        <div class="panel-header">
          <h3>Impacts</h3>
          <span class="chip">{{ impactSourceLabel }}</span>
        </div>

        <MarkdownRenderer v-if="result" class="impact-markdown" :content="impactMarkdown" />
        <div v-else class="empty-state">运行后展示影响分析结果</div>
      </div>
    </aside>
  </section>
</template>
