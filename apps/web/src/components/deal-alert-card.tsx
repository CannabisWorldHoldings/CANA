'use client';

import React, { useState } from 'react';
import { Mail, Phone, CheckCircle2, Zap } from 'lucide-react';

export function DealAlertCard() {
  const [channel, setChannel] = useState<'EMAIL' | 'SMS'>('EMAIL');
  const [contact, setContact] = useState('');
  const [frequency, setFrequency] = useState('DAILY');
  const [neighborhood, setNeighborhood] = useState('All D.C.');
  const [consentCheck, setConsentCheck] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; receipt?: string; error?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentCheck) {
      setResult({ success: false, error: 'Please check the consent box to proceed.' });
      return;
    }
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/v1/customer/optin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact, frequency, neighborhood, consentCheck }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, receipt: data.consentReceipt });
      } else {
        setResult({ success: false, error: data.error || 'Failed to record consent.' });
      }
    } catch (err: any) {
      setResult({ success: false, error: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-brand-border bg-brand-surface p-6 sm:p-8 shadow-sm space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
            <Zap size={13} aria-hidden="true" />
            GET VERIFIED D.C. DEAL ALERTS
          </span>
          <h2 className="mt-2 font-display text-xl font-extrabold text-brand-text">
            Never Miss a Verified D.C. Price Drop
          </h2>
          <p className="mt-1 text-xs text-brand-muted">
            Direct alerts from licensed D.C. retailers. Choose email OR phone — 1-click unsubscribe anytime.
          </p>
        </div>
      </div>

      {result?.success ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 space-y-3">
          <div className="flex items-center gap-2 text-emerald-600 font-extrabold text-sm">
            <CheckCircle2 size={18} />
            Alert Subscription Confirmed!
          </div>
          <p className="text-xs text-brand-muted leading-relaxed">
            Your voluntary opt-in has been persisted in the canonical consent ledger.
          </p>
          <div className="bg-brand-background border border-brand-border rounded-lg p-3 text-[11px] font-mono text-brand-text">
            Consent Receipt: <span className="font-bold text-emerald-600">{result.receipt}</span>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex items-center gap-2 p-1 bg-brand-background rounded-xl border border-brand-border">
            <button
              type="button"
              onClick={() => { setChannel('EMAIL'); setContact(''); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                channel === 'EMAIL' ? 'bg-brand-surface text-brand-primary-text shadow-sm' : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              <Mail size={14} /> Email Alert
            </button>
            <button
              type="button"
              onClick={() => { setChannel('SMS'); setContact(''); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                channel === 'SMS' ? 'bg-brand-surface text-brand-primary-text shadow-sm' : 'text-brand-muted hover:text-brand-text'
              }`}
            >
              <Phone size={14} /> SMS Alert
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold text-brand-text mb-1.5">
              {channel === 'EMAIL' ? 'Your Email Address' : 'Your Mobile Phone Number'}
            </label>
            <input
              type={channel === 'EMAIL' ? 'email' : 'tel'}
              required
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={channel === 'EMAIL' ? 'name@example.com' : '(202) 555-0199'}
              className="w-full rounded-xl border border-brand-border bg-brand-background px-4 py-2.5 text-xs text-brand-text placeholder-brand-muted focus:border-brand-primary-text focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-brand-muted mb-1">Alert Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full rounded-lg border border-brand-border bg-brand-background px-3 py-2 text-xs text-brand-text focus:outline-none"
              >
                <option value="DAILY">Daily Digest</option>
                <option value="WEEKLY">Weekly Summary</option>
                <option value="REALTIME">Instant Price Drops</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-brand-muted mb-1">Preferred Zone</label>
              <select
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className="w-full rounded-lg border border-brand-border bg-brand-background px-3 py-2 text-xs text-brand-text focus:outline-none"
              >
                <option value="All D.C.">All D.C. Neighborhoods</option>
                <option value="Dupont Circle">Dupont Circle</option>
                <option value="Adams Morgan">Adams Morgan</option>
                <option value="Navy Yard">Navy Yard</option>
                <option value="Capitol Hill">Capitol Hill</option>
                <option value="Shaw">Shaw</option>
              </select>
            </div>
          </div>

          <div className="flex items-start gap-2.5 pt-1">
            <input
              type="checkbox"
              id="deal-consent"
              checked={consentCheck}
              onChange={(e) => setConsentCheck(e.target.checked)}
              className="mt-0.5 rounded border-brand-border text-emerald-600 focus:ring-emerald-500"
            />
            <label htmlFor="deal-consent" className="text-[11px] text-brand-muted leading-tight">
              I explicitly consent to receive verified D.C. cannabis deal alerts via {channel}. I understand I can unsubscribe anytime by clicking the link or replying STOP. Zero spam guarantee.
            </label>
          </div>

          {result?.error && (
            <p className="text-xs font-bold text-red-500">{result.error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-primary-fill-strong py-3 text-xs font-extrabold text-white transition-all hover:brightness-110 disabled:opacity-50"
          >
            {loading ? 'Subscribing...' : 'Get Verified D.C. Deal Alerts →'}
          </button>
        </form>
      )}
    </div>
  );
}
