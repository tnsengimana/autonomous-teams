export interface ObserverQuery {
  objective: string;
  reasoning: string;
  searchHints: string[];
}

export interface ObserverInsight {
  observation: string;
  relevantNodeIds: string[];
  synthesisDirection: string;
}

export interface QueryIdentificationOutput extends Record<string, unknown> {
  queries: ObserverQuery[];
}

export interface InsightIdentificationOutput extends Record<string, unknown> {
  insights: ObserverInsight[];
}
