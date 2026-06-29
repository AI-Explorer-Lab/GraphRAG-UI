<script setup lang="ts">
defineEmits<{
  goImport: [];
}>();
</script>

<template>
  <section class="overview-intro">
    <article class="overview-hero panel">
      <div class="overview-hero-copy">
        <div class="panel-kicker">GraphRAG</div>
        <h2>让每一次风控判断都有迹可循</h2>
        <p>
          用结构化 JSON 或自然语言导入业务链路后，系统会把主体、账户、设备、交易、特征、模型、规则和处置动作统一到同一张
          graph 里，后续的子图探索、证据问答和影响分析都会围绕这张 graph 展开
        </p>
        <button class="primary-btn overview-import-btn" type="button" @click="$emit('goImport')">导入图谱</button>
      </div>

      <div class="overview-graph-mark" aria-hidden="true">
        <span class="mark-node n1"></span>
        <span class="mark-node n2"></span>
        <span class="mark-node n3"></span>
        <span class="mark-node n4"></span>
        <span class="mark-line l1"></span>
        <span class="mark-line l2"></span>
        <span class="mark-line l3"></span>
      </div>
    </article>
  </section>
</template>
