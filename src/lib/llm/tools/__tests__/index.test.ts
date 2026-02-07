import { beforeAll, describe, expect, test } from 'vitest';

import { registerGraphTools } from '../graph-tools';
import { registerWebTools } from '../web-tools';
import {
  getAnalysisGenerationTools,
  getAdviceGenerationTools,
  getGraphConstructionTools,
  getKnowledgeAcquisitionTools,
} from '../index';

describe('getGraphConstructionTools', () => {
  beforeAll(() => {
    registerGraphTools();
  });

  test('includes type creation tools for graph construction', () => {
    const toolNames = getGraphConstructionTools().map((tool) => tool.schema.name);

    expect(toolNames).toContain('queryGraph');
    expect(toolNames).toContain('addGraphNode');
    expect(toolNames).toContain('addGraphEdge');
    expect(toolNames).toContain('listNodeTypes');
    expect(toolNames).toContain('listEdgeTypes');
    expect(toolNames).toContain('createNodeType');
    expect(toolNames).toContain('createEdgeType');
  });
});

describe('getAnalysisGenerationTools', () => {
  beforeAll(() => {
    registerGraphTools();
  });

  test('includes edge discovery tools for analysis generation', () => {
    const toolNames = getAnalysisGenerationTools().map((tool) => tool.schema.name);

    expect(toolNames).toContain('queryGraph');
    expect(toolNames).toContain('listEdgeTypes');
    expect(toolNames).toContain('addAgentAnalysisNode');
    expect(toolNames).toContain('addGraphEdge');
  });
});

describe('getAdviceGenerationTools', () => {
  beforeAll(() => {
    registerGraphTools();
  });

  test('includes edge discovery tools for advice generation', () => {
    const toolNames = getAdviceGenerationTools().map((tool) => tool.schema.name);

    expect(toolNames).toContain('queryGraph');
    expect(toolNames).toContain('listEdgeTypes');
    expect(toolNames).toContain('addAgentAdviceNode');
    expect(toolNames).toContain('addGraphEdge');
  });
});

describe('getKnowledgeAcquisitionTools', () => {
  beforeAll(() => {
    registerWebTools();
  });

  test('includes search and extract tools only', () => {
    const toolNames = getKnowledgeAcquisitionTools().map((tool) => tool.schema.name);

    expect(toolNames).toContain('webSearch');
    expect(toolNames).toContain('webExtract');
  });
});
