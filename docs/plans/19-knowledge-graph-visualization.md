# Plan 19: Knowledge Graph Visualization Page

Add `/entities/<id>/knowledge-graph` page showing the current knowledge graph state as an interactive graph with clickable nodes and edges.

---

## Feasibility: Yes, absolutely doable with PostgreSQL

**You don't need to change the data store.** PostgreSQL is perfectly adequate for this use case. The current schema has everything needed:

- `graphNodes` table: id, type, name, properties (JSONB)
- `graphEdges` table: id, type, sourceId, targetId, properties (JSONB)

Graph databases like Neo4j are only necessary when you need complex traversal queries (shortest path, graph algorithms). For visualization, you just need to load all nodes/edges for an entity and transform them into the library's format.

---

## Recommended Library: Reagraph

For your use case, I'd recommend [**Reagraph**](https://github.com/reaviz/reagraph):

**Why it fits:**
- WebGL-based rendering via react-three-fiber for good performance
- Simple API - `<GraphCanvas nodes={nodes} edges={edges} />`
- Built-in `onNodeClick` and `onEdgeClick` callbacks for inspection
- Multiple layout algorithms (force-directed, hierarchical, radial, etc.)
- Handles drag, zoom, pan out of the box
- Dynamic node sizing (PageRank, Centrality, Attribute-based)
- Active maintenance and good documentation at [reagraph.dev](https://reagraph.dev/)

**Other solid options:**
- [react-force-graph](https://github.com/vasturiano/react-force-graph) - Canvas-based, 2D/3D/VR/AR versions
- [Cytoscape.js](https://js.cytoscape.org) - Most mature, many layout algorithms
- [D3.js](https://d3js.org) - Most flexible but requires more custom code

---

## Implementation Overview

1. **API Route** (`/api/entities/[id]/graph`): Fetch all nodes and edges for the entity, transform to the library's format

2. **Page** (`/entities/[id]/knowledge-graph/page.tsx`): Server component that checks auth and fetches entity

3. **Client Component** (`KnowledgeGraphView`):
   - Dynamically import the graph library (required for SSR compatibility)
   - Render interactive graph
   - On node/edge click, show a side panel or modal with properties

4. **Add link** to entity detail page's quick actions (alongside Chat, Interactions, Briefings)

---

## Next.js/SSR Consideration

Reagraph depends on WebGL and browser APIs. You'll need to use Next.js dynamic imports with `ssr: false`:

```tsx
const GraphCanvas = dynamic(
  () => import('reagraph').then((mod) => mod.GraphCanvas),
  { ssr: false }
)
```

---

## Data Transformation

The current `getNodesByEntity()` and related queries in `src/lib/db/queries/graph-data.ts` already return what you need. Transform to Reagraph's format:

```ts
// Nodes require 'id', can include 'label' and custom data
nodes: [
  { id: 'uuid-1', label: 'Node Name', type: 'Company', data: { ...properties } },
  { id: 'uuid-2', label: 'Another Node', type: 'Person', data: { ...properties } }
]

// Edges require 'id', 'source', 'target'
edges: [
  { id: 'edge-uuid', source: 'uuid-1', target: 'uuid-2', label: 'works_at' }
]
```

---

## Performance Notes

The codebase already limits graph serialization to ~100 nodes for LLM context. For visualization:
- Reagraph's WebGL renderer handles larger graphs well (500+ nodes)
- Consider filtering by node type for focused exploration
- Search/filter UI to focus on specific parts of the graph
- Dynamic node sizing can highlight important nodes (e.g., by connection count)

---

## Implementation Tasks

1. Install `reagraph` dependency
2. Create API route `/api/entities/[id]/graph/route.ts`
3. Create page `/entities/[id]/knowledge-graph/page.tsx`
4. Create client component `KnowledgeGraphView` with dynamic import of `GraphCanvas`
5. Add node/edge click handlers with properties panel (side panel or modal)
6. Add "Knowledge Graph" button to entity detail page quick actions
