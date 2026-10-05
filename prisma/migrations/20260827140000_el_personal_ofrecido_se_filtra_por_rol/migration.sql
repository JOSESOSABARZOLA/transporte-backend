-- ═══════════════════════════════════════════════════════════════════════════════
-- EL PERSONAL QUE SE OFRECE SE FILTRA TAMBIÉN POR EL ROL QUE CONSULTA. 2026-08-27.
--
-- Hasta hoy `GET /personal/elegible` filtraba solo por las áreas del formulario, y no
-- sabía **quién preguntaba**. Eso dejaba un hueco conocido: en el 6 · REACN, el DMIT
-- —que solo aporta personal de Instrucción— veía en la lista a inspectores generales y
-- técnicos que el servidor le rechazaba al intentar asignarlos.
--
-- La regla nueva empareja cada área con el departamento que la tiene:
--
--   OPERATIVOS   → DMIP_OPERATIVOS
--   INSTRUCCION  → DMIT_INSTRUCTOR
--   TECNICO      → DMIP_INSPECCIONES
--   GENERAL      → DMIP_INSPECCIONES
--
-- SOLO AFECTA A LA LISTA QUE SE OFRECE, no a lo que el servidor acepta. `reglaAreaAdmitida`
-- y `reglaCupoCompartido` no cambian: la lista pasa a ser un subconjunto de lo permitido,
-- nunca al revés, así que nada de lo que hoy funciona empieza a devolver 403.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- Y HAY UN FORMULARIO QUE NO SE FILTRA, PORQUE SU RAZÓN DE SER ES LA CONTRARIA.
--
-- El 7 · OPERATIVO DMIT es el de los eventuales: reúne gente de donde haga falta, y por
-- eso admite las cuatro áreas. Con el filtro por rol su único departamento vería solo
-- Instrucción, y las otras tres quedarían declaradas y fuera de alcance.
--
-- LA EXCEPCIÓN ES UN DATO, NO UN `IF` CON UN CÓDIGO DENTRO. Escribir `if (codigo ===
-- 'DMIT')` habría funcionado hoy y habría exigido un despliegue el día que otro
-- formulario lo necesite. Es la misma lección de `admiteAdicionales` (RN-61), que estuvo
-- codificada hasta el 24-AGO: **es un `UPDATE`, no un despliegue**.
--
-- La columna se llama en positivo —«filtra»— y no «sin filtro»: una condición negada se
-- lee mal en el código, donde acaba siendo `if (!formulario.sinFiltroDeRol)`.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.t_formulario
  ADD COLUMN IF NOT EXISTS form_filtra_personal_por_rol BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.t_formulario.form_filtra_personal_por_rol IS
  'Si la lista de personal elegible se acota ademas al area del rol que consulta. Falso en el formulario de eventuales, que reune gente de las cuatro areas.';

UPDATE public.t_formulario
   SET form_filtra_personal_por_rol = false
 WHERE form_codigo = 'DMIT';

-- Comprobación: exactamente un formulario queda sin filtro, y es el de eventuales.
DO $$
DECLARE
  sinFiltro integer;
BEGIN
  SELECT count(*) INTO sinFiltro
    FROM public.t_formulario
   WHERE form_filtra_personal_por_rol = false;

  IF sinFiltro <> 1 THEN
    RAISE EXCEPTION
      'Quedaron % formularios sin filtro por rol y debia quedar 1.', sinFiltro;
  END IF;
END $$;
