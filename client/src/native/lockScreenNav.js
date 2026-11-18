import { useEffect, useRef } from "react";
import { LocalNotifications } from "@capacitor/local-notifications";
import { isNativeApp } from "./platform";
import { turnText } from "../utils/geo";
import { formatClock, formatDistance } from "../utils/format";

const NOTIFICATION_ID = 4711;
const CHANNEL = "navnet-navigation";
let channelReady = null;

function ensureChannel() {
  channelReady ??= (async () => {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") await LocalNotifications.requestPermissions();
    await LocalNotifications.createChannel({
      id: CHANNEL,
      name: "Ride navigation",
      description: "Next turn, distance and arrival time on your lock screen",
      importance: 3,
      visibility: 1, // show the full text on the lock screen
      vibration: false,
      lights: false,
    });
  })().catch(() => {
    channelReady = null;
  });
  return channelReady;
}

/** Same wording as the green strip at the top of the ride screen. */
export function describeNav(nav, trip) {
  if (!nav) return null;
  const dest = trip.destination?.name?.split(",")[0] || "destination";
  let title;
  if (nav.arrived) title = `You've arrived at ${dest}`;
  else if (nav.offRoute) title = `Off route by ${formatDistance(nav.offRouteBy)} · head back to the route`;
  else if (nav.nextTurn && nav.nextTurn.distance < 3000) title = `${turnText(nav.nextTurn)} in ${formatDistance(Math.round(nav.nextTurn.distance / 10) * 10)}`;
  else if (nav.nextCheckpoint) title = `${formatDistance(nav.nextCheckpoint.distance)} to ${nav.nextCheckpoint.name}`;
  else title = `Continue to ${dest}`;
  const parts = nav.arrived ? [trip.name] : [`${formatDistance(nav.remaining)} to go`, `arrive ${formatClock(nav.eta)}`];
  if (!nav.arrived && nav.nextCheckpoint && !title.includes(nav.nextCheckpoint.name)) parts.push(`then ${nav.nextCheckpoint.name}`);
  return { title, body: parts.join(" · ") };
}

/**
 * Keeps an ongoing "next turn" notification on the lock screen while riding (Android app only),
 * like Google Maps. Updates at most every 3 s, and only when the text changes.
 */
export function useLockScreenNav({ nav, trip, active, extra }) {
  const last = useRef({ text: "", at: 0 });
  const info = active && trip ? describeNav(nav, trip) : null;
  const title = info?.title;
  const body = extra ? `${extra} · ${info?.body}` : info?.body;

  useEffect(() => {
    if (!isNativeApp) return;
    if (!title) {
      if (last.current.text) LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] }).catch(() => {});
      last.current = { text: "", at: 0 };
      return;
    }
    const text = `${title}|${body}`;
    const now = Date.now();
    if (text === last.current.text || now - last.current.at < 3000) return;
    last.current = { text, at: now };
    ensureChannel().then(() =>
      LocalNotifications.schedule({
        notifications: [{ id: NOTIFICATION_ID, title, body, largeBody: body, channelId: CHANNEL, ongoing: true, autoCancel: false, smallIcon: "ic_stat_navnet", iconColor: "#0E6B4F" }],
      }).catch(() => {}),
    );
  }, [title, body]);

  // Remove it when leaving the ride screen.
  useEffect(
    () => () => {
      if (isNativeApp) LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] }).catch(() => {});
    },
    [],
  );
}
