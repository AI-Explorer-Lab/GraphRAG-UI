<script setup lang="ts">
import { computed } from "vue";

type InlinePart =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string };

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4; parts: InlinePart[] }
  | { type: "paragraph"; parts: InlinePart[] }
  | { type: "list"; ordered: boolean; items: InlinePart[][] }
  | { type: "table"; headers: string[]; rows: string[][]; columnCount: number }
  | { type: "code"; text: string };

const props = defineProps<{
  content: string;
}>();

const blocks = computed(() => parseMarkdown(props.content || ""));

function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const result: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      result.push({ type: "code", text: codeLines.join("\n") });
      continue;
    }

    const heading = parseHeading(trimmed);
    if (heading) {
      result.push(heading);
      index += 1;
      continue;
    }

    if (isTableLine(trimmed)) {
      const parsed = readTable(lines, index);
      result.push(parsed.block);
      index = parsed.nextIndex;
      continue;
    }

    if (isListItem(trimmed)) {
      const ordered = isOrderedListItem(trimmed);
      const items: InlinePart[][] = [];
      while (index < lines.length && isListItem(lines[index].trim()) && isOrderedListItem(lines[index].trim()) === ordered) {
        items.push(parseInline(stripListMarker(lines[index].trim())));
        index += 1;
      }
      result.push({ type: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current || current.startsWith("```") || parseHeading(current) || isTableLine(current) || isListItem(current)) break;
      paragraphLines.push(current);
      index += 1;
    }
    result.push({ type: "paragraph", parts: parseInline(paragraphLines.join("\n")) });
  }

  return result;
}

function parseHeading(line: string): MarkdownBlock | null {
  const match = /^(#{1,4})\s+(.+)$/.exec(line);
  if (!match) return null;
  return {
    type: "heading",
    level: match[1].length as 1 | 2 | 3 | 4,
    parts: parseInline(match[2].trim())
  };
}

function readTable(lines: string[], startIndex: number): { block: MarkdownBlock; nextIndex: number } {
  const tableRows: string[][] = [];
  let index = startIndex;

  while (index < lines.length && isTableLine(lines[index].trim())) {
    tableRows.push(splitTableRow(lines[index].trim()));
    index += 1;
  }

  const hasHeaderSeparator = tableRows.length > 1 && isSeparatorRow(tableRows[1]);
  const headers = hasHeaderSeparator ? tableRows[0] : [];
  const rows = hasHeaderSeparator ? tableRows.slice(2) : tableRows;
  const columnCount = Math.max(headers.length, ...rows.map((row) => row.length), 1);

  return {
    block: { type: "table", headers, rows, columnCount },
    nextIndex: index
  };
}

function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) {
      parts.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push({ kind: "code", text: token.slice(1, -1) });
    } else {
      parts.push({ kind: "strong", text: token.slice(2, -2) });
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push({ kind: "text", text: text.slice(lastIndex) });
  }

  return parts.length ? parts : [{ kind: "text", text }];
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function normalizedRow(row: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => row[index] || "");
}

function isTableLine(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|") && line.includes("|");
}

function isSeparatorRow(row: string[]): boolean {
  return row.length > 0 && row.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function isListItem(line: string): boolean {
  return /^([-*+]|\d+\.)\s+/.test(line);
}

function isOrderedListItem(line: string): boolean {
  return /^\d+\.\s+/.test(line);
}

function stripListMarker(line: string): string {
  return line.replace(/^([-*+]|\d+\.)\s+/, "");
}
</script>

<template>
  <div class="markdown-renderer">
    <template v-for="(block, blockIndex) in blocks" :key="`${block.type}-${blockIndex}`">
      <component :is="`h${block.level}`" v-if="block.type === 'heading'" class="markdown-heading">
        <template v-for="(part, partIndex) in block.parts" :key="partIndex">
          <strong v-if="part.kind === 'strong'">{{ part.text }}</strong>
          <code v-else-if="part.kind === 'code'">{{ part.text }}</code>
          <span v-else>{{ part.text }}</span>
        </template>
      </component>

      <p v-else-if="block.type === 'paragraph'" class="markdown-paragraph">
        <template v-for="(part, partIndex) in block.parts" :key="partIndex">
          <strong v-if="part.kind === 'strong'">{{ part.text }}</strong>
          <code v-else-if="part.kind === 'code'">{{ part.text }}</code>
          <span v-else>{{ part.text }}</span>
        </template>
      </p>

      <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.type === 'list'" class="markdown-list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <template v-for="(part, partIndex) in item" :key="partIndex">
            <strong v-if="part.kind === 'strong'">{{ part.text }}</strong>
            <code v-else-if="part.kind === 'code'">{{ part.text }}</code>
            <span v-else>{{ part.text }}</span>
          </template>
        </li>
      </component>

      <div v-else-if="block.type === 'table'" class="markdown-table-wrap">
        <table>
          <thead v-if="block.headers.length">
            <tr>
              <th v-for="(header, headerIndex) in block.headers" :key="headerIndex">{{ header }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
              <td v-for="(cell, cellIndex) in normalizedRow(row, block.columnCount)" :key="cellIndex">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <pre v-else class="markdown-code">{{ block.text }}</pre>
    </template>
  </div>
</template>
