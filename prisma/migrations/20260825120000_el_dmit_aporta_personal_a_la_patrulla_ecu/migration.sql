-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: el_dmit_aporta_personal_a_la_patrulla_ecu
-- Responsabilidad: Abrir el formulario 4 al cupo de personal del DMIT.
-- Fuente: solicitud del negocio del 2026-08-25.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-25
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- APORTAR PERSONAL NO ES REGISTRAR. SON DOS COSAS, Y ESTA MIGRACION SOLO DA UNA.
--
-- El formulario 4 -PATRULLA ECU DIURNA- sigue siendo de DMIP Operativos: ellos lo
-- registran, lo editan y lo retiran. Lo que se abre es que el DMIT ponga personal del
-- area de Instruccion en esas patrullas, con un tope.
--
-- Hasta hoy el unico formulario compartido de los nueve era el 6 -REACN-, y por eso
-- PER-06 esta redactada como una regla «del formulario 6». Pasan a ser dos.
--
-- LO QUE EL DMIT SIGUE SIN PODER HACER, y lo hace cumplir el servidor:
--   · crear un operativo ECU        -> operativos.service.ts, `crear`
--   · editarlo o retirarlo          -> operativos.service.ts, `exigirPropiedad`
--   · retirar personal ajeno        -> solo lo que el mismo asigno (aper_asignado_por_rol)
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- SON TRES FILAS Y LA TERCERA ES LA QUE SE OLVIDA.
--
-- `farea_es_compartida` es lo que dice DE QUE AREA aporta el rol compartido.
-- `composicion-personal.ts` filtra por esa marca; sin ella el cupo rechaza a TODO el
-- mundo con el mensaje «participa con personal de: ninguna area», y el cambio parece
-- aplicado pero no funciona.
--
-- ECU ya declaraba el area INSTRUCCION, pero sin marcar: significaba «el dueño puede
-- asignar gente de Instruccion», no «el DMIT aporta». En REACN esa misma fila esta
-- marcada. Es toda la diferencia.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- EL CUPO ES 2, decidido por el negocio el 2026-08-25. El del formulario 6 sigue en 1.
-- `ck_formulario_compartido` obliga a que el rol y el cupo viajen juntos y el cupo sea
-- mayor que cero: no hay forma de decir «sin tope» en esta columna.
--
-- El MINIMO de 1 no vive aqui: no existe columna para un minimo. Se comprueba al cerrar
-- la jornada, en `CuadroDiarioService.cerrar()`, junto a INV-11. Ver PV-29.

UPDATE public.t_formulario
   SET form_rol_compartido  = 'DMIT_INSTRUCTOR',
       form_cupo_compartido = 2
 WHERE form_codigo = 'ECU';

UPDATE public.t_formulario_area
   SET farea_es_compartida = true
 WHERE farea_area = 'INSTRUCCION'
   AND form_id = (SELECT form_id FROM public.t_formulario WHERE form_codigo = 'ECU');
