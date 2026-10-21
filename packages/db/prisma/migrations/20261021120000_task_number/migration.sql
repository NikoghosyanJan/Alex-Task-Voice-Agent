-- Equivalent to SERIAL, but existing tasks are numbered in creation order.
CREATE SEQUENCE "tasks_number_seq" AS INTEGER;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "number" INTEGER;

UPDATE "tasks" AS t
SET "number" = ordered.rn
FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn FROM "tasks") AS ordered
WHERE t."id" = ordered."id";

SELECT setval('"tasks_number_seq"', COALESCE((SELECT MAX("number") FROM "tasks"), 0) + 1, false);

ALTER TABLE "tasks" ALTER COLUMN "number" SET DEFAULT nextval('"tasks_number_seq"');
ALTER TABLE "tasks" ALTER COLUMN "number" SET NOT NULL;
ALTER SEQUENCE "tasks_number_seq" OWNED BY "tasks"."number";

-- CreateIndex
CREATE UNIQUE INDEX "tasks_number_key" ON "tasks"("number");
