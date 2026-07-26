'use client';
import { Lab } from '../shell';
import { BrandMark } from '../brand-mark';

/**
 * DIRECTION A — "MAISON"
 * Hero architecture: the WORDMARK IS THE HERO, set as a monumental centered
 * mark on an uninterrupted canvas. No slogan competes with it. Search is a
 * single refined line beneath. Evidence is demoted to a thin ticker at the
 * very bottom of the fold. Luxury-retail register (Aesop / Byredo), not SaaS.
 */
export default function DirectionA() {
  return (
    <Lab label="A · Maison">{(theme) => (<>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 5vw', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.62 }}>
        <span>Washington, D.C.</span>
        <nav style={{ display: 'flex', gap: 26 }}>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Dispensaries</a>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Products</a>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Deals</a>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>For business</a>
        </nav>
      </header>

      {/* THE BRAND MOMENT — occupies the optical center, nothing rivals it. */}
      <section style={{ padding: '4vh 5vw 0', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div style={{ width: 'min(880px, 92vw)' }}>
          <BrandMark theme={theme} width={840} maxWidthVw={88} />
        </div>
        <p style={{ marginTop: 30, fontSize: 15, lineHeight: 1.65, maxWidth: 470, opacity: 0.7 }}>
          Washington&rsquo;s cannabis directory, kept honest. Every menu, price and
          hour carries its source and the hour it was seen.
        </p>

        {/* Search as a single confident line, not a filter console. */}
        <form style={{ marginTop: 34, width: 'min(640px, 92vw)', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1.5px solid currentColor', paddingBottom: 12 }} onSubmit={e => e.preventDefault()}>
          <input
            placeholder="Search dispensaries, delivery, strains…"
            aria-label="Search"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'inherit', fontSize: 17, padding: '6px 0' }}
          />
          <button style={{ border: 'none', background: 'transparent', color: 'inherit', fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
            Search
          </button>
        </form>

        <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          {['Dupont Circle', 'Adams Morgan', 'Navy Yard', 'Capitol Hill', 'Shaw'].map(n => (
            <a key={n} href="#" style={{ fontSize: 12.5, padding: '7px 14px', borderRadius: 999, border: '1px solid currentColor', opacity: 0.55, textDecoration: 'none', color: 'inherit' }}>{n}</a>
          ))}
        </div>
      </section>

      {/* Evidence demoted to a restrained ticker — present, never dominant. */}
      <div style={{ marginTop: '6vh', borderTop: '1px solid currentColor', borderBottom: '1px solid currentColor', opacity: 0.72 }}>
        <div style={{ display: 'flex', gap: 40, padding: '13px 5vw', fontSize: 11.5, letterSpacing: '0.1em', textTransform: 'uppercase', flexWrap: 'wrap' }}>
          <span>5 labeled listings</span><span>0 verified current</span><span>0 active offers</span><span>2 guides</span>
          <span style={{ marginLeft: 'auto', opacity: 0.7 }}>Sponsorship never buys ranking</span>
        </div>
      </div>

      <section style={{ padding: '5vh 5vw' }}>
        <h2 style={{ fontSize: 13, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.55, fontWeight: 600 }}>Browse by format</h2>
        <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          {['Flower', 'Edibles', 'Vapes', 'Concentrates', 'Pre-rolls'].map((c, i) => (
            <a key={c} href="#" style={{ position: 'relative', aspectRatio: '4/5', borderRadius: 3, overflow: 'hidden', textDecoration: 'none', color: '#fff', display: 'block' }}>
              <img src={`/marketplace/product-${i % 4}.webp`} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,.05))' }} />
              <span style={{ position: 'absolute', bottom: 14, left: 14, fontSize: 15, fontWeight: 600 }}>{c}</span>
            </a>
          ))}
        </div>
      </section>
    </>)}</Lab>
  );
}
