import { DocumentsList } from "@/components/documents/documents-list";

export const metadata = { title: "Documents · PFM" };
export const dynamic = "force-dynamic";

export default function DocumentsPage() {
  return (
    <>
      <section className="hero heroCompact">
        <p className="eyebrow">Documents</p>
        <h1>Upload tax forms, statements, and more.</h1>
        <p className="lede">
          The advisor extracts key financial facts from your uploads and
          uses them to personalize its advice. Files stay private — only
          you can see them.
        </p>
      </section>
      <DocumentsList />
    </>
  );
}
