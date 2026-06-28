<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { askGraph } from "../api/client";
import type { AskMode, AskResponse } from "../types/api";
import MarkdownRenderer from "./MarkdownRenderer.vue";

const props = defineProps<{
  graphId: string;
  graphIds?: string[];
  prefilledQuestion: string;
}>();

const emit = defineEmits<{
  updateGraphId: [graphId: string];
  answered: [response: AskResponse];
}>();

const questionExamples = [
  {
    id: "felix-risk",
    label: "Felix 高风险原因",
    question: "Felix Gao 为什么会被判定为高风险？"
  },
  {
    id: "fund-path",
    label: "钱包到 OTC 路径",
    question: "Felix 的钱包到 Nova Crypto OTC 的资金路径是什么？"
  },
  {
    id: "aml-model",
    label: "AML 模型影响",
    question: "AML 资金环模型使用了哪些特征，又影响哪些对象？"
  }
];

const localGraphId = ref(props.graphId);
const selectedQuestionExample = ref(questionExamples[0].id);
const question = ref(questionExamples[0].question);
const mode = ref<AskMode>("noagent");
const topK = ref(8);
const maxSteps = ref(3);
const loading = ref(false);
const error = ref("");
const response = ref<AskResponse | null>(null);
const activeTab = ref<"sub" | "triples" | "ids" | "chunks" | "steps">("triples");

const graphOptions = computed(() => [...(props.graphIds ?? [])].sort());

watch(
  () => props.graphId,
  (value) => {
    localGraphId.value = value;
  }
);

watch(
  () => props.prefilledQuestion,
  (value) => {
    if (value.trim()) question.value = value;
  },
  { immediate: true }
);

const triples = computed(() => response.value?.retrieval?.triples ?? []);
const chunkIds = computed(() => response.value?.retrieval?.chunk_ids ?? []);
const chunkContents = computed(() => response.value?.retrieval?.chunk_contents ?? []);
const reasoningSteps = computed(() => response.value?.retrieval?.reasoning_steps ?? []);

function applyQuestionExample(exampleId: string) {
  const example = questionExamples.find((item) => item.id === exampleId);
  if (!example) return;
  selectedQuestionExample.value = example.id;
  question.value = example.question;
}

async function runAsk() {
  error.value = "";
  response.value = null;
  if (!localGraphId.value.trim()) {
    error.value = "请先选择一个导入成功的 graph";
    return;
  }
  loading.value = true;
  try {
    const result = await askGraph({
      graphId: localGraphId.value.trim(),
      question: question.value.trim(),
      topK: topK.value,
      mode: mode.value,
      maxSteps: maxSteps.value
    });
    response.value = result;
    emit("updateGraphId", localGraphId.value.trim());
    emit("answered", result);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="ask-layout">
    <aside class="query-panel panel">
      <div class="panel-header">
        <h3>Ask Graph</h3>
      </div>

      <label>
        graph_id
        <select v-model="localGraphId" @change="emit('updateGraphId', localGraphId)">
          <option disabled value="">请选择已导入的 graph</option>
          <option v-for="id in graphOptions" :key="id" :value="id">{{ id }}</option>
        </select>
      </label>

      <label>
        示例问题
        <select v-model="selectedQuestionExample" @change="applyQuestionExample(selectedQuestionExample)">
          <option v-for="item in questionExamples" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>

      <label>
        question
        <textarea v-model="question" spellcheck="false" />
      </label>

      <div class="mode-toggle">
        <button type="button" :class="{ active: mode === 'agent' }" @click="mode = 'agent'">agent</button>
        <button type="button" :class="{ active: mode === 'noagent' }" @click="mode = 'noagent'">noagent</button>
      </div>

      <div class="form-row tight">
        <label>top_k<input v-model.number="topK" type="number" min="1" max="50" /></label>
        <label>max_steps<input v-model.number="maxSteps" type="number" min="1" max="10" /></label>
      </div>

      <button class="primary-btn full" type="button" :disabled="loading || !question.trim() || !localGraphId" @click="runAsk">
        {{ loading ? "检索中..." : "运行问答" }}
      </button>
      <p v-if="error" class="error-text">{{ error }}</p>
    </aside>

    <main class="answer-column">
      <article class="panel answer-panel">
        <div class="panel-header">
          <h3>Answer</h3>
          <span class="chip">{{ response?.retrieval?.mode ?? mode }}</span>
        </div>
        <MarkdownRenderer v-if="response?.answer" class="answer-text" :content="response.answer" />
        <div v-else class="empty-state">
          提交问题后展示 answer，没有 LLM 时，后端会返回确定性证据摘要
        </div>
      </article>

      <article class="panel evidence-panel">
        <div class="evidence-tabs">
          <button type="button" :class="{ active: activeTab === 'sub' }" @click="activeTab = 'sub'">Sub Questions</button>
          <button type="button" :class="{ active: activeTab === 'triples' }" @click="activeTab = 'triples'">Triples</button>
          <button type="button" :class="{ active: activeTab === 'ids' }" @click="activeTab = 'ids'">Chunk IDs</button>
          <button type="button" :class="{ active: activeTab === 'chunks' }" @click="activeTab = 'chunks'">Chunk Contents</button>
          <button type="button" :class="{ active: activeTab === 'steps' }" @click="activeTab = 'steps'">Reasoning Steps</button>
        </div>

        <div v-if="!response" class="empty-state">
          证据区展示后端 retrieval 字段
        </div>
        <ul v-else-if="activeTab === 'sub'" class="code-list">
          <li v-for="(item, index) in response.sub_questions" :key="index">{{ item["sub-question"] }}</li>
        </ul>
        <ul v-else-if="activeTab === 'triples'" class="triple-list">
          <li v-for="triple in triples" :key="triple">{{ triple }}</li>
        </ul>
        <ul v-else-if="activeTab === 'ids'" class="code-list">
          <li v-for="id in chunkIds" :key="id">{{ id }}</li>
        </ul>
        <div v-else-if="activeTab === 'chunks'" class="chunk-stack">
          <pre v-for="(chunk, index) in chunkContents" :key="index">{{ chunk }}</pre>
        </div>
        <div v-else class="timeline">
          <div v-for="(step, index) in reasoningSteps" :key="index" class="timeline-item">
            <strong>step {{ step.step ?? index }}</strong>
            <pre>{{ JSON.stringify(step, null, 2) }}</pre>
          </div>
          <div v-if="!reasoningSteps.length" class="empty-state">当前响应没有 reasoning_steps</div>
        </div>
      </article>
    </main>
  </section>
</template>
