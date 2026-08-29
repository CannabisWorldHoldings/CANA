import React from 'react';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { createOwnerCanaIntelligenceAdapters } from '@/lib/cana-intelligence/canonical-owner-adapter';

export const metadata = {
  title: 'CANA Owner Console | Canonical Read-Only Intelligence',
  description: 'Authenticated read-only view of canonical CANA intelligence inputs. Execution remains sealed.',
};

export const dynamic = 'force-dynamic';

export default async function AdminConsolePage() {
  await requireAdmin();
  const adapters = createOwnerCanaIntelligenceAdapters();
  const [principal, verifiedSupply, observations, intentEvents] = await Promise.all([
    adapters.intelligence.resolveVerifiedPrincipal(),
    adapters.intelligence.loadVerifiedSupply(),
    adapters.intelligence.loadObservations(),
    adapters.intelligence.loadIntentEvents(),
  ]);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-neutral-100 font-sans p-6 max-w-6xl mx-auto">
      <header className="border-b border-neutral-800 pb-4 mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-mono font-semibold tracking-wider text-emerald-400">
            CANA CONSOLE Ω — SOVEREIGN COMMAND
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Canonical read-only intelligence is connected. Governed write and execution effects remain sealed.
          </p>
        </div>
        <div className="flex gap-3 text-xs font-mono">
          <span className="px-2 py-1 bg-emerald-950/60 border border-emerald-800 text-emerald-300 rounded">
            ACCESS: ADMIN SESSION
          </span>
          <span className="px-2 py-1 bg-neutral-900 border border-neutral-700 text-neutral-300 rounded">
            EDGE CONFIG: STAGED
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-neutral-900/50 border border-neutral-800 rounded-lg p-5 flex flex-col h-[650px]">
          <div className="flex-1 overflow-y-auto space-y-4 font-mono text-sm pr-2">
            <div className="p-3 bg-neutral-950/80 border border-neutral-800 rounded text-neutral-300">
              <span className="text-emerald-400 font-bold">OWNER_CANONICAL_READ_ONLY:</span>{' '}
              Authenticated CANA host reads are live for the canonical tenant. Command, promotion, and execution effects remain unavailable here.
            </div>
            <div className="p-3 bg-emerald-950/20 border border-emerald-900/40 rounded text-emerald-200">
              <span className="text-neutral-400 text-xs block mb-1">CANONICAL OWNER PRINCIPAL:</span>
              {principal.verified ? 'VERIFIED BY canonical assertAdmin' : 'NOT VERIFIED'}
            </div>
            <div
              className="grid grid-cols-2 gap-3"
              data-cana-owner-bridge="read-only"
              data-cana-tenant={adapters.tenant}
            >
              <div className="p-3 bg-neutral-950 border border-neutral-800 rounded">
                <span className="block text-neutral-500 text-xs">VERIFIED SUPPLY</span>
                <strong className="text-emerald-300 text-lg">{verifiedSupply.length}</strong>
              </div>
              <div className="p-3 bg-neutral-950 border border-neutral-800 rounded">
                <span className="block text-neutral-500 text-xs">OBSERVATIONS</span>
                <strong className="text-emerald-300 text-lg">{observations.length}</strong>
              </div>
              <div className="p-3 bg-neutral-950 border border-neutral-800 rounded">
                <span className="block text-neutral-500 text-xs">INTENT EVENTS</span>
                <strong className="text-emerald-300 text-lg">{intentEvents.length}</strong>
              </div>
              <div className="p-3 bg-neutral-950 border border-neutral-800 rounded">
                <span className="block text-neutral-500 text-xs">WRITE / EXECUTE</span>
                <strong className="text-amber-300 text-sm">SEALED</strong>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-neutral-800 flex gap-2">
            <input
              type="text"
              placeholder="Command transport is not connected in Stage 1"
              disabled
              aria-disabled="true"
              className="flex-1 bg-neutral-950 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-emerald-500 font-mono"
            />
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="bg-neutral-800 text-neutral-500 font-mono font-bold px-4 py-2 text-sm rounded cursor-not-allowed"
            >
              NOT CONNECTED
            </button>
          </div>
        </section>

        <section className="space-y-6">
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-5">
            <h2 className="text-xs font-mono font-bold text-neutral-300 uppercase tracking-wider mb-3">
              Telemetry & Sealed Gates
            </h2>
            <ul className="space-y-2 text-xs font-mono">
              <li className="flex justify-between p-2 bg-neutral-950 rounded border border-neutral-800/60">
                <span className="text-neutral-400">PostGIS Kernel:</span>
                <span className="text-emerald-400">SCHEMA CANONICAL</span>
              </li>
              <li className="flex justify-between p-2 bg-neutral-950 rounded border border-neutral-800/60">
                <span className="text-neutral-400">Zero Pay-to-Rank:</span>
                <span className="text-emerald-400">POLICY CANONICAL</span>
              </li>
              <li className="flex justify-between p-2 bg-neutral-950 rounded border border-neutral-800/60">
                <span className="text-neutral-400">Provenance Gate:</span>
                <span className="text-emerald-400">CANONICAL READS</span>
              </li>
              <li className="flex justify-between p-2 bg-neutral-950 rounded border border-neutral-800/60">
                <span className="text-neutral-400">Authority Effects:</span>
                <span className="text-amber-400">SEALED</span>
              </li>
            </ul>
          </div>

          <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-5">
            <h2 className="text-xs font-mono font-bold text-neutral-300 uppercase tracking-wider mb-3">
              Protected Navigation
            </h2>
            <div className="space-y-2 text-xs font-mono">
              <Link
                href="/admin/site-intelligence"
                className="block w-full text-center p-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded transition-colors"
              >
                Open Site Intelligence Hub
              </Link>
              <Link
                href="/compare"
                className="block w-full text-center p-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded transition-colors"
              >
                Inspect Public Retailer Court
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
