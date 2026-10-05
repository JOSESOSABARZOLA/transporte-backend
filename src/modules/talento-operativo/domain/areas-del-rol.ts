/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Personal y disponibilidad
 * Archivo: areas-del-rol.ts
 * Responsabilidad: Decir de qué áreas de personal dispone cada departamento.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-27
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES EL ORGANIGRAMA, Y POR ESO ES CÓDIGO Y NO UNA TABLA.
 *
 * Un área pertenece a un departamento y esa pertenencia no es configuración: es cómo
 * está organizada la institución. `TECNICO` y `GENERAL` son los dos cuerpos de
 * inspectores de la DMIP, `INSTRUCCION` es del DMIT y `OPERATIVOS` de la Unidad de
 * Operativos. Cambiar eso no es marcar una casilla, es una reorganización.
 *
 * Lo que **sí** es configuración —qué áreas admite cada formulario— vive en
 * `t_formulario_area` y se administra desde P-08. Son dos ejes distintos y conviene no
 * confundirlos: uno dice de quién es cada persona, el otro qué personas caben en cada
 * formulario.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * `Record` COMPLETO Y NO UN MAPA PARCIAL: si mañana entra un área nueva en el enumerado,
 * el compilador exige decir de quién es. Con un `Partial` se quedaría sin dueño y el
 * filtro la descartaría en silencio para todo el mundo.
 */

import { AreaPersonal, RolDepartamental } from '@prisma/client';

/** El departamento al que pertenece cada área de personal. */
export const ROL_DEL_AREA: Record<AreaPersonal, RolDepartamental> = {
  [AreaPersonal.OPERATIVOS]: RolDepartamental.DMIP_OPERATIVOS,
  [AreaPersonal.INSTRUCCION]: RolDepartamental.DMIT_INSTRUCTOR,
  [AreaPersonal.TECNICO]: RolDepartamental.DMIP_INSPECCIONES,
  [AreaPersonal.GENERAL]: RolDepartamental.DMIP_INSPECCIONES,
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * RECIBE **TODOS** LOS ROLES DE LA PERSONA, NO UNO. Corregido el 2026-08-27.
 *
 * Nació tomando un solo rol —`usuario.rol`, el que la cadena de guardas estrecha— y eso
 * fue un defecto en producción: **`/personal/elegible` no declara `@Roles`**, así que
 * `RolesGuard` sale por su `return true` sin estrechar nada y `usuario.rol` se queda en
 * `sesion.roles[0]`, el primero que devolvió Auth y sin ningún criterio.
 *
 * A quien tiene DMIT Instrucción **y** Administrador le llegaba a veces el segundo, que no
 * tiene área propia: la intersección salía vacía y **el selector de personal aparecía sin
 * nadie**, sin decir por qué.
 *
 * La unión es además lo que este sistema hace con las personas de varios roles en todas
 * partes: «ve la unión de lo que cada uno abre».
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * DEVUELVE VACÍO Y NO «TODAS» cuando ninguno de sus roles tiene área —DAF, Dirección,
 * Administrador a secas—. Una lista vacía se ve y se pregunta; una lista completa pasaría
 * por buena.
 */
export function areasDeLosRoles(
  roles: readonly RolDepartamental[],
): AreaPersonal[] {
  return (Object.keys(ROL_DEL_AREA) as AreaPersonal[]).filter((area) =>
    roles.includes(ROL_DEL_AREA[area]),
  );
}

/**
 * Las direcciones que tienen personal propio.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DEJÓ DE DERIVARSE DE `ROL_DEL_AREA` EL 2026-09-01, Y HACÍA FALTA.
 *
 * Se derivaba con este argumento: «es la misma pregunta —quién tiene gente— y dos listas
 * separadas se desincronizarían». **Son dos preguntas distintas, y la DAF lo demuestra**:
 * tiene gente, y no tiene área operativa en el cuadro.
 *
 * La consecuencia de confundirlas era silenciosa. El frontend ya ofrecía `DAF` en el
 * selector de la ficha, el DTO no valida la dirección contra ninguna lista, y una ficha
 * creada así quedaba **invisible** para el filtro de PER-09, porque esta constante no
 * consideraba la DAF una dirección con personal. No fallaba nada: simplemente esa persona
 * no le aparecía a nadie salvo al administrador general.
 *
 * TENER ÁREA Y TENER GENTE SIGUEN LIGADAS EN UN SENTIDO: quien tiene área tiene gente, y
 * por eso la comprobación de abajo exige que las cuatro de `ROL_DEL_AREA` estén aquí. Lo
 * que ya no se afirma es la vuelta.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dirección, Funcionario y los cuatro roles de administración no aparecen: administran o
 * consultan, no son departamentos con personal operativo.
 */
export const DIRECCIONES_CON_PERSONAL: readonly RolDepartamental[] = [
  RolDepartamental.DMIP_OPERATIVOS,
  RolDepartamental.DMIP_INSPECCIONES,
  RolDepartamental.DMIT_INSTRUCTOR,
  /*
   * LA DAF TIENE GENTE PERO NO TIENE ÁREA, y eso arrastra algo que conviene saber: una
   * ficha con dirección DAF se puede administrar, pero **no puede ser convocada a ningún
   * operativo**, porque los formularios admiten personal por área y ninguna es suya.
   * Es un registro administrativo, no una persona asignable al cuadro.
   */
  RolDepartamental.DAF,
];

/**
 * Quien tiene área tiene gente. Si un área nueva señalara a una dirección que no está en
 * la lista de arriba, su personal sería invisible para el filtro de PER-09 sin que nada
 * fallara — que es justo el defecto que la DAF destapó.
 */
const SIN_DIRECCION_DECLARADA = Object.values(ROL_DEL_AREA).filter(
  (rol) => !DIRECCIONES_CON_PERSONAL.includes(rol),
);

if (SIN_DIRECCION_DECLARADA.length > 0) {
  throw new Error(
    `Estas direcciones tienen área pero no figuran en DIRECCIONES_CON_PERSONAL: ${SIN_DIRECCION_DECLARADA.join(', ')}.`,
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DE QUÉ DEPARTAMENTOS PUEDE VER EL MAESTRO QUIEN CONSULTA. PER-09, 2026-08-27.
 *
 * VA POR `func_direccion` Y NO POR `func_area`, y la diferencia importa aunque hoy los dos
 * ejes coincidan en todas las fichas. `exigirSuDepartamento` ya decide **por dirección**
 * quién puede anotarle una ausencia a quién. Si la lectura se acotara por área, una
 * persona con `area = OPERATIVOS` y `direccion = DMIT_INSTRUCTOR` le aparecería a DMIP
 * Operativos en la tabla y el servidor le rechazaría la ausencia al intentarlo. **Leer y
 * escribir se acotan con la misma vara.**
 *
 * DEVUELVE VACÍO PARA QUIEN NO ADMINISTRA NI PERTENECE A NINGUNA, y quien llama debe
 * tratarlo como «no ve a nadie», nunca como «no filtrar». Convertir «vacío» en «todos»
 * dentro de esta función haría que un rol nuevo abriera el maestro por omisión, que es
 * exactamente la forma en que estas cosas se escapan.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SE SUMAN LAS ADMINISTRADAS DESDE EL 2026-09-01. Es el reparto de la administración.
 *
 * Hasta hoy bastaba preguntar de qué direcciones **es** la persona, porque el rol
 * departamental y la dirección son el mismo valor: `DMIP_INSPECCIONES` el rol es
 * `DMIP_INSPECCIONES` la dirección. Un administrador de área rompe esa coincidencia:
 * `ADMINISTRADOR_DMIT` no es ninguna dirección, **administra** una.
 *
 * `administradas` SE PASA Y NO SE BUSCA AQUÍ, y no tiene valor por omisión a propósito:
 * este archivo es dominio puro —no toca la base— y un `= []` dejaría que un llamante
 * nuevo se olvidara del argumento y **estrechara el alcance sin fallar**. El
 * administrador vería una lista más corta y nadie sabría por qué. Sin valor por omisión,
 * el olvido es un error de compilación.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function direccionesDeLosRoles(
  roles: readonly RolDepartamental[],
  administradas: readonly RolDepartamental[],
): RolDepartamental[] {
  return DIRECCIONES_CON_PERSONAL.filter(
    (direccion) =>
      roles.includes(direccion) || administradas.includes(direccion),
  );
}
