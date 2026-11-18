import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Share2, Trash2, Wallet } from "lucide-react";
import { tripService } from "../../services/tripService";
import { useSocket } from "../../context/SocketContext";
import { useAuth } from "../../context/AuthContext";

const rupees = (paise) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Fuel, food, tolls — split equally, with the fewest transfers to settle up. */
export default function Expenses({ tripId, compact = false }) {
  const { socket } = useSocket();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => tripService.expenses(tripId).then(setData).catch(() => {}), [tripId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!socket) return undefined;
    const on = (d) => d.tripId === tripId && load();
    socket.on("expenses:changed", on);
    return () => socket.off("expenses:changed", on);
  }, [socket, tripId, load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await tripService.addExpense(tripId, { amount: Number(amount), description: what.trim() });
      setAmount("");
      setWhat("");
      setAdding(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const share = async () => {
    const lines = [
      `NavNet trip expenses — total ${rupees(data.totalPaise)}`,
      ...data.expenses.map((x) => `• ${x.description}: ${rupees(x.amountPaise)} (paid by ${x.paidByName})`),
      "",
      "Settle up:",
      ...(data.settlements.length ? data.settlements.map((t) => `• ${t.fromName} → ${t.toName}: ${rupees(t.amountPaise)}`) : ["• All square 🎉"]),
    ].join("\n");
    if (navigator.share) {
      try {
        await navigator.share({ text: lines });
        return;
      } catch {
        /* cancelled */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, "_blank", "noopener");
  };

  if (!data) return null;
  const mine = data.people.find((p) => p.userId === user?.id);

  return (
    <section className="rounded-control bg-road p-3 dark:bg-asphalt-600">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl">
          <Wallet size={18} /> Shared costs
        </h2>
        <span className="font-display text-lg font-semibold">{rupees(data.totalPaise)}</span>
      </div>

      {mine && data.totalPaise > 0 && (
        <p className={`mb-2 text-sm font-semibold ${mine.balancePaise >= 0 ? "text-nh" : "text-signal"}`}>
          {mine.balancePaise >= 0 ? `You get back ${rupees(mine.balancePaise)}` : `You owe ${rupees(-mine.balancePaise)}`}
        </p>
      )}

      {!compact && data.expenses.length > 0 && (
        <ul className="mb-2 divide-y divide-road-line text-sm dark:divide-asphalt-500">
          {data.expenses.map((x) => (
            <li key={x.id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">
                {x.description} <span className="muted">· {x.paidByName}</span>
              </span>
              <span className="font-semibold">{rupees(x.amountPaise)}</span>
              {x.paidById === user?.id && (
                <button
                  className="text-signal"
                  aria-label={`Delete ${x.description}`}
                  onClick={() => tripService.deleteExpense(tripId, x.id).then(load).catch((e) => toast.error(e.message))}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {data.settlements.length > 0 && (
        <div className="mb-2 rounded-control bg-white p-2 text-sm dark:bg-asphalt-700">
          <p className="mb-1 text-xs font-semibold muted">Settle up</p>
          {data.settlements.map((t, i) => (
            <p key={i}>
              {t.fromName} → {t.toName}: <b>{rupees(t.amountPaise)}</b>
            </p>
          ))}
        </div>
      )}

      {adding ? (
        <form onSubmit={add} className="space-y-2">
          <div className="flex gap-2">
            <input className="input w-28" inputMode="decimal" placeholder="₹ amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in rupees" required />
            <input className="input" placeholder="What for? (Misal, toll…)" value={what} onChange={(e) => setWhat(e.target.value)} maxLength={80} aria-label="What was it for" required />
          </div>
          <p className="text-xs muted">You paid · split equally with everyone on the ride.</p>
          <div className="flex gap-2">
            <button className="btn-primary flex-1 !py-2 text-sm">Add</button>
            <button type="button" className="btn-ghost !py-2 text-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <button className="btn-secondary flex-1 !py-2 text-sm" onClick={() => setAdding(true)}>
            <Plus size={15} /> I paid for something
          </button>
          {data.expenses.length > 0 && (
            <button className="btn-secondary !py-2 text-sm" onClick={share} aria-label="Share expenses on WhatsApp">
              <Share2 size={15} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
