-- AlterTable
ALTER TABLE "revenue_categorized_lines" ADD COLUMN     "categoriaOriginal" TEXT,
ADD COLUMN     "revisadoEm" TIMESTAMP(3),
ADD COLUMN     "revisadoManualmente" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revisadoPorId" TEXT,
ADD COLUMN     "valorRecebidoCatOriginal" DECIMAL(14,2);

-- AddForeignKey
ALTER TABLE "revenue_categorized_lines" ADD CONSTRAINT "revenue_categorized_lines_revisadoPorId_fkey" FOREIGN KEY ("revisadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
