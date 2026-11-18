-- Alerts raised by the Python safety monitor (analytics/app/safety.py).
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'POSSIBLE_CRASH';
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'UNUSUAL_MOVEMENT';
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'WEAK_GPS';
