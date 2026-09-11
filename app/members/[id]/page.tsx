import Link from "next/link";
import { CertificateGallery } from "@/components/certificates/certificate-gallery";
export default async function PublicMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="certificate-public-page"><Link href="/">← Smart Campus</Link><CertificateGallery userId={id} owner={false} /></main>;
}
