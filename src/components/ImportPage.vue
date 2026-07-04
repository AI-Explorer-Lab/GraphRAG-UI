<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { importGraph, importGraphFromText, loadBundledExample, previewGraph } from "../api/client";
import type { ChecklistItem, GraphPreviewResponse, ImportResponse, TextImportResponse } from "../types/api";

const props = defineProps<{ graphId: string; graphIds?: string[] }>();
const emit = defineEmits<{
  imported: [result: ImportResponse];
  askText: [question: string];
  updateGraphId: [graphId: string];
}>();

const defaultSchemaHint = `Extract a compact relation graph with:
- relations as a short array of directed business links
- source_id and target_id as stable ASCII snake_case ids for internal storage only
- source_name, target_name, and reason must keep the input language; Chinese input must produce Chinese names
- source_type and target_type as person, account, wallet, device, merchant, transaction, data_source, feature, model, rule, decision, action, domain, or entity
- relation must be one of owns, uses, transfers_to, provides_to, scores, triggers
- keep the graph compact for interactive demos: at most 16 relations and 12 unique entities
- omit low-signal details rather than covering every noun`;

const tab = ref<"json" | "text">("json");
const localGraphId = ref(props.graphId || "");
const jsonText = ref("");
const scenarioText = ref("");
const schemaHint = ref(defaultSchemaHint);
const loading = ref(false);
const previewing = ref(false);
const error = ref("");
const result = ref<ImportResponse | null>(null);
const previewResult = ref<GraphPreviewResponse | null>(null);
const textResult = ref<TextImportResponse | null>(null);

const parsedJson = computed(() => {
  try {
    return jsonText.value.trim() ? JSON.parse(jsonText.value) : null;
  } catch {
    return null;
  }
});

const activeGraphJson = computed(() => {
  if (tab.value === "text") return textResult.value?.graph_json ?? null;
  return previewResult.value ? parsedJson.value : null;
});
const inspectionResult = computed<GraphPreviewResponse | ImportResponse | null>(() => previewResult.value ?? result.value);
const inspectionMode = computed(() => (previewResult.value ? "预览" : result.value ? "已导入" : "等待识别"));
const checklistItems = computed<ChecklistItem[]>(() => {
  if (previewResult.value?.checklist) return previewResult.value.checklist;
  if (!result.value) return [];
  return [
    { label: "Graph JSON 可解析", ok: true },
    { label: "entities", ok: result.value.entities > 0, value: result.value.entities },
    { label: "transitions", ok: result.value.transitions > 0, value: result.value.transitions },
    { label: "has_relations", ok: result.value.has_relations > 0, value: result.value.has_relations },
  ];
});
const relationSet = computed<string[]>(() => {
  if (previewResult.value) return previewResult.value.relation_types;
  const transitions = activeGraphJson.value?.transitions;
  if (!Array.isArray(transitions)) return [];
  const relations = transitions.map((item: { relation?: string }) => item.relation || "transitions");
  return Array.from(new Set<string>(relations)).sort();
});
const extractedPreview = computed(() =>
  activeGraphJson.value ? JSON.stringify(activeGraphJson.value, null, 2) : ""
);
const relationSummary = computed(() => relationSet.value.join(" / "));
const resultEntities = computed(() => inspectionResult.value?.entities ?? "-");
const resultTransitions = computed(() => inspectionResult.value?.transitions ?? "-");
const resultHasRelations = computed(() => inspectionResult.value?.has_relations ?? "-");
const resultChunks = computed(() => inspectionResult.value?.chunks ?? "-");
const resultCommunityNodes = computed(() => inspectionResult.value?.metadata.community_nodes ?? "-");
const resultFalkorWritten = computed(() => Boolean(result.value?.falkordb?.written));
const textSource = computed(() => textResult.value?.extraction.source ?? "-");
const textLength = computed(() => textResult.value?.extraction.text_length ?? "-");
const textElapsedSeconds = computed(() => textResult.value?.extraction.elapsed_seconds);

watch(
  () => props.graphId,
  (value) => {
    if (value && value !== localGraphId.value) localGraphId.value = value;
  }
);

async function loadExample() {
  error.value = "";
  result.value = null;
  previewResult.value = null;
  textResult.value = null;
  const example = await loadBundledExample();
  jsonText.value = JSON.stringify(example.graph, null, 2);
  scenarioText.value = example.text;
}

async function handleFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  clearJsonInspection();
  jsonText.value = await file.text();
}

function clearJsonInspection() {
  if (tab.value !== "json") return;
  result.value = null;
  previewResult.value = null;
  textResult.value = null;
  error.value = "";
}

async function runJsonPreview() {
  error.value = "";
  result.value = null;
  textResult.value = null;
  previewResult.value = null;
  if (!parsedJson.value) {
    error.value = "JSON 解析失败，请检查格式";
    return;
  }
  previewing.value = true;
  try {
    previewResult.value = await previewGraph(parsedJson.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    previewing.value = false;
  }
}

async function runJsonImport() {
  error.value = "";
  result.value = null;
  textResult.value = null;
  if (!localGraphId.value.trim()) {
    error.value = "请先填写 graph_id，再执行构图";
    return;
  }
  if (!parsedJson.value) {
    error.value = "JSON 解析失败，请检查格式";
    return;
  }
  loading.value = true;
  try {
    const response = await importGraph(localGraphId.value.trim(), parsedJson.value);
    previewResult.value = null;
    result.value = response;
    emit("updateGraphId", response.graph_id);
    emit("imported", response);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function runTextImport() {
  error.value = "";
  result.value = null;
  textResult.value = null;
  if (!localGraphId.value.trim()) {
    error.value = "请先填写 graph_id，再执行构图";
    return;
  }
  if (!scenarioText.value.trim()) {
    error.value = "请先输入要抽取的业务文本";
    return;
  }
  loading.value = true;
  try {
    const response = await importGraphFromText({
      graphId: localGraphId.value.trim(),
      text: scenarioText.value,
      schemaHint: schemaHint.value
    });
    textResult.value = response;
    result.value = response;
    jsonText.value = JSON.stringify(response.graph_json ?? {}, null, 2);
    emit("updateGraphId", response.graph_id);
    emit("imported", response);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function copyExtractedJson() {
  if (!extractedPreview.value) return;
  await navigator.clipboard?.writeText(extractedPreview.value);
}
</script>

<template>
  <section class="split-page import-page">
    <div class="main-column">
      <div class="tabs">
        <button :class="{ active: tab === 'json' }" @click="tab = 'json'">JSON 导入</button>
        <button :class="{ active: tab === 'text' }" @click="tab = 'text'">文本抽取</button>
      </div>

      <div v-if="tab === 'json'" class="panel editor-panel">
        <div class="panel-header">
          <div>
            <h3>Graph JSON</h3>
            <p>提交结构化 Graph JSON，后端会立即规范化、构图并写入 FalkorDB</p>
          </div>
        </div>

        <div class="form-row">
          <label>
            graph_id
            <input v-model="localGraphId" />
          </label>
          <label class="file-picker">
            上传 JSON
            <input type="file" accept=".json,application/json" @change="handleFile" />
          </label>
          <button class="ghost-btn" @click="loadExample">载入金融风控示例</button>
        </div>

        <textarea v-model="jsonText" spellcheck="false" placeholder="粘贴 Graph JSON，或载入内置示例" @input="clearJsonInspection" />

        <div class="button-row">
          <button class="primary-btn" :disabled="loading" @click="runJsonImport">
            {{ loading ? "导入中..." : "导入并构图" }}
          </button>
          <button class="ghost-btn" :disabled="previewing || loading || !jsonText.trim()" @click="runJsonPreview">
            {{ previewing ? "识别中..." : "预览结构" }}
          </button>
          <span v-if="error" class="error-text">{{ error }}</span>
        </div>
      </div>

      <div v-else class="panel editor-panel">
        <div class="panel-header">
          <div>
            <h3>自然语言文本</h3>
            <p>后端会按预设 schema 抽取实体与关系，生成 Graph JSON 后复用同一套构图流程</p>
          </div>
        </div>

        <div class="form-row text-import-row">
          <label>
            graph_id
            <input v-model="localGraphId" />
          </label>
          <button class="ghost-btn" @click="loadExample">载入金融风控文本</button>
          <button class="primary-btn" :disabled="loading || !scenarioText.trim()" @click="runTextImport">
            {{ loading ? "抽取中..." : "抽取实体并构图" }}
          </button>
        </div>

        <textarea
          v-model="scenarioText"
          class="scenario-editor"
          spellcheck="false"
          placeholder="粘贴业务描述、系统说明、业务资料或调研记录"

        />
        <details class="schema-hint" open>
          <summary>Schema 抽取约束</summary>
          <textarea v-model="schemaHint" spellcheck="false" />
        </details>

        <div class="button-row">
          <button class="ghost-btn" :disabled="!scenarioText.trim()" @click="emit('askText', scenarioText)">
            作为问题发送
          </button>
          <button class="ghost-btn" :disabled="!extractedPreview" @click="copyExtractedJson">
            复制抽取 JSON
          </button>
          <span v-if="error" class="error-text">{{ error }}</span>
        </div>

        <pre v-if="extractedPreview" class="extracted-preview">{{ extractedPreview }}</pre>
      </div>
    </div>

    <aside class="side-panel">
      <div class="panel">
        <div class="panel-header">
          <h3>Schema checklist</h3>
          <span class="chip">{{ inspectionMode }}</span>
        </div>
        <ul v-if="checklistItems.length" class="check-list">
          <li v-for="item in checklistItems" :key="item.label" :class="{ ok: item.ok }">
            {{ item.label }}<template v-if="item.value !== undefined">: {{ item.value }}</template>
          </li>
        </ul>
        <div v-else class="empty-state">点击“预览结构”识别当前 JSON</div>
        <div class="relation-stack">
          <span v-if="relationSummary" class="relation-chip">{{ relationSummary }}</span>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h3>Import result</h3>
          <span class="chip">{{ inspectionMode }}</span>
        </div>
        <dl v-if="inspectionResult" class="metadata-list compact">
          <div><dt>entities</dt><dd>{{ resultEntities }}</dd></div>
          <div><dt>transitions</dt><dd>{{ resultTransitions }}</dd></div>
          <div><dt>has_relations</dt><dd>{{ resultHasRelations }}</dd></div>
          <div><dt>chunks</dt><dd>{{ resultChunks }}</dd></div>
          <div><dt>community_nodes</dt><dd>{{ resultCommunityNodes }}</dd></div>
          <div v-if="result"><dt>falkordb.written</dt><dd>{{ resultFalkorWritten }}</dd></div>
          <div v-if="textResult"><dt>source</dt><dd>{{ textSource }}</dd></div>
          <div v-if="textResult"><dt>text_length</dt><dd>{{ textLength }}</dd></div>
          <div v-if="textElapsedSeconds !== undefined"><dt>elapsed_seconds</dt><dd>{{ textElapsedSeconds }}</dd></div>
        </dl>
        <div v-else class="empty-state">点击“预览结构”或导入成功后展示构图统计</div>
      </div>
    </aside>
  </section>
</template>








