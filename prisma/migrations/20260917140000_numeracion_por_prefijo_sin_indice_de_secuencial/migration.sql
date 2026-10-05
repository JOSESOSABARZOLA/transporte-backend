-- NUMERACIÓN POR PREFIJO EN LAS PATRULLAS: se retira el índice de secuencial por formulario. 2026-09-17.
--
-- Las patrullas (Form 5 y 6: `variosPorPersona` SIN `cantidadPorPersona`) numeran POR PREFIJO/ÁREA:
-- cada serie arranca en 001 → `IGNECU-001`, `ITNECU-001`, `INECU-001` (un 2.º General sería
-- `IGNECU-002`). Tres operativos con secuencial 1 en un mismo formulario COLISIONAN en el índice
-- `uq_operativo_cuad_form_sec` (cuadro, formulario, secuencial), y su gemelo de adicionales.
--
-- Se retiran los dos. La unicidad REAL la garantiza `uq_operativo_cuad_ident` (cuadro,
-- identificador): como la fecha es constante por cuadro, equivale a unicidad por
-- cuadro+prefijo+secuencial, que es justo la garantía por-prefijo deseada. El reintento de
-- carreras (`esColisionDeUnicidad`) atrapa cualquier `P2002` igual, sin importar la constraint.
--
-- El Form 8 (`cantidadPorPersona`) sigue numerando por formulario (IG-001, IT-002): dropear el
-- índice no cambia su numeración —la impone el conteo del servicio—, solo retira un guardián que
-- ya cubre `uq_operativo_cuad_ident`.
DROP INDEX IF EXISTS "uq_operativo_cuad_form_sec";
DROP INDEX IF EXISTS "uq_operativo_cuad_form_sec_adic";
