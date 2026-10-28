'use client';
// A real confirmation dialog, for the destructive actions the app now has.
//
// Until this, every confirmation in the product was `window.confirm()` and every modal was the same five
// lines of markup copy-pasted, with no Escape handling and no focus management. That was survivable while
// nothing could be destroyed.
//
import { useEffect, useRef } from 'react';
import { t as tr } from '@/lib/i18n';
import { saidText } from '@/lib/said';
import { useLayer } from '@/lib/layers';

export function Modal({
  title,
  onClose,
  children,
  wide,
  fieldFocus = true,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean | 'table';
  /**
   * False where typing is not the likely first move -- Add to list, where picking a list is -- so focus starts on the
   * close key and a phone's keyboard does not open over the list the moment the dialog does.
   */
  fieldFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fieldFirst = useRef(fieldFocus);
  // On the notices' layer stack (lib/layers.ts), as a dialog that keeps the phone's nav band free -- see the
  // padding below -- so a notice can dock there instead of over this title.
  useLayer('dialog', true, { navBandFree: true });
  // Read through a ref so the effect below can depend on nothing. Callers pass `onClose={() => ...}`, a new
  // function identity on every render, so an effect depending on it re-ran after every keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Escape closes, and focus starts inside rather than wherever it happened to be.
  //
  // Runs ONCE. It used to re-run whenever `onClose` changed identity, i.e. on every render, i.e. after every
  // character typed into any field in the dialog -- and it focused `input, button, textarea`, whose first
  // match in document order is the ✕ in the header, not the first field. So the first keystroke landed, the
  // rest went to the close button, and the first SPACE activated it and threw the dialog away mid-sentence.
  // Every modal in the app with a text field had this.
  //
  // And focus goes BACK when the dialog goes: the element that opened it is read before the first field
  // takes focus, and re-focused in the cleanup. Without that, Escape or Cancel on the "Delete read
  // chapters" confirm left focus on <body>, and the next Tab started from the top of the admin console. An
  // opener the confirm action has since removed (a revoked row) ignores the call, which is the right answer.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    // A field if there is one; the close button only when there is nothing to type into.
    const first = (fieldFirst.current ? ref.current?.querySelector<HTMLElement>('input, textarea, select') : null)
      ?? ref.current?.querySelector<HTMLElement>('button');
    first?.focus();
    return () => { document.removeEventListener('keydown', onKey); opener?.focus(); };
  }, []);

  // ⚠️ Clear of the phone's bottom nav. The nav is a root-level sibling above `main` (z-40 over this
  // z-50-inside-main), so it paints over the bottom 5.5 rem of anything here: with a panel capped at 88vh
  // the last row of a tall dialog -- the add dialog's "Add to library", scrolled to the end -- sat under
  // the bar, with 9 to 20 px of the button reachable at 390×740 and the bar's own link under its centre at
  // 667. Below `lg` (where BottomNav.tsx hides itself) the backdrop keeps the bar's band free and the panel
  // is capped at the viewport minus that band and the top padding (7.5 rem = 5.5 + 1 + 1); from `lg` up it
  // is the centred 88vh dialog it always was. The same 5.5 rem the Sheet's `overBottomNav` uses.
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/70 p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] backdrop-blur-xs lg:pb-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-lenis-prevent
        className={`glass max-h-[calc(100dvh-7.5rem-env(safe-area-inset-bottom))] w-full lg:max-h-[88vh] ${wide === 'table' ? 'max-w-5xl' : wide ? 'max-w-lg' : 'max-w-md'} overflow-y-auto rounded-2xl border border-ink-700 p-5`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-semibold leading-tight">{title}</h3>
          <button onClick={onClose} aria-label={tr('Close')} className="shrink-0 text-fog-500 hover:text-fog-200">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = tr('Confirm'),
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="text-sm leading-relaxed text-fog-300">{body}</div>
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="btn-ghost flex-1 py-2 text-sm">{tr('Cancel')}</button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className={`flex-1 rounded-full py-2 text-sm font-semibold disabled:opacity-40 ${
            danger ? 'bg-rose-500/90 text-white hover:bg-rose-500' : 'btn-accent'
          }`}
        >
          {busy ? tr('Working…') : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Pull the server's human-readable message out of an ApiError, falling back to something useful: in the reader's
 * language when the refusal carries its code (`messageSaid`, v0.49.1, lib/said.ts), else as the server wrote it.
 */
export const msgOf = (e: any, fallback: string): string => {
  try {
    const j = JSON.parse(e?.body || '{}');
    return saidText(j.messageSaid, j.message || fallback);
  } catch {
    return fallback;
  }
};
