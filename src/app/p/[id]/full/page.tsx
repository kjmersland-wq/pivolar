import { Suspense } from "react";
import { FullPreview } from "@/components/FullPreview";

// The project is read in the browser (projects live in localStorage), and the id comes from the address at run time, so the page waits for it inside Suspense.
export default function FullPreviewPage() {
  return (
    <Suspense fallback={null}>
      <FullPreview />
    </Suspense>
  );
}
