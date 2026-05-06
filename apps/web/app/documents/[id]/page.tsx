import DocumentDetailClient from "./document-detail-client";

export const metadata = { title: "Document · PFM" };
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function DocumentDetailPage(props: { params: Params }) {
  const { id } = await props.params;
  return <DocumentDetailClient documentId={id} />;
}
