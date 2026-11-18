import { useState } from "react";
import toast from "react-hot-toast";
import { Download, Share2 } from "lucide-react";
import { tripService } from "../../services/tripService";
import { formatDuration } from "../../utils/format";

const W = 1080;
const H = 1350;

/** Draw the ride summary as a 4:5 image (Instagram/WhatsApp friendly). Pure canvas, works offline. */
export async function drawRideCard(report, geometry) {
  await document.fonts?.ready;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");

  // Background: dusk green with hill bands
  g.fillStyle = "#08402F";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#0A5640";
  g.beginPath();
  g.moveTo(0, 820);
  [[160, 640], [330, 760], [520, 560], [720, 720], [900, 600], [1080, 700]].forEach(([x, y]) => g.lineTo(x, y));
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.fill();

  // Route drawing, fitted into a box
  const box = { x: 90, y: 300, w: 900, h: 480 };
  if (geometry?.length > 1) {
    const lats = geometry.map((p) => p[0]);
    const lngs = geometry.map((p) => p[1]);
    const [minLa, maxLa, minLo, maxLo] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const k = Math.min(box.w / (maxLo - minLo || 1e-6), box.h / (maxLa - minLa || 1e-6));
    const ox = box.x + (box.w - (maxLo - minLo) * k) / 2;
    const oy = box.y + (box.h - (maxLa - minLa) * k) / 2;
    const P = ([la, lo]) => [ox + (lo - minLo) * k, oy + (maxLa - la) * k];
    for (const [width, color] of [[26, "#1C2226"], [12, "#F2B705"]]) {
      g.lineWidth = width;
      g.lineJoin = g.lineCap = "round";
      g.strokeStyle = color;
      g.beginPath();
      geometry.forEach((p, i) => (i ? g.lineTo(...P(p)) : g.moveTo(...P(p))));
      g.stroke();
    }
    for (const [p, fill] of [[geometry[0], "#ffffff"], [geometry.at(-1), "#D7263D"]]) {
      const [x, y] = P(p);
      g.fillStyle = fill;
      g.strokeStyle = "#1C2226";
      g.lineWidth = 6;
      g.beginPath();
      g.arc(x, y, 18, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  g.fillStyle = "#ffffff";
  g.font = "700 84px 'Barlow Condensed', sans-serif";
  g.fillText(report.tripName.slice(0, 26), 90, 160);
  g.font = "400 34px 'Public Sans', sans-serif";
  g.fillStyle = "rgba(255,255,255,.8)";
  g.fillText(report.startedAt ? new Date(report.startedAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "", 90, 215);

  // Stats row
  const stats = [
    [`${report.totalDistanceKm.toFixed(1)}`, "km"],
    [formatDuration(report.travelDurationSeconds), "riding"],
    [`${Math.round(report.averageSpeedKmh)}`, "km/h avg"],
    [`${report.membersTotal}`, report.membersTotal === 1 ? "rider" : "riders"],
  ];
  stats.forEach(([v, l], i) => {
    const x = 90 + i * 240;
    g.fillStyle = "#ffffff";
    g.font = "700 72px 'Barlow Condensed', sans-serif";
    g.fillText(v, x, 960);
    g.fillStyle = "rgba(255,255,255,.75)";
    g.font = "500 30px 'Public Sans', sans-serif";
    g.fillText(l, x, 1004);
  });

  // Riders
  g.fillStyle = "rgba(255,255,255,.9)";
  g.font = "500 32px 'Public Sans', sans-serif";
  const names = report.participation.map((p) => p.name.split(" ")[0]).join(" · ");
  wrap(g, names, 90, 1100, 900, 44, 3);

  // Footer with milestone mark
  g.fillStyle = "#F2B705";
  g.beginPath();
  g.arc(118, 1262, 28, Math.PI, 0);
  g.fill();
  g.fillStyle = "#ffffff";
  g.fillRect(90, 1262, 56, 40);
  g.fillStyle = "#ffffff";
  g.font = "700 44px 'Barlow Condensed', sans-serif";
  g.fillText("NavNet", 166, 1298);
  g.font = "400 28px 'Public Sans', sans-serif";
  g.fillStyle = "rgba(255,255,255,.7)";
  g.fillText("Rode together. Arrived together.", 330, 1296);

  return new Promise((res) => c.toBlob(res, "image/png"));
}

function wrap(g, text, x, y, maxW, lh, maxLines) {
  const words = text.split(" ");
  let line = "";
  let n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y + n * lh);
      line = w;
      if (++n >= maxLines) return;
    } else line = test;
  }
  if (line) g.fillText(line, x, y + n * lh);
}

export default function RideCard({ tripId, report }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  const make = async () => {
    const snap = await tripService.get(tripId).catch(() => null);
    return drawRideCard(report, snap?.trip?.routeGeometry);
  };

  const share = async () => {
    setBusy(true);
    try {
      const blob = await make();
      setPreview(URL.createObjectURL(blob));
      const file = new File([blob], `${report.tripName.replace(/\W+/g, "-")}.png`, { type: "image/png" });
      const text = `${report.tripName}: ${report.totalDistanceKm.toFixed(1)} km with ${report.membersTotal} riders on NavNet 🏍️`;
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text });
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        toast.success("Ride card downloaded — post it in your group");
      }
    } catch (e) {
      if (e.name !== "AbortError") toast.error("Couldn't create the ride card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <button className="btn-primary" onClick={share} disabled={busy}>
        {navigator.canShare ? <Share2 size={16} /> : <Download size={16} />} {busy ? "Creating…" : "Share ride card"}
      </button>
      {preview && <img src={preview} alt="Ride summary card" className="w-64 rounded-control shadow-float" />}
    </div>
  );
}
