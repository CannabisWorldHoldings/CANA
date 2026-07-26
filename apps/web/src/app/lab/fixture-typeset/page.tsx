'use client';
import { Lab } from '../shell';
import { Wordmark } from '../wordmark';
/**
 * REJECTED FIXTURE — the typeset Space Grotesk approximation.
 * Retained ONLY so Brand Fidelity Court can prove it detects a substitute.
 * Never ship. Never present for owner selection.
 */
export default function FixtureTypeset() {
  return (
    <Lab label="FIXTURE · rejected typeset">
      <section style={{ padding: '10vh 5vw', display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 'min(840px, 92vw)' }}>
          <Wordmark variant="primary" height={172} />
        </div>
      </section>
    </Lab>
  );
}
