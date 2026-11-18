export const CHECKPOINT_CATEGORIES = {
  BREAKFAST: { label: "Breakfast", emoji: "🍳", color: "#C2541F" },
  FUEL: { label: "Fuel stop", emoji: "⛽", color: "#1F6FB2" },
  HYDRATION: { label: "Hydration", emoji: "💧", color: "#0F8A8A" },
  LUNCH: { label: "Lunch", emoji: "🍛", color: "#B2771F" },
  REST: { label: "Rest stop", emoji: "☕", color: "#7A4BC2" },
  SCENIC: { label: "Scenic point", emoji: "⛰️", color: "#4E7A1F" },
  HOTEL: { label: "Hotel", emoji: "🏨", color: "#9C2F6B" },
  HOSPITAL: { label: "Hospital", emoji: "🏥", color: "#D7263D" },
  OTHER: { label: "Other", emoji: "📍", color: "#3D474E" },
};

export const MEMBER_STATUS = {
  MOVING: { label: "Moving", dot: "bg-nh-400", text: "text-nh" },
  STOPPED: { label: "Stopped", dot: "bg-stone-cap", text: "text-stone-capdark" },
  OFFLINE: { label: "Offline", dot: "bg-mist", text: "text-mist" },
  ARRIVED: { label: "Arrived", dot: "bg-[#1F6FB2]", text: "text-[#1F6FB2]" },
};

export const TRIP_STATUS = {
  PLANNED: { label: "Not started", cls: "bg-asphalt/5 text-asphalt/70 dark:bg-white/10 dark:text-road/80" },
  ACTIVE: { label: "On the road", cls: "bg-nh-50 text-nh dark:bg-nh/20 dark:text-nh-100" },
  PAUSED: { label: "Paused", cls: "bg-stone-cap/20 text-stone-capdark" },
  COMPLETED: { label: "Completed", cls: "bg-[#1F6FB2]/10 text-[#1F6FB2]" },
  CANCELLED: { label: "Cancelled", cls: "bg-signal-50 text-signal" },
};

export const VEHICLE_TYPES = {
  BIKE: "Motorbike",
  CAR: "Car",
  BICYCLE: "Bicycle",
  BUS: "Bus / van",
  WALKING: "On foot",
  MIXED: "Mixed",
};

export const EMERGENCY_TYPES = {
  ACCIDENT: { label: "Accident", emoji: "💥" },
  BREAKDOWN: { label: "Breakdown", emoji: "🔧" },
  MEDICAL: { label: "Medical", emoji: "🩺" },
  FUEL: { label: "Out of fuel", emoji: "⛽" },
  LOST: { label: "Lost", emoji: "🧭" },
  SECURITY: { label: "Security", emoji: "🛡️" },
  OTHER: { label: "Other", emoji: "❗" },
};

export const ALERT_META = {
  SOS: { label: "SOS", emoji: "🆘", tone: "signal" },
  OFF_ROUTE: { label: "Off route", emoji: "↪️", tone: "warn" },
  STATIONARY: { label: "Stationary", emoji: "⏸️", tone: "warn" },
  OFFLINE: { label: "Offline", emoji: "📵", tone: "warn" },
  LOW_BATTERY: { label: "Low battery", emoji: "🪫", tone: "info" },
  OVERSPEED: { label: "Overspeed", emoji: "🏎️", tone: "warn" },
  WRONG_DIRECTION: { label: "Wrong way", emoji: "🔄", tone: "warn" },
  GAP: { label: "Falling behind", emoji: "↔️", tone: "warn" },
  STOP_REQUEST: { label: "Stop request", emoji: "✋", tone: "info" },
  // From the safety monitor (Python): checks only, never a diagnosis.
  POSSIBLE_CRASH: { label: "Possible crash", emoji: "💥", tone: "signal" },
  UNUSUAL_MOVEMENT: { label: "Unusual movement", emoji: "❓", tone: "warn" },
  WEAK_GPS: { label: "Weak GPS", emoji: "📡", tone: "info" },
};

export const ROUTE_PROFILE = { BICYCLE: "cycling", WALKING: "walking" };

export const STOP_REASONS = {
  FUEL: { label: "Fuel", emoji: "⛽" },
  TOILET: { label: "Toilet", emoji: "🚻" },
  FOOD: { label: "Food / chai", emoji: "☕" },
  TIRED: { label: "Tired", emoji: "😮‍💨" },
  BIKE: { label: "Bike issue", emoji: "🔧" },
  OTHER: { label: "Other", emoji: "✋" },
};

export const CHECKLIST = [
  { key: "fuel", label: "Full tank" },
  { key: "documents", label: "Licence, RC, insurance" },
  { key: "helmet", label: "Helmet & riding gear" },
  { key: "tyres", label: "Tyres & brakes checked" },
  { key: "powerbank", label: "Phone charged + power bank" },
  { key: "offlinemap", label: "Offline map downloaded" },
  { key: "emergency", label: "Emergency card filled" },
];

export const POI_META = {
  fuel: { label: "Fuel", emoji: "⛽", color: "#1F6FB2" },
  hospital: { label: "Hospital", emoji: "🏥", color: "#D7263D" },
  mechanic: { label: "Mechanic", emoji: "🔧", color: "#B2771F" },
  police: { label: "Police", emoji: "🚓", color: "#3D474E" },
};
