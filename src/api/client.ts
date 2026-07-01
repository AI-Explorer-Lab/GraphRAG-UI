import type {
  AskMode,
  AskResponse,
  GraphPreviewResponse,
  ImpactResponse,
  ImportResponse,
  RelationType,
  SubgraphResponse,
  TextImportResponse
} from "../types/api";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload?.detail) {
        message = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
      }
    } catch {
      // Keep the HTTP message when the backend returns non-JSON errors.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function importGraph(graphId: string, graphJson: Record<string, unknown>) {
  return requestJson<ImportResponse>("/v1/graphs/import", {
    method: "POST",
    body: JSON.stringify({
      graph_id: graphId,
      graph_json: graphJson
    })
  });
}

export function previewGraph(graphJson: Record<string, unknown>) {
  return requestJson<GraphPreviewResponse>("/v1/graphs/preview", {
    method: "POST",
    body: JSON.stringify({
      graph_json: graphJson
    })
  });
}

export function importGraphFromText(payload: {
  graphId: string;
  text: string;
  schemaHint?: string;
}) {
  return requestJson<TextImportResponse>("/v1/graphs/import-text", {
    method: "POST",
    body: JSON.stringify({
      graph_id: payload.graphId,
      text: payload.text,
      schema_hint: payload.schemaHint?.trim() || null
    })
  });
}

export function fetchSubgraph(graphId: string, nodeId: string | undefined, hops: number, view = "full") {
  const params = new URLSearchParams({ hops: String(hops), view });
  const trimmedNodeId = nodeId?.trim();
  if (trimmedNodeId) params.set("node_id", trimmedNodeId);
  return requestJson<SubgraphResponse>(`/v1/graphs/${encodeURIComponent(graphId)}/subgraph?${params.toString()}`);
}

export function fetchGraphIds() {
  return requestJson<{ graphs: string[] }>("/v1/graphs");
}

export function syncGraphIds() {
  return requestJson<{ enabled: boolean; available: boolean; loaded: number; graphs: string[]; errors: string[] }>("/v1/graphs/sync", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function askGraph(payload: {
  graphId: string;
  question: string;
  topK: number;
  mode: AskMode;
  maxSteps: number;
}) {
  return requestJson<AskResponse>("/v1/queries/ask", {
    method: "POST",
    body: JSON.stringify({
      graph_id: payload.graphId,
      question: payload.question,
      top_k: payload.topK,
      mode: payload.mode,
      max_steps: payload.maxSteps
    })
  });
}

export function runImpact(payload: {
  graphId: string;
  scenario?: string;
  language?: string;
  source: string;
  target: string;
  relation: RelationType;
  maxDepth: number;
  scope?: string;
  targetNodeId?: string;
}) {
  return requestJson<ImpactResponse>("/v1/impact/what-if", {
    method: "POST",
    body: JSON.stringify({
      graph_id: payload.graphId,
      scenario: payload.scenario?.trim() || null,
      language: payload.language?.trim() || null,
      change_spec: {
        source: payload.source,
        target: payload.target,
        relation: payload.relation,
        max_depth: payload.maxDepth,
        scope: payload.scope || null,
        relation_property_patch: {}
      },
      target_node_id: payload.targetNodeId || null
    })
  });
}

export async function loadBundledExample() {
  const [graph, text] = await Promise.all([
    fetch("/examples/financial_risk_graph.json").then((res) => res.json()),
    fetch("/examples/financial_risk_input.txt").then((res) => res.text())
  ]);
  return { graph, text: text.trim() };
}
