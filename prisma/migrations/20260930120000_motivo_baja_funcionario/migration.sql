-- Motivo de la baja del funcionario (2026-09-30).
--
-- La baja logica (`func_activo` = false) pasa a exigir un MOTIVO: un codigo
-- (FIN_CONTRATO / RENUNCIA / TRASLADO / OTRO) y, solo cuando es OTRO, un detalle libre. Se guardan
-- en la ficha para que la tabla del maestro pueda mostrarlos, y ademas quedan en la auditoria
-- (`escribirConTraza`). Al REACTIVAR se limpian ambos (la ficha vuelve al maestro sin motivo
-- vigente); el historial de por que salio cada vez permanece en `t_auditoria`.
--
-- Nullable: una ficha activa no tiene motivo de baja, y las fichas ya dadas de baja antes de esta
-- migracion tampoco lo llevan (su motivo no se conocia al retirarlas).
ALTER TABLE "t_funcionario" ADD COLUMN "func_motivo_baja" VARCHAR(30);
ALTER TABLE "t_funcionario" ADD COLUMN "func_motivo_baja_detalle" VARCHAR(220);
