import type {
  DockerfileInstruction,
  DockerfileInstructionKeyword,
  DockerfileParseResult,
  WorkspacePlanDiagnostic,
} from "./types";

const KNOWN_KEYWORDS = new Set<DockerfileInstructionKeyword>([
  "ADD",
  "ARG",
  "CMD",
  "COPY",
  "ENTRYPOINT",
  "ENV",
  "EXPOSE",
  "FROM",
  "HEALTHCHECK",
  "LABEL",
  "RUN",
  "SHELL",
  "STOPSIGNAL",
  "USER",
  "VOLUME",
  "WORKDIR",
  "ONBUILD",
  "MAINTAINER",
]);

const FLAGGED_KEYWORDS = new Set<DockerfileInstructionKeyword>([
  "ADD",
  "COPY",
  "FROM",
  "RUN",
]);

function isCommentLine(line: string): boolean {
  return line.trimStart().startsWith("#");
}

function endsWithContinuation(line: string): boolean {
  let slashCount = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === "\\"; i--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function joinLogicalLines(source: string): Array<{ line: number; raw: string }> {
  const result: Array<{ line: number; raw: string }> = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let current = "";
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const stripped = lines[i].trimEnd();

    if (!current && (!stripped.trim() || isCommentLine(stripped))) {
      continue;
    }

    if (current && isCommentLine(stripped)) {
      continue;
    }

    if (!current) {
      startLine = lineNo;
    }

    if (endsWithContinuation(stripped)) {
      current += `${stripped.slice(0, -1).trimEnd()} `;
      continue;
    }

    current += stripped;
    const raw = current.trim();
    if (raw) {
      result.push({ line: startLine, raw });
    }
    current = "";
  }

  if (current.trim()) {
    result.push({ line: startLine, raw: current.trim() });
  }

  return result;
}

function parseLeadingFlags(value: string): {
  flags: Record<string, string | boolean>;
  rest: string;
} {
  const flags: Record<string, string | boolean> = {};
  let rest = value.trimStart();

  while (rest.startsWith("--")) {
    const match = rest.match(/^--([A-Za-z0-9_.-]+)(?:=("[^"]*"|'[^']*'|\S+))?(?=\s|$)/);
    if (!match) break;

    const [, name, rawValue] = match;
    flags[name] = rawValue === undefined
      ? true
      : rawValue.replace(/^["']|["']$/g, "");
    rest = rest.slice(match[0].length).trimStart();
  }

  return { flags, rest };
}

function toKeyword(value: string): DockerfileInstructionKeyword {
  const upper = value.toUpperCase() as DockerfileInstructionKeyword;
  return KNOWN_KEYWORDS.has(upper) ? upper : "OTHER";
}

export function parseDockerfile(source: string): DockerfileParseResult {
  const diagnostics: WorkspacePlanDiagnostic[] = [];
  const instructions: DockerfileInstruction[] = [];

  for (const logical of joinLogicalLines(source)) {
    const match = logical.raw.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*(.*)$/);
    if (!match) {
      diagnostics.push({
        severity: "warning",
        line: logical.line,
        message: `Could not parse Dockerfile instruction: ${logical.raw}`,
      });
      continue;
    }

    const originalKeyword = match[1];
    const keyword = toKeyword(originalKeyword);
    const rawValue = match[2] ?? "";
    const parsed = FLAGGED_KEYWORDS.has(keyword)
      ? parseLeadingFlags(rawValue)
      : { flags: {}, rest: rawValue.trimStart() };

    instructions.push({
      keyword,
      originalKeyword,
      value: parsed.rest,
      flags: parsed.flags,
      line: logical.line,
      raw: logical.raw,
    });
  }

  return { instructions, warnings: diagnostics };
}
