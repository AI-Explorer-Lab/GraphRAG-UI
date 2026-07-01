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
const nodeNameById = computed(() => {
  const names = new Map<string, string>();
  chunkContents.value.forEach((chunk) => {
    if (typeof chunk !== "string") return;
    try {
      const parsed = JSON.parse(chunk) as { id?: unknown; entity_id?: unknown; name?: unknown };
      const id = typeof parsed.id === "string" ? parsed.id : typeof parsed.entity_id === "string" ? parsed.entity_id : "";
      const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
      if (id && name) names.set(id, name);
    } catch {
      // Non-JSON chunks are still useful as raw evidence, but cannot provide display names.
    }
  });
  return names;
});
const readableTriples = computed(() => {
  return triples.value
    .map((triple) => {
      const match = triple.match(/^\(([^,]+),\s*([^,]+),\s*([^)]+)\)$/);
      if (!match) return null;
      return {
        source: match[1].trim(),
        relation: match[2].trim(),
        target: match[3].trim()
      };
    })
    .filter((triple): triple is { source: string; relation: string; target: string } => Boolean(triple));
});
const displayAnswer = computed(() => (response.value?.answer ? formatAnswerWithNodeNames(response.value.answer) : ""));

const readableAnswerInstruction = `回答格式要求：
1. 正文优先使用节点的可读名称或业务名称，不要把节点 id 当作主要表述；只有没有名称时才使用 id。
2. 第一次引用关键节点时，在名称后用括号补充它对应的节点 id，例如：Felix Gao（id: usr_felix）。
3. 说明证据关系时，用可读名称描述结论，并在同一个括号里补充对应三元组，格式为：名称 A -> 关系 -> 名称 B；ids: id_a -> relation -> id_b。
4. 最终答案禁止输出只有 id 的“关键证据节点”列表；如果需要列证据，请写成“可读名称（id: ...）- 证据三元组：...”。
5. 用中文回答，保持简洁，但每个结论都要能追溯到节点 id 和三元组。`;

function applyQuestionExample(exampleId: string) {
  const example = questionExamples.find((item) => item.id === exampleId);
  if (!example) return;
  selectedQuestionExample.value = example.id;
  question.value = example.question;
}

function buildPromptQuestion(rawQuestion: string) {
  return `${rawQuestion.trim()}\n\n${readableAnswerInstruction}`;
}

function formatAnswerWithNodeNames(answer: string) {
  const lines = answer.split(/\r?\n/);
  const formatted: string[] = [];
  let inEvidenceNodeList = false;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (/^(关键证据节点|Key evidence nodes)\s*[：:]?\s*$/i.test(trimmed)) {
      inEvidenceNodeList = true;
      formatted.push(line.replace(trimmed, "关键证据节点与证据三元组："));
      return;
    }

    if (inEvidenceNodeList) {
      if (!trimmed) {
        formatted.push(line);
        return;
      }

      const bulletMatch = trimmed.match(/^[-*]\s*`?([^`\s]+)`?\s*$/);
      if (bulletMatch) {
        const id = bulletMatch[1];
        const indentation = line.match(/^\s*/)?.[0] ?? "";
        const evidence = triplesForNode(id)
          .slice(0, 2)
          .map(formatReadableTriple)
          .join("；");
        formatted.push(`${indentation}- ${formatNodeReference(id)}${evidence ? ` - 证据三元组：${evidence}` : ""}`);
        return;
      }

      if (!/^[-*]\s*/.test(trimmed)) inEvidenceNodeList = false;
    }

    formatted.push(line);
  });

  return replaceKnownNodeIds(formatted.join("\n"));
}

function triplesForNode(id: string) {
  return readableTriples.value.filter((triple) => triple.source === id || triple.target === id);
}

function formatReadableTriple(triple: { source: string; relation: string; target: string }) {
  return `${formatNodeReference(triple.source)} -> ${triple.relation} -> ${formatNodeReference(triple.target)}；ids: ${triple.source} -> ${triple.relation} -> ${triple.target}`;
}

function formatNodeReference(id: string) {
  const name = nodeNameById.value.get(id);
  return name && name !== id ? `${name}（id: ${id}）` : `id: ${id}`;
}

function replaceKnownNodeIds(answer: string) {
  return answer
    .replace(/（`([^`]+)`）/g, (_match, id: string) => (nodeNameById.value.has(id) ? `（id: ${id}）` : `（${id}）`))
    .replace(/`([^`]+)`/g, (match, id: string) => (nodeNameById.value.has(id) ? formatNodeReference(id) : match));
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
      question: buildPromptQuestion(question.value),
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
        <MarkdownRenderer v-if="displayAnswer" class="answer-text" :content="displayAnswer" />
        <div v-else class="empty-state">
          提交问题后将在这里显示回答
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
          运行问答后将在这里显示检索到的证据
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
