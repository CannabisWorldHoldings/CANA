import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { tenantRetailerWhere } from '@/lib/tenant-retailer.mjs';
import { publicSubmissionErrorMessage } from '@/lib/public-submission.mjs';

type Props = {
  params: Promise<{ domain: string; id: string }>;
  searchParams: Promise<{ submitted?: string; error?: string }>;
};

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props) {
  const { domain, id } = await params;
  const brand = await prisma.brand.findUnique({
    where: { domain },
    select: { id: true },
  });
  const retailer = brand
    ? await prisma.retailer.findFirst({
        where: tenantRetailerWhere(brand.id, id),
        select: { name: true },
      })
    : null;

  return {
    title: retailer
      ? `Correct ${retailer.name} | Order Weed DC`
      : 'Retailer Correction | Order Weed DC',
    description:
      'Submit a source-backed correction for administrator review without changing the public record directly.',
    robots: {
      index: false,
      follow: true,
    },
  };
}

export default async function RetailerCorrectionPage({ params, searchParams }: Props) {
  const { domain, id } = await params;
  const resolvedSearchParams = await searchParams;
  const submitted = resolvedSearchParams.submitted === '1';
  const errorMessage = publicSubmissionErrorMessage(resolvedSearchParams.error);

  const brand = await prisma.brand.findUnique({
    where: { domain },
  });

  if (!brand) notFound();
  const brandId = brand.id;

  const retailer = await prisma.retailer.findFirst({
    where: tenantRetailerWhere(brandId, id),
  });

  if (!retailer) notFound();

  return (
    <div className="flex-grow flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-brand-background text-brand-text animate-fade-in">
      <div className="sm:mx-auto sm:w-full sm:max-w-lg text-center space-y-2">
        <Link href={`/retailer/${id}`} className="text-xs font-semibold text-brand-muted hover:text-brand-primary-text mb-3 inline-block transition-colors">
          ← Back to profile
        </Link>
        <br />
        <span className="text-orange-700 font-black text-xs border border-orange-500/30 bg-orange-500/10 px-3 py-1 rounded-full uppercase tracking-widest">
          Information Dispute Portal
        </span>
        <h1 className="text-3xl font-extrabold text-brand-text tracking-tight">Submit Correction for {retailer.name}</h1>
        <p className="text-sm text-brand-muted max-w-md mx-auto">
          Identify a potentially incorrect field and submit a primary-source reference for administrator review.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="bg-brand-surface border border-brand-border py-8 px-4 shadow-sm sm:rounded-lg sm:px-10 space-y-6">

          {submitted ? (
            <div className="bg-brand-primary/10 border border-brand-primary/20 text-brand-primary-text p-5 rounded-lg space-y-3">
              <h2 className="text-sm font-bold">📥 Correction Request Filed</h2>
              <p className="text-xs text-brand-muted leading-relaxed">
                Your correction request and evidence reference were submitted for administrator review.
              </p>
              <div className="pt-2">
                <Link href={`/retailer/${id}`} className="bg-brand-primary-fill-strong text-white font-bold text-xs px-4 py-2 rounded inline-block hover:brightness-110 transition-all">
                  Return to Profile
                </Link>
              </div>
            </div>
          ) : (
            <form
              action={`/retailer/${id}/correction/submission`}
              method="post"
              className="space-y-5"
            >

              {errorMessage && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-700 p-3 rounded text-xs">
                  Error: {errorMessage}
                </div>
              )}

              <div>
                <label htmlFor="correction-email" className="block text-xs font-bold text-brand-muted uppercase tracking-wider mb-2">
                  Your Contact Email / Association
                </label>
                <input
                  id="correction-email"
                  name="filedBy"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  placeholder="auditor@dispensary.com"
                  className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary transition-colors"
                />
              </div>

              <div>
                <label htmlFor="correction-field" className="block text-xs font-bold text-brand-muted uppercase tracking-wider mb-2">
                  Incorrect Field to Correct
                </label>
                <select
                  id="correction-field"
                  name="fieldName"
                  required
                  className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary transition-colors"
                >
                  <option value="address">Storefront Address</option>
                  <option value="phone">Contact Phone Number</option>
                  <option value="hours">Hours of Operation</option>
                  <option value="licenseNumber">ABCA License Number</option>
                  <option value="name">Business Name</option>
                </select>
              </div>

              <div>
                <label htmlFor="correction-value" className="block text-xs font-bold text-brand-muted uppercase tracking-wider mb-2">
                  Corrected New Value
                </label>
                <input
                  id="correction-value"
                  name="newValue"
                  type="text"
                  required
                  maxLength={240}
                  placeholder="Enter the correct information..."
                  className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary transition-colors"
                />
              </div>

              <div>
                <label htmlFor="correction-evidence" className="block text-xs font-bold text-brand-muted uppercase tracking-wider mb-2">
                  Public HTTPS Evidence URL (PDF / Image)
                </label>
                <input
                  id="correction-evidence"
                  name="evidenceUrl"
                  type="url"
                  required
                  maxLength={2048}
                  inputMode="url"
                  placeholder="https://public-source.example/record.pdf"
                  className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary transition-colors"
                />
              </div>

              <div>
                <label htmlFor="correction-reason" className="block text-xs font-bold text-brand-muted uppercase tracking-wider mb-2">
                  Explanation / Reason for Correction
                </label>
                <textarea
                  id="correction-reason"
                  name="reason"
                  required
                  minLength={10}
                  maxLength={1000}
                  rows={3}
                  placeholder="Explain why the current listed value is incorrect..."
                  className="w-full bg-brand-background border border-brand-border rounded-md px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary transition-colors"
                ></textarea>
              </div>

              <div className="bg-amber-400/5 border border-amber-400/20 p-4 rounded text-xs text-amber-800 leading-relaxed">
                ℹ️ <strong>Dispute queue:</strong> A submission places the record in review. An administrator must validate the evidence before changing a non-demonstration listing; submission alone never creates a verified state.
              </div>

              <div>
                <button
                  type="submit"
                  className="w-full bg-brand-primary-fill-strong text-white font-extrabold text-sm py-3 px-4 rounded-md hover:brightness-110 active:scale-98 transition-all"
                >
                  Submit Correction & Enter Queue
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
