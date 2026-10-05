-- ═══════════════════════════════════════════════════════════════════════════════
-- LA JORNADA DEL DIA DICE QUIEN ASIGNA PERSONAL DESDE ELLA. 2026-09-01.
--
-- EL DEFECTO. El 2026-09-01 por la manana P-13 se abrio a los tres departamentos con una
-- decision del negocio que decia, textual: «abrirla SOLO EN LECTURA y sin el personal
-- ajeno». Se implemento la segunda mitad —`sinPersonalAjeno` en `jornada.service.ts`— y
-- no la primera. La pantalla ofrece la accion donde `acceso <> 'LECTURA'`, y como los dos
-- roles nuevos tienen ESCRITURA en sus propios formularios, siguen pudiendo asignar
-- personal desde ahi.
--
-- NO ES UNA FUGA NI UNA ESCALADA. Esos roles ya podian asignar personal a sus propios
-- operativos desde P-01 y P-02: lo que sobra es un segundo camino a lo mismo, no un
-- permiso nuevo. PER-02 nunca estuvo en juego —sobre lo ajeno el acceso es LECTURA y el
-- personal ni siquiera viaja—.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- POR QUE UNA COLUMNA Y NO UN `IF` CON EL NOMBRE DEL ROL.
--
-- La instruccion del negocio nombra un rol —«esto es solo para DMIT Instruccion»— y la
-- regla permanente del proyecto prohibe que ningun rol este quemado en codigo. Las dos se
-- cumplen a la vez poniendo la autoridad en la tabla: el codigo lee una columna y no sabe
-- de quien es.
--
-- SE DESCARTO derivarlo de `frol_acceso = 'APORTA'`, que no habria costado migracion. Le
-- quitaria la accion al DMIT en los formularios que registra el —el 7 y el 9—, donde hoy
-- la tiene y el negocio confirmo el 2026-09-01 que la conserva. Una regla elegante que
-- cambia el comportamiento acordado no es la regla correcta.
--
-- ES UNA COLUMNA DE (FORMULARIO, ROL) Y NO DE ROL, que es el grano mas fino disponible.
-- Permite decir «este departamento asigna desde la jornada en la patrulla 6 pero no en su
-- propio formulario» sin tocar codigo, que es exactamente el tipo de matiz que el negocio
-- ha ido pidiendo en esta tabla desde el 25-AGO.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · La columna. Por omision NO, que es la postura restrictiva.
--
-- Un formulario o un rol nuevo nace sin la accion y hay que concederla a proposito. Al
-- reves —por omision si— cada alta abriria un camino de escritura que nadie decidio.
ALTER TABLE public.t_formulario_rol
  ADD COLUMN frol_edita_desde_jornada BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.t_formulario_rol.frol_edita_desde_jornada IS
  'Si este rol puede asignar personal a este formulario DESDE la Jornada del Dia (P-13). No es un permiso: es un camino. Quien lo tiene en false sigue asignando por P-01 y P-02 si su acceso se lo permite.';

-- ── 2 · La siembra, escrita por la relacion y no por el nombre.
--
-- P-13 existe por una situacion concreta: hay un departamento que pone su gente en
-- operativos que arma otro, y necesita ver la rejilla del dia para saber en cual. Esa
-- situacion es exactamente `frol_acceso = 'APORTA'`, y esta escrita en esta misma tabla.
--
-- SE LE CONCEDE EN TODAS SUS FILAS, no solo en las de aporte. Quien tiene esa relacion
-- con el cuadro usa P-13 como su pantalla del dia, y partirle la columna segun el
-- formulario que mire seria una sorpresa, no una regla. Es ademas lo que hace hoy, y esta
-- migracion no cambia lo que ese departamento ve.
UPDATE public.t_formulario_rol
   SET frol_edita_desde_jornada = TRUE
 WHERE frol_rol IN (
   SELECT frol_rol
     FROM public.t_formulario_rol
    WHERE frol_acceso = 'APORTA'
 );

-- ── 3 · Las dos condiciones que tienen que cumplirse a la vez.
DO $$
DECLARE
  concedidas integer;
  intrusas   integer;
BEGIN
  SELECT count(*) INTO concedidas
    FROM public.t_formulario_rol
   WHERE frol_edita_desde_jornada;

  -- Si nadie quedara con la accion, P-13 seria una pantalla de solo lectura para todos y
  -- el cupo compartido no tendria por donde llenarse. Seria un cambio de negocio, no el
  -- efecto de esta migracion.
  IF concedidas = 0 THEN
    RAISE EXCEPTION
      'Ningun rol quedaria pudiendo asignar personal desde la Jornada del Dia. Revise la siembra antes de aplicar.';
  END IF;

  -- Y al reves: nadie que no aporte en ningun formulario debe haberla recibido. Es la
  -- comprobacion que detectaria un `UPDATE` mal escrito que marcara la tabla entera.
  SELECT count(*) INTO intrusas
    FROM public.t_formulario_rol fr
   WHERE fr.frol_edita_desde_jornada
     AND NOT EXISTS (
       SELECT 1
         FROM public.t_formulario_rol otra
        WHERE otra.frol_rol = fr.frol_rol
          AND otra.frol_acceso = 'APORTA'
     );

  IF intrusas <> 0 THEN
    RAISE EXCEPTION
      '% fila(s) recibieron la accion sin aportar en ningun formulario.', intrusas;
  END IF;
END $$;
