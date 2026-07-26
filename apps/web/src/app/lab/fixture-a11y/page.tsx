export const dynamic = 'force-static';
/**
 * REJECTED FIXTURE — deliberately inaccessible.
 * Exists ONLY so the A11y+Perf Court can prove it detects violations.
 * Never ship. Never link from a real surface.
 */
export default function A11yFixture() {
  return (
    <div style={{ background: '#FFFFFF', padding: 40 }}>
      {/* no h1, no main landmark */}
      <h2 style={{ color: '#CFCFCF' }}>Heading that skips a level</h2>
      <h4 style={{ color: '#D5D5D5' }}>Skipped from h2 to h4</h4>
      <p style={{ color: '#D8D8D8', fontSize: 12 }}>Text at roughly 1.4:1 contrast, far below AA.</p>
      <img src="/brand/orderweeddc-icon-256.png" width={40} height={40} />
      <button style={{ width: 14, height: 14, padding: 0, border: 'none', background: '#EEE' }} />
      <input type="text" style={{ width: 60 }} />
    </div>
  );
}
