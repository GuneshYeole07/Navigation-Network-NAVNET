import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

/** Accessible modal: focus moves in, Escape closes, backdrop click closes. Sheet-style on mobile. */
export default function Modal({ open, onClose, title, children, tone = "default", size = "md" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    setTimeout(() => ref.current?.querySelector("button, input, textarea, select")?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  const width = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-2xl" }[size];
  // Portal to <body>: a modal opened from a floating button must not be trapped under
  // the map's bottom sheet (stacking contexts).
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-asphalt/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`relative w-full ${width} max-h-[90vh] overflow-y-auto rounded-t-sheet bg-white p-5 shadow-float dark:bg-asphalt-700 sm:rounded-sheet ${tone === "danger" ? "ring-2 ring-signal" : ""}`}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="text-2xl">{title}</h2>
              <button type="button" onClick={onClose} className="btn-ghost -mr-2 -mt-1 !p-2" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
