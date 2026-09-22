import type { Metadata } from "next";
import Link from "next/link";
import { getCertificate, mayViewCertificate } from "@/lib/certificates/store";

async function publicCertificate(id: string) {
  const certificate = await getCertificate(id);
  if (!certificate || !(await mayViewCertificate(certificate))) return null;
  return certificate;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const certificate = await publicCertificate(id);
  if (!certificate) return { title: "Certificate | IB Smart Campus", robots: { index: false, follow: false } };
  const title = `${certificate.title} · ${certificate.issuerName}`;
  const description = `Earned on IB Smart Campus, powered by icebrkr.`;
  return {
    title,
    description,
    alternates: { canonical: `/certificates/share/${id}` },
    openGraph: { type: "article", title, description, url: `/certificates/share/${id}`, images: [{ url: certificate.imageUrl, width: 1200, height: 850, alt: certificate.title }] },
    twitter: { card: "summary_large_image", title, description, images: [certificate.imageUrl] },
  };
}

export default async function CertificateSharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const certificate = await publicCertificate(id);
  return (
    <main className="certificate-public-page">
      <Link href="/">← Smart Campus</Link>
      {certificate ? (
        <article className="cert-card cert-share-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated image route served directly */}
          <a href={`${certificate.imageUrl}?download=1`}><img src={certificate.imageUrl} alt={certificate.title} /></a>
          <div>
            <span className={`cert-source ${certificate.source}`}>{certificate.source === "internal" ? "Smart Campus award" : "Self-uploaded"}</span>
            <h3>{certificate.title}</h3>
            <p>{certificate.issuerName} · {new Date(certificate.createdAt).toLocaleDateString()}</p>
          </div>
        </article>
      ) : (
        <div className="cert-empty"><h3>Certificate not available</h3><p>This certificate is private or no longer exists.</p></div>
      )}
    </main>
  );
}
