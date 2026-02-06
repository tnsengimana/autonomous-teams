import { beforeAll, describe, expect, test } from 'vitest';

import { registerGraphTools } from '../graph-tools';
import { getGraphConstructionTools } from '../index';

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
