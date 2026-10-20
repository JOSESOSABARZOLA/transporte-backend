-- ═══════════════════════════════════════════════════════════════════════════════
-- Flota y garajes · placas normalizadas y tope de kilometraje (2026-10-15)
--
-- Aditiva e idempotente. No cambia ninguna tabla (siguen 53).
--
--   · A1: deja cada placa en la forma de `normalizarPlaca` (datos-flota.ts): mayúsculas, sin
--     espacios ni guiones, y con el guion entre las letras y los dígitos (PMA7056 → PMA-7056).
--     Solo toca la placa cuando el resultado es AAA-999 / AAA-9999, es distinto del actual y NO
--     choca: ni con otra placa ya registrada ni con otra fila que normalice a lo mismo. La que
--     choca queda como está (la búsqueda de duplicados la sigue encontrando sin guion) y se
--     revisa a mano con la consulta previa del contrato `docs/CONTRATO-flota-y-garajes.md`.
--     Una segunda pasada no encuentra nada que cambiar.
--   · A2: DAF_KM_MAXIMO = 999999, tope del kilometraje de un vehículo. Prefijo DAF_ para que la
--     Administración DAF pueda ajustarlo. ON CONFLICT DO NOTHING sobre la clave única.
-- ═══════════════════════════════════════════════════════════════════════════════

WITH normalizadas AS (
  SELECT v.vehi_id,
         regexp_replace(
           upper(regexp_replace(v.vehi_placa, '[[:space:]-]+', '', 'g')),
           '^([A-Z]{3})([0-9]{3,4})$', '\1-\2'
         ) AS placa
    FROM public.t_vehiculo v
),
candidatas AS (
  SELECT n.vehi_id, n.placa
    FROM normalizadas n
    JOIN public.t_vehiculo v ON v.vehi_id = n.vehi_id
   WHERE n.placa ~ '^[A-Z]{3}-[0-9]{3,4}$'
     AND n.placa <> v.vehi_placa
     -- Otra fila que normaliza a la misma placa: colisión, no se toca ninguna de las dos.
     AND NOT EXISTS (
       SELECT 1 FROM normalizadas o WHERE o.placa = n.placa AND o.vehi_id <> n.vehi_id
     )
)
UPDATE public.t_vehiculo v
   SET vehi_placa = c.placa
  FROM candidatas c
 WHERE v.vehi_id = c.vehi_id
   -- Otra fila que ya tiene esa placa tal cual (cubierta arriba; se repite por claridad).
   AND NOT EXISTS (
     SELECT 1 FROM public.t_vehiculo o WHERE o.vehi_placa = c.placa AND o.vehi_id <> c.vehi_id
   );

INSERT INTO public.t_parametro_politica
  (para_clave, para_valor, para_tipo, para_descripcion, para_unidad, para_minimo, para_maximo, para_modificado_por, para_modificado_en)
VALUES
  ('DAF_KM_MAXIMO', '999999', 'ENTERO', 'Transporte DAF. Kilometraje máximo que se acepta al registrar o editar un vehículo; por encima, se pide revisar el dato.', 'km', '1000', '9999999', NULL, now())
ON CONFLICT DO NOTHING;
