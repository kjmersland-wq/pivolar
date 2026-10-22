import { Workspace } from "@/components/Workspace";

// The project id is read in the browser (projects live in localStorage), so nothing here is request-bound.
export default function ProjectPage() {
  return <Workspace />;
}
