export type AskMode = "agent" | "noagent";

export type RelationType =
  | "owns"
  | "uses"
  | "transfers_to"
  | "provides_to"
  | "scores"
  | "triggers";

export interface ImportResponse {
  graph_id: string;
  metadata: Record<string, number>;
  chunks: number;
  falkordb: Record<string, unknown>;
  entities: number;
  transitions: number;
  has_relations: number;
  focus_node_id?: string | null;
  auto_built: boolean;
}

export interface ChecklistItem {
  label: string;
  ok: boolean;
  value?: string | number | boolean | null;
}

export interface GraphPreviewResponse {
  entities: number;
  transitions: number;
  has_relations: number;
  metadata: Record<string, number>;
  chunks: number;
  focus_node_id?: string | null;
  relation_counts: Record<string, number>;
  relation_types: string[];
  checklist: ChecklistItem[];
}

export interface TextImportResponse extends ImportResponse {
  graph_json?: Record<string, unknown>;
  extraction: {
    source: string;
    text_length: number;
    fallback_reason?: string | null;
    elapsed_seconds?: number;
  };
}

export interface SubgraphNode {
  id: string;
  display_id?: string;
  label: string;
  level: number;
  properties: Record<string, unknown>;
}

export interface SubgraphEdge {
  source: string;
  target: string;
  relation: string;
  relation_properties: Record<string, unknown>;
  evidence_refs: string[];
}

export interface SubgraphResponse {
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  view?: string;
}

export interface AskResponse {
  answer: string;
  sub_questions: Array<Record<string, string>>;
  involved_types: Record<string, string[]>;
  retrieval: {
    triples?: string[];
    chunk_ids?: string[];
    chunk_contents?: string[];
    paths?: unknown[];
    reasoning_steps?: Array<Record<string, unknown>>;
    mode?: string;
    [key: string]: unknown;
  };
}

export interface ImpactPath {
  path: string[];
  relations: string[];
  depth: number;
}

export interface ImpactResponse {
  answer?: string;
  answer_source?: string;
  llm_called?: boolean;
  impact_subgraph?: SubgraphResponse;
  direct_impacts: string[];
  indirect_impacts: string[];
  target_impact: string[];
  scoped_impact: string[];
  evidence_paths: ImpactPath[];
  summary?: string;
  impact_summary?: string;
  analysis?: string;
  narrative?: string;
  [key: string]: unknown;
}

export interface ApiErrorPayload {
  detail?: string;
}
