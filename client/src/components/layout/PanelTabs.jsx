/** Segmented tabs for the live side panel. */
export default function PanelTabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 border-b border-road-line px-3 dark:border-asphalt-600" role="tablist">
      {tabs.map(({ key, label, badge }) => (
        <button
          key={key}
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold ${
            value === key ? "border-nh text-nh dark:border-nh-400 dark:text-nh-100" : "border-transparent muted hover:text-asphalt dark:hover:text-road"
          }`}
        >
          {label}
          {badge ? <span className="chip bg-signal px-1.5 text-[10px] text-white">{badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
