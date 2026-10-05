-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "class" TEXT NOT NULL DEFAULT 'wizard',
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "hp" INTEGER NOT NULL DEFAULT 100,
    "maxHp" INTEGER NOT NULL DEFAULT 100,
    "mp" INTEGER NOT NULL DEFAULT 50,
    "maxMp" INTEGER NOT NULL DEFAULT 50,
    "defense" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 5.5,
    "attack" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "dexterity" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "equippedWeapon" TEXT DEFAULT 'staff_energy',
    "equippedArmor" TEXT DEFAULT 'robe_apprentice',
    "inventory" JSONB NOT NULL DEFAULT '[]',
    "lastZoneId" TEXT NOT NULL DEFAULT 'nexus',
    "x" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    "isAlive" BOOLEAN NOT NULL DEFAULT true,
    "deathReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_token_key" ON "Account"("token");

-- CreateIndex
CREATE INDEX "Character_accountId_idx" ON "Character"("accountId");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
