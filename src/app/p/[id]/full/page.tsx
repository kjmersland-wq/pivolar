import { FullPreview } from "@/components/FullPreview";

// The project is read in the browser (projects live in localStorage), so nothing here is request-bound.
export default function FullPreviewPage() {
  return <FullPreview />;
}
