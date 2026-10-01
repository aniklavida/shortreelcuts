import { use } from "react";
import { PlanView } from "../../../../components/PlanView.js";

export default function PlanEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  return <PlanView id={resolvedParams.id} />;
}
