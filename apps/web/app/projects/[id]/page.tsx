import { use } from "react";
import { ProjectView } from "../../../components/ProjectView.js";

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  return <ProjectView id={resolvedParams.id} />;
}
