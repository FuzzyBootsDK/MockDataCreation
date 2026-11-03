import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon" aria-label="Close" onClick={() => ref.current?.close()}>
          ✕
        </button>
      </header>
      {children}
    </dialog>
  );
}
