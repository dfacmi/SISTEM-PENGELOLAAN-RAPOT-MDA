import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { ConfirmDialogState } from '../types/mda';

interface ConfirmDialogProps {
  dialog: ConfirmDialogState;
  onClose: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ dialog, onClose }) => {
  const [submitting, setSubmitting] = useState(false);

  if (!dialog.open) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await dialog.onConfirm();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const isDanger = dialog.variant === 'danger';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-3 sm:p-4 overflow-y-auto no-print"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md max-h-[90dvh] flex flex-col rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden my-auto">
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                isDanger
                  ? 'bg-rose-50 text-rose-600 border border-rose-200'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}
            >
              {isDanger ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
            </div>
            <h3 className="font-display font-bold text-slate-900 text-sm sm:text-base min-w-0 break-words leading-snug">
              {dialog.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center"
            aria-label="Tutup dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-4 text-xs sm:text-sm text-slate-600 leading-relaxed break-words overflow-y-auto">
          {dialog.message}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-2.5 px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-50 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-full sm:w-auto min-h-[42px] sm:min-h-0 px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className={`w-full sm:w-auto min-h-[42px] sm:min-h-0 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors whitespace-nowrap shrink-0 ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400'
                : 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400'
            }`}
          >
            {submitting ? 'Memproses...' : dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
