-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertType" ADD VALUE 'GAP';
ALTER TYPE "AlertType" ADD VALUE 'STOP_REQUEST';

-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'VOICE';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "audioUrl" TEXT,
ADD COLUMN     "durationMs" INTEGER;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "departAt" TIMESTAMP(3),
ADD COLUMN     "gapAlertMeters" INTEGER NOT NULL DEFAULT 1500,
ADD COLUMN     "meetLat" DOUBLE PRECISION,
ADD COLUMN     "meetLng" DOUBLE PRECISION,
ADD COLUMN     "meetName" TEXT,
ADD COLUMN     "meetSetAt" TIMESTAMP(3),
ADD COLUMN     "pois" JSONB,
ADD COLUMN     "poisAt" TIMESTAMP(3),
ADD COLUMN     "sweepId" TEXT;

-- AlterTable
ALTER TABLE "TripMember" ADD COLUMN     "checklist" JSONB,
ADD COLUMN     "readyAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bloodGroup" TEXT,
ADD COLUMN     "emergencyName" TEXT,
ADD COLUMN     "emergencyPhone" TEXT,
ADD COLUMN     "medicalNotes" TEXT;

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "paidById" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "splitAmong" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_tripId_createdAt_idx" ON "Expense"("tripId", "createdAt");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
