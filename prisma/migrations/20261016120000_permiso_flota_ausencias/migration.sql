-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: permiso_flota_ausencias
-- Responsabilidad: Permiso atomico para registrar las AUSENCIAS de los conductores desde
--   «Flota y garajes» (plan «ausencias-conductores-flota», 2026-10-16). Solo datos: la tabla
--   t_disponibilidad ya admite cond_id (ck_disponibilidad_sujeto) y transporte ya la lee.
--   Se otorga a los mismos roles que hoy tienen flota:administrar; se cambia desde
--   «Permisos por rol» sin desplegar.
-- Aditiva e idempotente: repetirla no cambia nada.
-- Fecha: 2026-10-16

INSERT INTO "t_permiso" ("perm_codigo","perm_modulo","perm_descripcion")
VALUES ('flota:ausencias', 'flota', 'Registrar y retirar las ausencias de los conductores')
ON CONFLICT DO NOTHING;

INSERT INTO "t_rol_permiso" ("rper_rol","rper_permiso")
VALUES ('ADMINISTRADOR_DAF', 'flota:ausencias'),
       ('DAF', 'flota:ausencias'),
       ('ADMINISTRADOR', 'flota:ausencias')
ON CONFLICT DO NOTHING;
