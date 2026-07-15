/*
  Warnings:

  - You are about to drop the column `consumerKey` on the `Tenant` table. All the data in the column will be lost.
  - You are about to drop the column `consumerSecret` on the `Tenant` table. All the data in the column will be lost.
  - You are about to drop the column `enabledTools` on the `Tenant` table. All the data in the column will be lost.
  - You are about to drop the column `woocommerceUrl` on the `Tenant` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('WOOCOMMERCE', 'ODOO', 'DIRECT_DATABASE');

-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "consumerKey",
DROP COLUMN "consumerSecret",
DROP COLUMN "enabledTools",
DROP COLUMN "woocommerceUrl";

-- CreateTable
CREATE TABLE "ConnectorConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "credentialsJson" TEXT NOT NULL,
    "enabledToolsJson" TEXT NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectorConfig_tenantId_idx" ON "ConnectorConfig"("tenantId");

-- CreateIndex
CREATE INDEX "ConnectorConfig_tenantId_isDefault_idx" ON "ConnectorConfig"("tenantId", "isDefault");

-- AddForeignKey
ALTER TABLE "ConnectorConfig" ADD CONSTRAINT "ConnectorConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
