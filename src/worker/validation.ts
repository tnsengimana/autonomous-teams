/**
 * Validates Knowledge Acquisition markdown output for strict source traceability.
 *
 * Required structure:
 * - ## Findings
 * - ## Source Ledger
 *
 * Findings claims must include [S#] inline citations.
 * Source Ledger must define each cited source with url/title/published_at.
 */

export interface KnowledgeAcquisitionOutputValidation {
  isValid: boolean;
  errors: string[];
  citedSourceIds: string[];
  ledgerSourceIds: string[];
}

type LedgerEntry = {
  url?: string;
  title?: string;
  published_at?: string;
};

const REQUIRED_LEDGER_FIELDS = ["url", "title", "published_at"] as const;
const FINDINGS_HEADING_REGEX = /^##\s+Findings\s*$/i;
const SOURCE_LEDGER_HEADING_REGEX = /^##\s+Source Ledger\s*$/i;
const SOURCE_SECTION_REGEX = /^###\s+\[(S\d+)\]\s*$/i;
const SOURCE_FIELD_REGEX = /^(url|title|published_at):\s*(.+)$/i;
const SOURCE_CITATION_REGEX = /\[(S\d+)\]/gi;

function findHeadingIndex(lines: string[], pattern: RegExp): number {
  return lines.findIndex((line) => pattern.test(line.trim()));
}

function normalizeSourceId(sourceId: string): string {
  return sourceId.toUpperCase();
}

function extractSourceIds(text: string): string[] {
  const ids = new Set<string>();
  let match = SOURCE_CITATION_REGEX.exec(text);
  while (match) {
    ids.add(normalizeSourceId(match[1]));
    match = SOURCE_CITATION_REGEX.exec(text);
  }

  SOURCE_CITATION_REGEX.lastIndex = 0;
  return Array.from(ids);
}

function parseFindings(findingsLines: string[]): {
  claims: string[];
  uncitedClaims: string[];
  citedSourceIds: Set<string>;
} {
  const claims: string[] = [];
  const uncitedClaims: string[] = [];
  const citedSourceIds = new Set<string>();

  const evaluateClaim = (claim: string): void => {
    const trimmed = claim.trim();
    if (!trimmed) {
      return;
    }

    claims.push(trimmed);
    const sourceIds = extractSourceIds(trimmed);

    if (sourceIds.length === 0) {
      uncitedClaims.push(trimmed);
      return;
    }

    for (const sourceId of sourceIds) {
      citedSourceIds.add(sourceId);
    }
  };

  let paragraphBuffer: string[] = [];
  const flushParagraph = (): void => {
    if (paragraphBuffer.length === 0) {
      return;
    }

    evaluateClaim(paragraphBuffer.join(" "));
    paragraphBuffer = [];
  };

  for (const rawLine of findingsLines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    if (line.startsWith("#")) {
      flushParagraph();
      continue;
    }

    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^>\s*/.test(line)) {
      flushParagraph();
      evaluateClaim(line);
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushParagraph();

  return { claims, uncitedClaims, citedSourceIds };
}

function parseSourceLedger(ledgerLines: string[]): {
  entries: Map<string, LedgerEntry>;
  errors: string[];
} {
  const entries = new Map<string, LedgerEntry>();
  const errors: string[] = [];

  let currentSourceId: string | null = null;
  let currentEntry: LedgerEntry = {};

  const saveCurrentEntry = (): void => {
    if (!currentSourceId) {
      return;
    }

    if (entries.has(currentSourceId)) {
      errors.push(
        `Duplicate source entry in Source Ledger for [${currentSourceId}]`,
      );
      return;
    }

    entries.set(currentSourceId, currentEntry);
  };

  for (const rawLine of ledgerLines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const sourceMatch = line.match(SOURCE_SECTION_REGEX);
    if (sourceMatch) {
      saveCurrentEntry();
      currentSourceId = normalizeSourceId(sourceMatch[1]);
      currentEntry = {};
      continue;
    }

    if (!currentSourceId) {
      continue;
    }

    const fieldMatch = line.match(SOURCE_FIELD_REGEX);
    if (fieldMatch) {
      const key = fieldMatch[1].toLowerCase() as keyof LedgerEntry;
      const value = fieldMatch[2].trim();
      currentEntry[key] = value;
    }
  }

  saveCurrentEntry();

  if (entries.size === 0) {
    errors.push(
      "Source Ledger must contain at least one source subsection like `### [S1]`",
    );
    return { entries, errors };
  }

  for (const [sourceId, entry] of entries) {
    for (const requiredField of REQUIRED_LEDGER_FIELDS) {
      if (!entry[requiredField] || entry[requiredField]?.trim().length === 0) {
        errors.push(
          `Source Ledger entry [${sourceId}] is missing required field: ${requiredField}`,
        );
      }
    }
  }

  return { entries, errors };
}

export function validateKnowledgeAcquisitionOutput(
  markdownOutput: string,
): KnowledgeAcquisitionOutputValidation {
  const errors: string[] = [];
  const lines = markdownOutput.split(/\r?\n/);

  const findingsIndex = findHeadingIndex(lines, FINDINGS_HEADING_REGEX);
  const sourceLedgerIndex = findHeadingIndex(lines, SOURCE_LEDGER_HEADING_REGEX);

  if (findingsIndex === -1) {
    errors.push("Missing required section header: `## Findings`");
  }

  if (sourceLedgerIndex === -1) {
    errors.push("Missing required section header: `## Source Ledger`");
  }

  if (findingsIndex !== -1 && sourceLedgerIndex !== -1 && sourceLedgerIndex <= findingsIndex) {
    errors.push("`## Source Ledger` must appear after `## Findings`");
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      citedSourceIds: [],
      ledgerSourceIds: [],
    };
  }

  const findingsLines = lines.slice(findingsIndex + 1, sourceLedgerIndex);
  const { claims, uncitedClaims, citedSourceIds } = parseFindings(findingsLines);

  if (claims.length === 0) {
    errors.push("`## Findings` must contain at least one claim");
  }

  if (citedSourceIds.size === 0) {
    errors.push("`## Findings` must contain at least one inline citation like [S1]");
  }

  for (const uncitedClaim of uncitedClaims) {
    errors.push(
      `Findings claim is missing inline source citation [S#]: "${uncitedClaim}"`,
    );
  }

  const sourceLedgerLines = lines.slice(sourceLedgerIndex + 1);
  const { entries, errors: ledgerErrors } = parseSourceLedger(sourceLedgerLines);
  errors.push(...ledgerErrors);

  const ledgerSourceIds = new Set(entries.keys());

  for (const citedSourceId of citedSourceIds) {
    if (!ledgerSourceIds.has(citedSourceId)) {
      errors.push(
        `Findings cites [${citedSourceId}] but no matching Source Ledger entry exists`,
      );
    }
  }

  for (const ledgerSourceId of ledgerSourceIds) {
    if (!citedSourceIds.has(ledgerSourceId)) {
      errors.push(
        `Source Ledger entry [${ledgerSourceId}] is never cited in Findings`,
      );
    }
  }

  const sortedCitedSourceIds = Array.from(citedSourceIds).sort();
  const sortedLedgerSourceIds = Array.from(ledgerSourceIds).sort();

  return {
    isValid: errors.length === 0,
    errors,
    citedSourceIds: sortedCitedSourceIds,
    ledgerSourceIds: sortedLedgerSourceIds,
  };
}
