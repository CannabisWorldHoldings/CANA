export default function CustomerWorldLoading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto w-full max-w-screen-2xl px-4 py-16 sm:px-6 lg:px-10">
      <p className="kicker">Customer World</p>
      <h1 className="mt-3 font-display text-3xl font-bold text-brand-text">Loading verified customer discovery...</h1>
      <p className="mt-3 max-w-2xl text-sm text-brand-muted">CANA is checking the selected market contract and current Reality evidence. No result is shown before that gate completes.</p>
    </div>
  );
}
