-- ═══════════════════════════════════════════════════════════════════════════════
-- LA FICHA DE PERSONAL GUARDA EL CORREO. 2026-09-01.
--
-- Lo pidio el negocio para P-07. Hasta hoy el maestro tenia un solo canal de contacto -el
-- telefono, RN-34- y el correo institucional existia en Auth central pero no se conservaba
-- aqui: quien miraba una ficha no tenia forma de escribirle a esa persona.
--
-- ─────────────────────────── Tres decisiones, y por que ───────────────────────────
--
-- 1 · ES OPCIONAL, como el telefono. Exigirlo bloquearia el alta de quien no tenga correo
--     institucional todavia, y el maestro se administra el dia que la persona entra, no el
--     dia que Sistemas le crea la cuenta. `func_telefono` ya sento ese criterio.
--
-- 2 · NO LLEVA INDICE UNICO, y es deliberado. La identidad de una ficha es la cedula
--     -`uq_funcionario_cedula`-, que es con lo que se detecta un reingreso. Un unico sobre
--     el correo anadiria un modo de fallo sin anadir garantia: dos fichas no pueden
--     compartir cedula, que es lo que importa, y un buzon compartido por una unidad es
--     algo que ocurre en la institucion.
--
-- 3 · 160 CARACTERES, los mismos que `usua_correo` en `t_usuario`. Los dos guardan la
--     misma clase de dato y salen del mismo sitio -Auth central-; que uno admita mas que
--     el otro produciria un correo que se puede tener como cuenta y no como ficha.
--
-- ─────────────────────────── Lo que NO cambia ───────────────────────────
--
-- **La orden de servicio sigue teniendo cuatro campos** (INV-24, RN-50): horario,
-- funcionario, conductor y placa. El correo no entra ahi: se decide con el Product Owner
-- y se amplia primero en el servidor, que es donde el documento se construye.
--
-- **Y no sale en la consulta de personal elegible.** RN-34 dice que el telefono vive solo
-- en el maestro porque quien arma el cuadro elige personas, no las llama; el correo sigue
-- el mismo criterio y por el mismo motivo.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.t_funcionario
  ADD COLUMN func_correo VARCHAR(160);

COMMENT ON COLUMN public.t_funcionario.func_correo IS
  'Correo institucional. Opcional, como el telefono. Dato personal: la auditoria registra QUE cambio, nunca su valor.';
