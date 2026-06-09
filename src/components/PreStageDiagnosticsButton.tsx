'use client';

/**
 * <PreStageDiagnosticsButton /> — v3.2b
 *
 * Thin client wrapper that opens <DiagnosticPreStageModal> on click.
 * Replaces v2's <PreStageLabButton> (lab-only). Same role: server
 * components on /reception render one of these per encounter row.
 */
import { useState } from 'react';
import { DiagnosticPreStageModal } from './DiagnosticPreStageModal';

export type PreStageDiagnosticsButtonProps = {
  encounterId: string;
  patientName: string;
  /** Count of any-modality pre-staged orders already on encounter. */
  existingPreStagedCount?: number;
};

export function PreStageDiagnosticsButton({
  encounterId,
  patientName,
  existingPreStagedCount,
}: PreStageDiagnosticsButtonProps) {
  const [open, setOpen] = useState(false);
  const has = (existingPreStagedCount ?? 0) > 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider transition ${
          has
            ? 'border-even-blue-300 bg-even-blue-50 text-even-blue-900 hover:border-even-blue-400'
            : 'border-even-ink-200 bg-white text-even-ink-500 hover:border-even-blue-200 hover:bg-even-blue-50'
        }`}
        title={has ? `${existingPreStagedCount} test${existingPreStagedCount === 1 ? '' : 's'} pre-staged` : 'Pre-stage diagnostics'}
      >
        <span>🧪</span>
        {has ? `+${existingPreStagedCount}` : 'Dx'}
      </button>
      <DiagnosticPreStageModal
        encounterId={encounterId}
        patientName={patientName}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
