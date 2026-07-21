import type { Project } from "../types/scene";
import { downloadBlob, safeFilename } from "./download";

export function saveProjectFile(project: Project) {
  downloadBlob(
    new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }),
    `${safeFilename(project.name)}.json`,
  );
}

export function parseProjectFile(text: string): Project {
  const data = JSON.parse(text) as Project;
  if (
    data?.version !== 1 ||
    typeof data.nodes !== "object" ||
    data.nodes === null ||
    !Array.isArray(data.rootOrder)
  ) {
    throw new Error("Not a valid project file.");
  }
  // Drop dangling references rather than failing outright.
  data.rootOrder = data.rootOrder.filter((id) => id in data.nodes);
  if (typeof data.name !== "string" || !data.name) data.name = "Untitled";
  return data;
}
