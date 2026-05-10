export { parseDockerfile } from "./parser";
export {
  compileDockerfileParseResult,
  compileDockerfileToWorkspacePlan,
} from "./compiler";

export type {
  CompileDockerfileOptions,
  DockerfileCommandForm,
  DockerfileInstruction,
  DockerfileInstructionKeyword,
  DockerfileParseResult,
  WorkspaceBuildPlan,
  WorkspaceBuildStagePlan,
  WorkspaceCommand,
  WorkspaceCopyStep,
  WorkspaceExposedPort,
  WorkspacePlanDiagnostic,
  WorkspacePlanSeverity,
  WorkspaceRuntimePlan,
  WorkspaceRunStep,
  WorkspaceStageStep,
} from "./types";
