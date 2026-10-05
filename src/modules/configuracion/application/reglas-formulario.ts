/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: reglas-formulario.ts
 * Responsabilidad: Decidir con qué acceso ve cada rol un formulario.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * DEBE COINCIDIR CON `FormularioRolGuard`, Y NO POR CASUALIDAD.
 *
 * La guarda decide si una escritura entra; esta función decide qué se le ofrece al
 * funcionario en la pantalla. Si discreparan, la interfaz mostraría un formulario que
 * la guarda rechaza al guardar, y el funcionario perdería el trabajo ya capturado.
 *
 * La equivalencia se comprueba en `formularios.service.spec.ts`, que ejecuta la guarda
 * real contra la misma definición y exige que «acceso distinto de LECTURA» y «la
 * guarda deja pasar» sean el mismo conjunto para los seis roles.
 */

import { RolDepartamental } from '@prisma/client';

/**
 * Con qué autoridad ve un rol un formulario concreto.
 *
 * SON LOS VALORES QUE VIAJAN AL NAVEGADOR y no cambian con el modelo nuevo: la base
 * distingue `ESCRITURA` de `APORTA`, y aquí `APORTA` se dice `COMPARTIDO` porque es la
 * palabra que la pantalla lleva usando desde M-16. Renombrarla habría obligado a tocar
 * el frontend sin que nada se comportara distinto.
 */
export type AccesoFormulario = 'ESCRITURA' | 'COMPARTIDO' | 'LECTURA';

/**
 * Lo mínimo que se necesita saber del formulario para decidir el acceso.
 *
 * ERA `rolDueno` Y `rolCompartido` hasta el 2026-08-25. Ahora es el conjunto de
 * participaciones, porque un formulario puede tener **dos departamentos que registran**
 * —la patrulla ECU— y eso en dos columnas no cabía.
 */
export interface PropiedadFormulario {
  roles: { rol: RolDepartamental; acceso: AccesoEnBase }[];
}

/** Los dos valores que guarda `t_formulario_rol`. */
export type AccesoEnBase = 'ESCRITURA' | 'APORTA';

/**
 * Roles que ven los nueve formularios sin escribir la planificación de ninguno.
 *
 * `DAF` está aquí a propósito: escribe, pero **solo conductor y vehículo**, y por un
 * endpoint distinto con su propia guarda. Para el registro del operativo su acceso es
 * de lectura, y así lo declara el caso 3 del plan.
 */
const ROLES_TRANSVERSALES: RolDepartamental[] = [
  RolDepartamental.DAF,
  RolDepartamental.DIRECTOR,
  RolDepartamental.ADMINISTRADOR_DMIP,
];

/**
 * ESCRITURA GANA A APORTA, y no es un detalle de estilo. Un rol solo puede tener una
 * fila por formulario —la clave primaria es (formulario, rol)—, así que hoy no pueden
 * coincidir; la comprobación está escrita en ese orden para que el día que un formulario
 * admita las dos cosas por dos vías distintas, la pantalla ofrezca **la más amplia** y no
 * la que llegara primero en la consulta.
 */
export function accesoDe(
  formulario: PropiedadFormulario,
  rol: RolDepartamental,
): AccesoFormulario {
  const suyas = formulario.roles.filter((fila) => fila.rol === rol);

  if (suyas.some((fila) => fila.acceso === 'ESCRITURA')) return 'ESCRITURA';
  if (suyas.some((fila) => fila.acceso === 'APORTA')) return 'COMPARTIDO';
  return 'LECTURA';
}

/**
 * Qué formularios se le ofrecen a un rol.
 *
 * Un rol departamental ve **solo los suyos**: mostrarle los nueve convertiría la
 * pantalla de registro en un catálogo de la operación ajena, que es justamente lo que
 * el aislamiento de información del encargo quiere evitar. Los roles transversales sí
 * ven los nueve, porque su trabajo es sobre el cuadro completo.
 */
export function leCorresponde(
  formulario: PropiedadFormulario,
  rol: RolDepartamental,
): boolean {
  if (ROLES_TRANSVERSALES.includes(rol)) return true;
  return accesoDe(formulario, rol) !== 'LECTURA';
}
