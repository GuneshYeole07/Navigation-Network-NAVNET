import { forwardRef, useId } from "react";

/** Label + control + error, wired for accessibility. Pass `as="textarea"|"select"` for other controls. */
const Field = forwardRef(function Field({ label, error, hint, as: As = "input", className = "", children, ...props }, ref) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label}
        </label>
      )}
      <As
        id={id}
        ref={ref}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={`input ${error ? "input-error" : ""} ${As === "textarea" ? "min-h-[96px] resize-y" : ""}`}
        {...props}
      >
        {children}
      </As>
      {error ? (
        <p id={`${id}-err`} className="field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
export default Field;
