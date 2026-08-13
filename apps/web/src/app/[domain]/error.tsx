'use client';

export default function CustomerWorldError({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="mx-auto w-full max-w-screen-2xl px-4 py-16 sm:px-6 lg:px-10">
      <p className="kicker">Customer World</p>
      <h1 className="mt-3 font-display text-3xl font-bold text-brand-text">Verified customer discovery is temporarily unavailable.</h1>
      <p className="mt-3 max-w-2xl text-sm text-brand-muted">No empty market or availability conclusion was inferred from the failed read.</p>
      <button type="button" onClick={reset} className="mt-6 min-h-11 rounded-lg bg-brand-primary-fill-strong px-5 text-sm font-bold text-white">Try again</button>
    </div>
  );
}
