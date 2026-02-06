import { describe, expect, test } from "vitest";
import { normalizeObserverPlanRelevantNodeIds } from "../observer-plan-normalization";

describe("normalizeObserverPlanRelevantNodeIds", () => {
  test("resolves UUIDs, typed names, and plain names to UUIDs", () => {
    const nodes = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        type: "Company",
        name: "NVIDIA Corporation (NVDA)",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        type: "Company",
        name: "Meta Platforms, Inc. (META)",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        type: "AgentAnalysis",
        name: "NVDA Volume Spike Analysis",
      },
    ];

    const plan = {
      queries: [{ objective: "test", reasoning: "test", searchHints: [] }],
      insights: [
        {
          observation: "test observation",
          relevantNodeIds: [
            "NVIDIA Corporation (NVDA)",
            "Company: Meta Platforms, Inc. (META)",
            "33333333-3333-4333-8333-333333333333",
            "AgentAnalysis: NVDA Volume Spike Analysis",
            "33333333-3333-4333-8333-333333333333", // duplicate
          ],
          synthesisDirection: "test direction",
        },
      ],
    };

    const result = normalizeObserverPlanRelevantNodeIds(plan, nodes);

    expect(result.normalizedPlan.insights[0].relevantNodeIds).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(result.resolvedByName).toBe(3);
    expect(result.resolvedByUuid).toBe(2);
    expect(result.droppedReferences).toEqual([]);
  });

  test("drops unresolved and ambiguous references", () => {
    const nodes = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "Company",
        name: "Duplicate Name",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        type: "Sector",
        name: "Duplicate Name",
      },
    ];

    const plan = {
      queries: [],
      insights: [
        {
          observation: "ambiguous refs",
          relevantNodeIds: [
            "Duplicate Name", // ambiguous plain name
            "Company: Missing Company", // missing typed ref
            "00000000-0000-4000-8000-000000000000", // UUID-like but unknown
            "",
          ],
          synthesisDirection: "none",
        },
      ],
    };

    const result = normalizeObserverPlanRelevantNodeIds(plan, nodes);

    expect(result.normalizedPlan.insights[0].relevantNodeIds).toEqual([]);
    expect(result.droppedReferences).toEqual([
      "Duplicate Name",
      "Company: Missing Company",
      "00000000-0000-4000-8000-000000000000",
      "",
    ]);
  });

  test("extracts embedded UUIDs from descriptive references", () => {
    const nodes = [
      {
        id: "9f2a78a6-2bd2-4d6d-8a6e-5af2f8fbc617",
        type: "Company",
        name: "Acme Corp",
      },
    ];

    const plan = {
      queries: [],
      insights: [
        {
          observation: "embedded uuid",
          relevantNodeIds: [
            "Acme Corp (id: 9f2a78a6-2bd2-4d6d-8a6e-5af2f8fbc617)",
          ],
          synthesisDirection: "none",
        },
      ],
    };

    const result = normalizeObserverPlanRelevantNodeIds(plan, nodes);

    expect(result.normalizedPlan.insights[0].relevantNodeIds).toEqual([
      "9f2a78a6-2bd2-4d6d-8a6e-5af2f8fbc617",
    ]);
    expect(result.resolvedByUuid).toBe(1);
    expect(result.droppedReferences).toEqual([]);
  });
});
