-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: cada_administrador_gestiona_su_direccion
-- Responsabilidad: Declarar que direcciones administra cada rol administrador.
-- Fuente: decision del negocio del 2026-09-01.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-09-01
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- LA RAZON POR LA QUE SE REPARTIO LA ADMINISTRACION.
--
-- Inspecciones, Instruccion y Vehiculos manejan cada una su propio personal, y cada una
-- debe poder gestionarlo sin ver ni tocar el de las otras. Hasta hoy eso solo lo hacian
-- los roles DEPARTAMENTALES (PER-09, 27-AGO), y funcionaba por una coincidencia: el rol
-- `DMIP_INSPECCIONES` **es** la direccion `DMIP_INSPECCIONES`, asi que preguntar «de que
-- direcciones es» bastaba.
--
-- Un administrador de area rompe esa coincidencia: `ADMINISTRADOR_DMIT` no ES ninguna
-- direccion, ADMINISTRA una. Esta tabla es esa relacion, y no un mapa en el codigo:
-- el dia que la DMIP se reorganice, o que un administrador cubra a otro de vacaciones,
-- es una fila y no un despliegue.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- NO ES LA MATRIZ DE PERMISOS. Esta tabla dice **sobre quien** actua un rol, no **que**
-- puede hacer. Lo segundo sigue en los decoradores `@Roles` y se parametriza aparte.

CREATE TABLE public.t_rol_direccion (
  rodi_id        SERIAL PRIMARY KEY,
  -- El rol que administra. Hoy son los tres administradores de area.
  rodi_rol       public.e_rol_departamental NOT NULL,
  -- La direccion administrada, tal como aparece en `func_direccion`.
  rodi_direccion public.e_rol_departamental NOT NULL,
  rodi_activo    BOOLEAN NOT NULL DEFAULT true,
  rodi_creado_en TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- Una direccion no se administra dos veces por el mismo rol.
CREATE UNIQUE INDEX uq_rol_direccion ON public.t_rol_direccion (rodi_rol, rodi_direccion);

-- Se consulta siempre por rol, para resolver el alcance de quien pregunta.
CREATE INDEX idx_rol_direccion_rol ON public.t_rol_direccion (rodi_rol) WHERE rodi_activo;

-- ═══════════════════════════════════════════════════════════════════════════════
-- UN ROL NO SE ADMINISTRA A SI MISMO, Y CONVIENE QUE LA BASE LO IMPIDA.
--
-- `rodi_rol = rodi_direccion` seria redundante en el mejor caso —los roles
-- departamentales ya ven lo suyo por ser lo que son— y enganioso en el peor: dejaria
-- creer que la fila es la que concede el acceso cuando no lo es.
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.t_rol_direccion
  ADD CONSTRAINT ck_rol_direccion_distinta CHECK (rodi_rol <> rodi_direccion);

COMMENT ON TABLE public.t_rol_direccion IS
  'Que direcciones administra cada rol. Un administrador de area no ES la direccion, la administra.';

-- ─────────────────────────── El reparto acordado ───────────────────────────

-- DMIP tiene DOS unidades con personal propio y un solo administrador para las dos.
-- Operativos es dueña de los formularios 1, 2, 3 y 4; Inspecciones del 5, 6 y 8.
INSERT INTO public.t_rol_direccion (rodi_rol, rodi_direccion) VALUES
  ('ADMINISTRADOR_DMIP', 'DMIP_OPERATIVOS'),
  ('ADMINISTRADOR_DMIP', 'DMIP_INSPECCIONES'),
  ('ADMINISTRADOR_DMIT', 'DMIT_INSTRUCTOR'),
  -- La DAF administra ademas su flota, que no es personal y va por otra pantalla.
  ('ADMINISTRADOR_DAF',  'DAF');

-- ─────────────────────────── Comprobacion ───────────────────────────

-- Las cuatro direcciones con personal tienen que quedar cubiertas. Una que no lo estuviera
-- seria gente a la que nadie puede dar de alta ni anotar una ausencia, y no se veria al
-- desplegar: se veria semanas despues, cuando alguien la buscara y no apareciera.
DO $$
DECLARE
  sin_administrador text;
BEGIN
  SELECT string_agg(d.direccion, ', ') INTO sin_administrador
    FROM (VALUES ('DMIP_OPERATIVOS'), ('DMIP_INSPECCIONES'),
                 ('DMIT_INSTRUCTOR'), ('DAF')) AS d(direccion)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.t_rol_direccion
      WHERE rodi_direccion = d.direccion::public.e_rol_departamental
        AND rodi_activo
   );

  IF sin_administrador IS NOT NULL THEN
    RAISE EXCEPTION 'Quedaron direcciones sin administrador: %.', sin_administrador;
  END IF;

  RAISE NOTICE 'Las cuatro direcciones con personal tienen administrador.';
END $$;
