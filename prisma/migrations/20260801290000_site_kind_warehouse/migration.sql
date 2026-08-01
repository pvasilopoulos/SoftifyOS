-- AlterEnum: organizational warehouses (Whouses) distinct from BRANCH / TILL
ALTER TYPE "SiteKind" ADD VALUE IF NOT EXISTS 'WAREHOUSE';
