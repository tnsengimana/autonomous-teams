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

export interface ObserverOutput extends Record<string, unknown> {
  queries: ObserverQuery[];
  insights: ObserverInsight[];
}
