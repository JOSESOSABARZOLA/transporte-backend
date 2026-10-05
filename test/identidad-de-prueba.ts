/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Pruebas de integración
 * Archivo: identidad-de-prueba.ts
 * Responsabilidad: Emitir la cookie de sesión con la que las suites se identifican.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-18
 *
 * SUSTITUYE A LA CABECERA `x-usuario-prueba`, que desapareció con la etapa 5 de la
 * integración con Auth central. Hasta entonces cada suite declaraba su propio
 * `const como = (usuario) => ({ 'x-usuario-prueba': usuario })` —**la misma línea trece
 * veces**— y el servidor resolvía el perfil con `usuarios-prueba.ts`. Ese archivo ya no
 * existe: la identidad viaja en una cookie de sesión firmada, y esto la emite.
 *
 * LAS PRUEBAS EJERCITAN AHORA EL CAMINO REAL. Antes comprobaban un modo que solo existía
 * para ellas y para el desarrollo; ahora firman el mismo token que emite el canje y lo
 * envían en la misma cookie que envía el navegador. Un fallo en `IdentidadGuard` deja de
 * ser invisible para la suite de integración.
 *
 * EL CATÁLOGO DE IDENTIDADES VIVE AQUÍ, en `test/`, y no en `src/`. Son datos de prueba:
 * tenerlos en producción fue lo que obligó a mantener `usuarios-prueba.ts` desplegado, y
 * con él una segunda forma de autenticarse.
 */

import { RolDepartamental } from '@prisma/client';

import { firmarSesion } from '../src/common/auth/token-sesion';
import { appConfig } from '../src/config/app.config';

/**
 * Identidad de prueba por rol.
 *
 * `usuarioId` COINCIDE CON EL ORDEN HISTÓRICO de los perfiles provisionales —1 Operativos,
 * 2 Inspecciones, 3 Instructor, 4 DAF, 5 Dirección, 6 Administración, 7 Funcionario— y no
 * es casualidad: `ordenes-servicio.integracion-spec.ts` crea filas de `t_usuario` con los
 * identificadores 1 y 2 para enlazarlas con una ficha de personal, y cambiar la
 * numeración rompería ese enlace en silencio.
 */
const IDENTIDADES: Record<
  string,
  { usuarioId: number; rol: RolDepartamental; nombre: string }
> = {
  '1': {
    usuarioId: 1,
    rol: RolDepartamental.DMIP_OPERATIVOS,
    nombre: 'Asistente de Operativos',
  },
  '2': {
    usuarioId: 2,
    rol: RolDepartamental.DMIP_INSPECCIONES,
    nombre: 'Asistente de Inspecciones',
  },
  '3': {
    usuarioId: 3,
    rol: RolDepartamental.DMIT_INSTRUCTOR,
    nombre: 'Responsable de Instrucción',
  },
  '4': {
    usuarioId: 4,
    rol: RolDepartamental.DAF,
    nombre: 'Analista de Transportes',
  },
  '5': { usuarioId: 5, rol: RolDepartamental.DIRECTOR, nombre: 'Dirección' },
  '6': {
    usuarioId: 6,
    rol: RolDepartamental.ADMINISTRADOR_DMIP,
    nombre: 'Administrador del sistema',
  },
  '7': {
    usuarioId: 7,
    rol: RolDepartamental.FUNCIONARIO,
    nombre: 'Funcionario de campo',
  },
  /*
   * ═══════════════════════════════════════════════════════════════════════════════
   * LOS DOS ADMINISTRADORES DE ÁREA. 2026-09-01.
   *
   * `ADMINISTRADOR_DMIP` es el 6 desde siempre. Estos dos hacen falta para ejercitar el
   * reparto **contra la base**: las pruebas unitarias llevan una copia del reparto en una
   * constante, y una copia solo demuestra que el código coincide consigo mismo. Aquí se
   * comprueba que `t_rol_direccion` dice lo que la migración sembró.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  '8': {
    usuarioId: 8,
    rol: RolDepartamental.ADMINISTRADOR_DMIT,
    nombre: 'Administración de Instrucción',
  },
  '9': {
    usuarioId: 9,
    rol: RolDepartamental.ADMINISTRADOR_DAF,
    nombre: 'Administración de Transportes',
  },
};

/**
 * Cabeceras que identifican a una de las nueve identidades de prueba.
 *
 * Se mantiene el nombre `como(...)` y su argumento —el identificador como texto— para que
 * las trece suites no tengan que reescribir cada llamada: cambia de dónde sale la
 * identidad, no cómo se pide.
 *
 * @example .set(como(DIRECTOR))
 * @throws Error si el identificador no corresponde a ninguna identidad, para que un
 *         número equivocado se distinga de un 401 legítimo.
 */
export const como = (usuario: string): Record<string, string> => {
  const identidad = IDENTIDADES[usuario];
  if (!identidad) {
    throw new Error(
      `No hay identidad de prueba con el identificador «${usuario}». Las válidas son 1 a 9; ver test/identidad-de-prueba.ts.`,
    );
  }

  const token = firmarSesion({
    usuarioId: identidad.usuarioId,
    // UN SOLO ROL POR IDENTIDAD DE PRUEBA, aunque el token admita varios desde el
    // 2026-08-19. Las suites verifican que cada rol ve lo suyo y nada mas; la union de
    // varios tiene sus propias pruebas unitarias.
    roles: [identidad.rol],
    nombre: identidad.nombre,
    // Las suites que necesitan ficha de personal la crean ellas y usan el identificador
    // que corresponda; el token no la lleva porque `funcionarioDeUsuario` la lee de
    // `t_usuario`, que es la fuente.
    funcionarioId: null,
    usuarioAuth: `prueba.${identidad.rol.toLowerCase()}`,
    // NULO A PROPOSITO, y no es un hueco por rellenar: ninguna suite de integracion habla
    // con Auth central, y darle un valor aqui haria que el endpoint del directorio
    // intentara salir a la red desde una prueba. Quien lo necesite, que lo ponga.
    tokenAuth: null,
  });

  return { Cookie: `${appConfig.sesion.cookie.nombre}=${token}` };
};

/** Cabeceras sin identidad, para las pruebas que comprueban el 401. */
export const sinIdentidad = (): Record<string, string> => ({});
