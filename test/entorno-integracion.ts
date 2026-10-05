/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Pruebas de integración
 * Archivo: entorno-integracion.ts
 * Responsabilidad: Preparar el entorno antes de que se cargue la aplicación.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * `appConfig` lee `process.env` AL IMPORTARSE. Si estas variables se fijaran dentro de un
 * archivo de prueba, el módulo ya estaría cargado con los valores anteriores y la cookie
 * de sesión que firman las suites no se podría verificar.
 */

import 'dotenv/config';

/**
 * Clave con la que las suites firman su cookie de sesión, la misma con la que el guard la
 * verifica. SUSTITUYE A `MODO_IDENTIDAD_PROVISIONAL`, retirada en la etapa 5 de la
 * integración con Auth central: ya no hay una segunda forma de autenticarse, así que las
 * pruebas usan la única que existe. Ver `test/identidad-de-prueba.ts`.
 *
 * Valor fijo y no leído del `.env`: una prueba que dependa de un secreto del entorno del
 * desarrollador falla en la máquina de al lado sin decir por qué.
 */
process.env.SESSION_JWT_SECRET = 'clave-de-firma-de-las-pruebas-de-integracion';
process.env.TZ = process.env.TZ ?? 'America/Guayaquil';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LAS PRUEBAS DE INTEGRACIÓN CORREN CONTRA SU PROPIA BASE.
 *
 * Hasta el 2026-08-07 compartían la base de desarrollo, y funcionaba por una razón
 * frágil: `t_formulario` estaba vacía porque PV-25 y PV-26 bloqueaban su siembra, de modo
 * que cada suite podía crear los suyos con los números 1 a 9. Al resolverse PV-26 y
 * sembrarse los nueve formularios reales, las doce suites que creaban el suyo empezaron a
 * chocar contra `uq_formulario_numero`.
 *
 * Y no hay forma de esquivarlo dentro de la misma base: `ck_formulario_numero` acota el
 * número **entre 1 y 9**, que es correcto —el negocio tiene nueve formularios— y deja
 * exactamente nueve casilleros. Si los ocupa el catálogo institucional, no queda ninguno
 * para las pruebas. No es un problema de aislamiento por prefijo: es que el recurso es
 * finito por diseño.
 *
 * La separación tiene además una ventaja que ya se echaba de menos: una suite ya no puede
 * borrar por descuido un dato real, y `npm run test:integracion` deja de depender del
 * estado en que quedara la base de desarrollo.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * El nombre se deriva de `DATABASE_URL` en lugar de pedir otra variable: así no hay una
 * credencial más que configurar, y la base de pruebas vive en el mismo servidor.
 */
const BASE_DE_PRUEBAS = 'transportedb_pruebas';

function urlDePruebas(url: string): string {
  const destino = new URL(url);
  destino.pathname = `/${BASE_DE_PRUEBAS}`;
  return destino.toString();
}

const urlReal = process.env.DATABASE_URL;

if (!urlReal) {
  throw new Error(
    'DATABASE_URL no está definida. Las pruebas de integración necesitan la conexión para derivar la base de pruebas.',
  );
}

process.env.DATABASE_URL = urlDePruebas(urlReal);
