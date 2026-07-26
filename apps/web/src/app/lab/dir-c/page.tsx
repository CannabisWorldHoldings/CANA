'use client';
import { Lab } from '../shell';
import { Wordmark } from '../wordmark';

/**
 * DIRECTION C — "KIOSK"
 * Hero architecture: asymmetric split. A fixed brand rail on the left holds the
 * wordmark rotated to vertical at large scale (permanent brand presence, on
 * every scroll). The right side is an immediately-useful live result surface —
 * no marketing slogan at all, discovery starts in the first pixel.
 * Register: premium transit/retail kiosk — functional, dense, confident.
 */
export default function DirectionC() {
  return (
    <Lab label="C · Kiosk">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, 22vw) 1fr', minHeight: '100vh' }} className="owd-kiosk">
        {/* FIXED BRAND RAIL — brand is permanent architecture, not a header afterthought. */}
        <aside style={{ borderRight: '1px solid currentColor', padding: '26px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'sticky', top: 0, height: '100vh' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.55 }}>Washington<br />D.C.</div>
          <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
            <div style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}>
              <Wordmark variant="primary" height={124} />
            </div>
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13 }}>
            {['Dispensaries', 'Delivery', 'Products', 'Deals', 'Neighborhoods', 'For business'].map(n => (
              <a key={n} href="#" style={{ color: 'inherit', textDecoration: 'none', opacity: 0.75 }}>{n}</a>
            ))}
          </nav>
        </aside>

        {/* WORKING SURFACE — discovery in the first pixel. */}
        <main style={{ padding: '26px 3vw' }}>
          <form onSubmit={e => e.preventDefault()} style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <input placeholder="Search dispensaries, delivery, products, neighborhoods…" aria-label="Search"
              style={{ flex: '1 1 300px', border: '1.5px solid currentColor', background: 'transparent', color: 'inherit', fontSize: 15.5, padding: '14px 16px', borderRadius: 2, outline: 'none' }} />
            <select aria-label="Type" style={{ border: '1.5px solid currentColor', background: 'transparent', color: 'inherit', padding: '14px 12px', borderRadius: 2, fontSize: 14 }}>
              <option>All types</option><option>Storefront</option><option>Delivery</option>
            </select>
            <select aria-label="Sort" style={{ border: '1.5px solid currentColor', background: 'transparent', color: 'inherit', padding: '14px 12px', borderRadius: 2, fontSize: 14 }}>
              <option>Truth-first</option><option>Recently updated</option>
            </select>
            <button style={{ background: '#0a5c37', color: '#fff', border: 'none', padding: '0 26px', borderRadius: 2, fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}>Search</button>
          </form>

          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
            {['Dupont Circle', 'Adams Morgan', 'Navy Yard', 'Capitol Hill', 'Shaw', 'Downtown'].map(n => (
              <a key={n} href="#" style={{ padding: '6px 12px', border: '1px solid currentColor', borderRadius: 999, opacity: 0.6, textDecoration: 'none', color: 'inherit' }}>{n}</a>
            ))}
          </div>

          <div style={{ marginTop: 26, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <a key={i} href="#" style={{ border: '1px solid currentColor', borderRadius: 3, overflow: 'hidden', textDecoration: 'none', color: 'inherit', display: 'block' }}>
                <div style={{ aspectRatio: '16/10', overflow: 'hidden' }}>
                  <img src={`/marketplace/${i % 2 ? 'retailer' : 'product'}-${i % 4}.webp`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ padding: '12px 13px' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 650 }}>Demo Retailer {['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'][i]}</div>
                  <div style={{ marginTop: 5, fontSize: 11.5, opacity: 0.62 }}>Demonstration only · source: local seed</div>
                  <div style={{ marginTop: 9, display: 'flex', gap: 6, fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    <span style={{ padding: '3px 8px', border: '1px solid currentColor', borderRadius: 999, opacity: 0.7 }}>{i % 2 ? 'Delivery' : 'Storefront'}</span>
                    <span style={{ padding: '3px 8px', borderRadius: 999, background: '#0a5c37', color: '#fff' }}>Labeled</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </main>
      </div>
      <style>{`@media (max-width: 820px){ .owd-kiosk{ grid-template-columns: 1fr !important; } .owd-kiosk > aside{ position: static !important; height: auto !important; flex-direction: row !important; align-items: center; border-right: none !important; border-bottom: 1px solid currentColor; } .owd-kiosk > aside > div:nth-child(2) > div{ transform: none !important; } .owd-kiosk > aside > nav{ display: none !important; } }`}</style>
    </Lab>
  );
}
