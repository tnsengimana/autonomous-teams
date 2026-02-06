import { describe, expect, test } from "vitest";

import { validateKnowledgeAcquisitionOutput } from "../validation";

describe("validateKnowledgeAcquisitionOutput", () => {
  test("passes for valid findings and source ledger with inline citations", () => {
    const markdown = `## Findings
NVIDIA reported quarterly revenue growth driven by data center demand [S1].
- Gross margin guidance remained elevated versus the prior year [S1].
- A major hyperscaler announced expanded GPU capacity commitments [S2].

## Source Ledger
### [S1]
url: https://example.com/nvidia-earnings
title: NVIDIA Q4 Earnings Release
published_at: 2026-01-28

### [S2]
url: https://example.com/hyperscaler-capacity
title: Hyperscaler Capacity Expansion Announcement
published_at: 2026-01-29`;

    const result = validateKnowledgeAcquisitionOutput(markdown);

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.citedSourceIds).toEqual(["S1", "S2"]);
    expect(result.ledgerSourceIds).toEqual(["S1", "S2"]);
  });

  test("fails when required sections are missing", () => {
    const markdown = `## Summary
Revenue expanded meaningfully [S1].`;

    const result = validateKnowledgeAcquisitionOutput(markdown);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Missing required section header: `## Findings`",
    );
    expect(result.errors).toContain(
      "Missing required section header: `## Source Ledger`",
    );
  });

  test("fails when findings include uncited claims", () => {
    const markdown = `## Findings
The company announced a dividend increase.

## Source Ledger
### [S1]
url: https://example.com/dividend
title: Dividend Announcement
published_at: 2026-02-01`;

    const result = validateKnowledgeAcquisitionOutput(markdown);

    expect(result.isValid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes("missing inline source citation"),
      ),
    ).toBe(true);
  });

  test("fails when cited source is missing from source ledger", () => {
    const markdown = `## Findings
Operating margin expanded sequentially [S4].

## Source Ledger
### [S1]
url: https://example.com/margins
title: Margin Analysis
published_at: 2026-02-01`;

    const result = validateKnowledgeAcquisitionOutput(markdown);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Findings cites [S4] but no matching Source Ledger entry exists",
    );
  });

  test("fails when required source fields are missing", () => {
    const markdown = `## Findings
Order backlog increased quarter over quarter [S1].

## Source Ledger
### [S1]
url: https://example.com/backlog
title: `;

    const result = validateKnowledgeAcquisitionOutput(markdown);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Source Ledger entry [S1] is missing required field: title",
    );
    expect(result.errors).toContain(
      "Source Ledger entry [S1] is missing required field: published_at",
    );
  });
});
