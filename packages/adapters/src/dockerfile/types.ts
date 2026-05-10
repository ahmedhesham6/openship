export type DockerfileInstructionKeyword =
  | "ADD"
  | "ARG"
  | "CMD"
  | "COPY"
  | "ENTRYPOINT"
  | "ENV"
  | "EXPOSE"
  | "FROM"
  | "HEALTHCHECK"
  | "LABEL"
  | "RUN"
  | "SHELL"
  | "STOPSIGNAL"
  | "USER"
  | "VOLUME"
  | "WORKDIR"
  | "ONBUILD"
  | "MAINTAINER"
  | "OTHER";

export interface DockerfileInstruction {
  keyword: DockerfileInstructionKeyword;
  originalKeyword: string;
  value: string;
  flags: Record<string, string | boolean>;
  line: number;
  raw: string;
}

export interface DockerfileParseResult {
  instructions: DockerfileInstruction[];
  warnings: WorkspacePlanDiagnostic[];
}

export type WorkspacePlanSeverity = "warning" | "unsupported" | "error";

export interface WorkspacePlanDiagnostic {
  severity: WorkspacePlanSeverity;
  instruction?: DockerfileInstructionKeyword;
  line?: number;
  message: string;
}

export type DockerfileCommandForm = "shell" | "exec";

export interface WorkspaceCommand {
  form: DockerfileCommandForm;
  value: string | string[];
  raw: string;
}

export interface WorkspaceExposedPort {
  port: number;
  protocol: "tcp" | "udp";
}

export interface WorkspaceCopyStep {
  kind: "copy" | "add";
  sources: string[];
  destination: string;
  from?: string;
  workdir: string;
  flags: Record<string, string | boolean>;
  line: number;
  raw: string;
}

export interface WorkspaceRunStep {
  command: string;
  form: DockerfileCommandForm;
  exec?: string[];
  workdir: string;
  env: Record<string, string>;
  args: Record<string, string | null>;
  flags: Record<string, string | boolean>;
  line: number;
  raw: string;
}

export type WorkspaceStageStep =
  | { type: "copy"; copy: WorkspaceCopyStep }
  | { type: "run"; run: WorkspaceRunStep };

export interface WorkspaceBuildStagePlan {
  index: number;
  name?: string;
  baseImage: string;
  platform?: string;
  workdir: string;
  env: Record<string, string>;
  args: Record<string, string | null>;
  labels: Record<string, string>;
  copies: WorkspaceCopyStep[];
  runs: WorkspaceRunStep[];
  steps: WorkspaceStageStep[];
  exposedPorts: WorkspaceExposedPort[];
  cmd?: WorkspaceCommand;
  entrypoint?: WorkspaceCommand;
  startCommand?: string;
  user?: string;
  shell?: string[];
  unsupported: WorkspacePlanDiagnostic[];
}

export interface WorkspaceRuntimePlan {
  workdir: string;
  env: Record<string, string>;
  exposedPort?: number;
  exposedPorts: WorkspaceExposedPort[];
  startCommand?: string;
  user?: string;
  baseImage?: string;
}

export interface WorkspaceBuildPlan {
  source: "dockerfile";
  globalArgs: Record<string, string | null>;
  stages: WorkspaceBuildStagePlan[];
  finalStage: WorkspaceBuildStagePlan | null;
  runtime: WorkspaceRuntimePlan | null;
  diagnostics: WorkspacePlanDiagnostic[];
  isMultiStage: boolean;
  requiresDockerSemantics: boolean;
}

export interface CompileDockerfileOptions {
  defaultWorkdir?: string;
  buildArgs?: Record<string, string>;
  targetStage?: string;
}
