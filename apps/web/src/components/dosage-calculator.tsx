'use client';

import { useState } from 'react';

type ExperienceLevel = 'beginner' | 'intermediate' | 'experienced';

export default function DosageCalculator() {
  const [experience, setExperience] = useState<ExperienceLevel>('beginner');
  const [formType, setFormType] = useState<'edible' | 'tincture' | 'flower'>('edible');

  const getGuidance = () => {
    if (experience === 'beginner') {
      return {
        thc: '1 - 2.5 mg',
        cbd: '10 - 25 mg',
        description: 'Mild micro-dose for first-time patients seeking gentle relief with minimal intoxicating effects.',
      };
    }
    if (experience === 'intermediate') {
      return {
        thc: '5 - 10 mg',
        cbd: '5 - 15 mg',
        description: 'Standard moderate dose providing noticeable symptom relief and balanced effects.',
      };
    }
    return {
      thc: '15 - 30 mg+',
      cbd: '5 - 10 mg',
      description: 'High potency dose for experienced patients with established tolerance levels.',
    };
  };

  const guidance = getGuidance();

  return (
    <div className="border border-brand-border bg-brand-surface rounded-xl p-6 space-y-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-brand-border pb-4">
        <div>
          <span className="text-[10px] font-black uppercase tracking-widest text-brand-muted bg-brand-background border border-brand-border px-2.5 py-1 rounded">
            Interactive Guidance
          </span>
          <h2 className="text-xl font-extrabold text-brand-text mt-1">Patient Dosage Estimator</h2>
        </div>
        <span className="text-2xl">🧮</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Experience Level Selector */}
        <div>
          <label className="block text-xs font-bold text-brand-muted mb-2">Experience Level</label>
          <div className="grid grid-cols-3 gap-2">
            {(['beginner', 'intermediate', 'experienced'] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setExperience(level)}
                className={`py-2 px-2 text-xs font-bold rounded-md capitalize transition-all border ${
                  experience === level
                    ? 'bg-brand-primary-fill-strong text-white border-brand-primary'
                    : 'bg-brand-background text-brand-muted border-brand-border hover:border-brand-primary hover:text-brand-text'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Product Type Selector */}
        <div>
          <label className="block text-xs font-bold text-brand-muted mb-2">Product Format</label>
          <div className="grid grid-cols-3 gap-2">
            {(['edible', 'tincture', 'flower'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setFormType(type)}
                className={`py-2 px-2 text-xs font-bold rounded-md capitalize transition-all border ${
                  formType === type
                    ? 'bg-brand-primary-fill-strong text-white border-brand-primary'
                    : 'bg-brand-background text-brand-muted border-brand-border hover:border-brand-primary hover:text-brand-text'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Calculated Result Card */}
      <div className="border border-brand-border bg-brand-background/60 rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase text-brand-muted">Estimated Dosage Range</span>
          <span className="text-[10px] font-bold bg-brand-surface border border-brand-border px-2 py-0.5 rounded text-brand-text">
            Format: {formType}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="border border-brand-border bg-brand-surface p-3 rounded">
            <span className="text-[10px] font-bold text-brand-muted uppercase">Recommended THC</span>
            <div className="text-lg font-black text-brand-text">{guidance.thc}</div>
          </div>
          <div className="border border-brand-border bg-brand-surface p-3 rounded">
            <span className="text-[10px] font-bold text-brand-muted uppercase">Recommended CBD</span>
            <div className="text-lg font-black text-brand-text">{guidance.cbd}</div>
          </div>
        </div>

        <p className="text-xs text-brand-muted leading-relaxed pt-1">{guidance.description}</p>
      </div>

      <p className="text-[10px] text-brand-muted">
        Disclaimer: This tool provides general educational guidelines only. Always consult a licensed medical cannabis healthcare practitioner before beginning or adjusting dosage regimens.
      </p>
    </div>
  );
}
