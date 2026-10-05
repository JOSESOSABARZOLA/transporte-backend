-- AlterTable
ALTER TABLE "t_cuadro_diario" ALTER COLUMN "cuad_estado" SET DEFAULT 'BORRADOR';

-- AlterTable
ALTER TABLE "t_formulario" ALTER COLUMN "form_politica_vehiculo" SET DEFAULT 'CONDICIONAL';

-- AlterTable
ALTER TABLE "t_funcionario" ALTER COLUMN "func_actualizado_en" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "t_operativo" ALTER COLUMN "oper_estado_transporte" SET DEFAULT 'PENDIENTE',
ALTER COLUMN "oper_actualizado_en" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "t_solicitud_apoyo" ALTER COLUMN "sapo_estado" SET DEFAULT 'SOLICITADA';
