'use client';
import { Lab } from '../shell';
import { BrandMark } from '../brand-mark';

/**
 * DIRECTION B — "NOCTURNE"
 * Hero architecture: full-bleed cinematic D.C. image with the wordmark locked
 * bottom-left over it, at scale. Search overlays the image edge. No headline
 * slogan at all — the brand plus the city IS the message. Evidence appears
 * only after scroll. Register: premium hospitality / spirits campaign.
 */
export default function DirectionB() {
  return (
    <Lab theme="night" label="B · Nocturne">{(theme) => (<>
      <header style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 4vw', color: '#fff' }}>
        <span style={{ fontSize: 11.5, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.8 }}>Washington, D.C. · 21+</span>
        <nav style={{ display: 'flex', gap: 24, fontSize: 12.5 }}>
          {['Dispensaries', 'Delivery', 'Products', 'Deals'].map(n => (
            <a key={n} href="#" style={{ color: '#fff', textDecoration: 'none', opacity: 0.86 }}>{n}</a>
          ))}
          <a href="#" style={{ color: '#fff', textDecoration: 'none', fontWeight: 700, borderBottom: '1.5px solid #12d67f' }}>List your business</a>
        </nav>
      </header>

      {/* FULL-BLEED CINEMATIC FRAME */}
      <section style={{ position: 'relative', height: '86vh', minHeight: 560, overflow: 'hidden' }}>
        <img src="/marketplace/hero-marketplace-v2.webp" alt="Washington, D.C. at dusk" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(0,0,0,.9) 0%, rgba(0,0,0,.55) 42%, rgba(0,0,0,.22) 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #000 2%, transparent 42%)' }} />

        {/* Brand locked bottom-left, at scale, over the image. */}
        <div style={{ position: 'absolute', left: '4vw', bottom: '7vh', right: '4vw' }}>
          <div style={{ width: 'min(720px, 86vw)' }}>
            <BrandMark theme={theme} width={660} maxWidthVw={84} />
          </div>
          <p style={{ marginTop: 18, color: '#E8F5EE', fontSize: 16, maxWidth: 430, lineHeight: 1.6, opacity: 0.9 }}>
            Find what&rsquo;s actually open, actually stocked, actually priced —
            across every D.C. neighborhood.
          </p>

          <form onSubmit={e => e.preventDefault()} style={{ marginTop: 26, display: 'flex', maxWidth: 620, background: 'rgba(255,255,255,.09)', backdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 2, overflow: 'hidden' }}>
            <input placeholder="Dispensary, delivery, strain or neighborhood" aria-label="Search"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 15.5, padding: '17px 18px' }} />
            <button style={{ background: '#0a5c37', color: '#fff', border: 'none', padding: '0 28px', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}>Search</button>
          </form>
        </div>
      </section>

      {/* Evidence lives BELOW the fold, as a quiet strip. */}
      <section style={{ padding: '30px 4vw', borderBottom: '1px solid #16241c' }}>
        <div style={{ display: 'flex', gap: 46, flexWrap: 'wrap', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8FA89A' }}>
          <span>5 labeled listings</span><span>0 verified current</span><span>0 active offers</span><span>2 D.C. guides</span>
          <span style={{ marginLeft: 'auto', color: '#12d67f' }}>No pay-to-rank</span>
        </div>
      </section>

      <section style={{ padding: '46px 4vw' }}>
        <h2 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>Tonight in the District</h2>
        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {[0, 1, 2, 3].map(i => (
            <a key={i} href="#" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ position: 'relative', aspectRatio: '3/2', borderRadius: 2, overflow: 'hidden' }}>
                <img src={`/marketplace/retailer-${i}.webp`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div style={{ marginTop: 11, fontSize: 15, fontWeight: 600 }}>Demo Retailer {['Alpha', 'Beta', 'Gamma', 'Delta'][i]}</div>
              <div style={{ marginTop: 5, fontSize: 12, color: '#8FA89A' }}>Demonstration only · source: local seed</div>
            </a>
          ))}
        </div>
      </section>
    </>)}</Lab>
  );
}
