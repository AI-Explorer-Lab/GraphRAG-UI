<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { fetchGraphIds, syncGraphIds } from "./api/client";
import AskPage from "./components/AskPage.vue";
import ImpactPage from "./components/ImpactPage.vue";
import ImportPage from "./components/ImportPage.vue";
import OverviewPage from "./components/OverviewPage.vue";
import SubgraphPage from "./components/SubgraphPage.vue";
import type { AskResponse, ImportResponse } from "./types/api";

type PageKey = "overview" | "import" | "subgraph" | "ask" | "impact";

const navItems: Array<{ key: PageKey; label: string; subtitle: string }> = [
  { key: "overview", label: "总览", subtitle: "Overview" },
  { key: "import", label: "导入", subtitle: "Import" },
  { key: "subgraph", label: "子图", subtitle: "Subgraph" },
  { key: "ask", label: "问答", subtitle: "Q&A" },
  { key: "impact", label: "影响", subtitle: "Impact" }
];

const activePage = ref<PageKey>("overview");
const graphId = ref("");
const graphIds = ref<string[]>([]);
const subgraphCenterNodeId = ref("");
const prefilledQuestion = ref("");
const lastAsk = ref<AskResponse | null>(null);
const syncingGraphs = ref(false);

watch(graphId, (value) => {
  localStorage.setItem("graphrag-ui:graphId", value);
});

const graphOptions = computed(() => {
  return [...graphIds.value].sort();
});

onMounted(() => {
  void refreshGraphIds();
});

async function refreshGraphIds() {
  try {
    const response = await fetchGraphIds();
    graphIds.value = response.graphs;
  } catch {
    graphIds.value = [];
  }
}

async function syncGraphsFromFalkor() {
  syncingGraphs.value = true;
  try {
    const response = await syncGraphIds();
    graphIds.value = response.graphs;
    if (graphId.value && !response.graphs.includes(graphId.value)) graphId.value = "";
  } catch (err) {
    console.error(err);
  } finally {
    syncingGraphs.value = false;
  }
}

function handleImported(result: ImportResponse) {
  graphId.value = result.graph_id;
  if (!graphIds.value.includes(result.graph_id)) graphIds.value = [...graphIds.value, result.graph_id].sort();
  void refreshGraphIds();
  subgraphCenterNodeId.value = result.focus_node_id || "";
  activePage.value = "subgraph";
}

function handleAskFromText(question: string) {
  prefilledQuestion.value = question;
  activePage.value = "ask";
}
</script>

<template>
  <div class="app-shell">
    <aside class="side-nav">
      <div class="brand-lockup">
        <div class="brand-mark">GR</div>
        <div>
          <strong>GraphRAG</strong>
          <span>Console</span>
        </div>
      </div>

      <nav>
        <button
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: activePage === item.key }"
          @click="activePage = item.key"
        >
          <span>{{ item.label }}</span>
          <small>{{ item.subtitle }}</small>
        </button>
      </nav>
    </aside>

    <main class="workspace">
      <header class="top-bar">
        <div>
          <span class="eyebrow">GraphRAG Console</span>
          <h1>{{ navItems.find((item) => item.key === activePage)?.label }}</h1>
        </div>

        <div class="graph-bar">
          <button class="sync-btn" type="button" :disabled="syncingGraphs" @click="syncGraphsFromFalkor">
            {{ syncingGraphs ? "同步中..." : "同步 FalkorDB" }}
          </button>
        </div>
      </header>

      <OverviewPage
        v-if="activePage === 'overview'"
        @go-import="activePage = 'import'"
      />

      <ImportPage
        v-show="activePage === 'import'"
        :graph-id="graphId"
        :graph-ids="graphOptions"
        @update-graph-id="graphId = $event"
        @imported="handleImported"
        @ask-text="handleAskFromText"
      />

      <SubgraphPage
        v-show="activePage === 'subgraph'"
        :graph-id="graphId"
        :graph-ids="graphOptions"
        :center-node-id="subgraphCenterNodeId"
        @update-graph-id="graphId = $event"
      />

      <AskPage
        v-show="activePage === 'ask'"
        :graph-id="graphId"
        :prefilled-question="prefilledQuestion"
        :graph-ids="graphOptions"
        @update-graph-id="graphId = $event"
        @answered="lastAsk = $event"
      />

      <ImpactPage
        v-show="activePage === 'impact'"
        :graph-id="graphId"
        :graph-ids="graphOptions"
        @update-graph-id="graphId = $event"
      />
    </main>
  </div>
</template>
