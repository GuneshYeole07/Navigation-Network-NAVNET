export default function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="panel flex flex-col items-center px-6 py-10 text-center">
      {Icon && <Icon className="mb-3 text-mist" size={32} aria-hidden="true" />}
      <h3 className="text-xl">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
