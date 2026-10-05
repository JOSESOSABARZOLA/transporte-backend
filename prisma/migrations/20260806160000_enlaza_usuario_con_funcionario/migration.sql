-- Microservicio: transporte · Modulo: Cuadro de Colores
-- Migracion: enlaza_usuario_con_funcionario
-- Responsabilidad: Permitir que un usuario consulte SUS ordenes de servicio.
-- Fuente: RN-49 y el endpoint /ordenes-servicio/mias de M-20.
-- Desarrollador: Jose Sosa
-- Fecha: 2026-08-06
--
-- POR QUE SE AGREGA UNA COLUMNA AL MODELO APROBADO.
--
-- El plan exige `GET /ordenes-servicio/mias`, que "filtra por la identidad del servidor,
-- nunca por un parametro de la peticion". Para filtrar hace falta saber a que FUNCIONARIO
-- corresponde el usuario autenticado, y en el modelo aprobado **no hay forma de saberlo**:
--
--   · t_usuario guarda correo, nombre, rol e identificador de directorio activo;
--   · t_funcionario guarda cedula, apellidos, nombres, telefono, cargo, area y direccion;
--   · ninguna columna las relaciona.
--
-- Las alternativas descartadas, y por que:
--
--   · Cruzar por correo: t_funcionario no tiene correo.
--   · Cruzar por cedula contra usua_identificador_ad: seria SUPONER que el identificador
--     de directorio activo es la cedula. Nadie lo ha dicho, y un cruce equivocado
--     entregaria a una persona la orden de otra, que es exactamente lo que RN-49 impide.
--
-- La columna es NULA por defecto y lo seguira siendo para la Direccion y la
-- administracion, que no salen a operativos. Un usuario sin enlace no recibe ordenes
-- ajenas: recibe un mensaje que le dice que su cuenta no tiene ficha de personal
-- asociada.
--
-- ON DELETE SET NULL, no CASCADE: dar de baja a un funcionario no debe borrar la cuenta
-- de acceso, que puede seguir siendo necesaria para consultar lo ya emitido.
--
-- El indice unico impide que dos cuentas apunten a la misma persona: si eso ocurriera,
-- dos usuarios distintos verian las mismas ordenes.

ALTER TABLE "t_usuario"
  ADD COLUMN "func_id" INTEGER;

ALTER TABLE "t_usuario"
  ADD CONSTRAINT "fk_usuario_funcionario"
  FOREIGN KEY ("func_id") REFERENCES "t_funcionario"("func_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uq_usuario_funcionario" ON "t_usuario"("func_id");
