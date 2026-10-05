/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Matriz consolidada
 * Archivo: reglas-matriz.ts
 * Responsabilidad: Decidir qué muestra la matriz cuando un formulario no tiene carga.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * RN-53 y RN-54 · LA FILA DE EVIDENCIA.
 *
 * Es una de las razones por las que el proyecto existe. Hoy, cuando un departamento no
 * carga su formulario, el cuadro simplemente no lo menciona: la omisión desaparece, y a
 * la mañana siguiente nadie puede decir quién dejó de informar.
 *
 * La matriz **nombra al responsable y la hora en que se le cerró la ventana**. No es un
 * reproche automático: es el dato que hoy no queda en ninguna parte.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * LA EVIDENCIA SOLO APARECE CUANDO LA VENTANA VENCIÓ (caso 5 del plan). Mientras siga
 * abierta, el formulario vacío es un formulario que todavía se está cargando, y marcarlo
 * como omisión sería acusar a alguien de no haber hecho algo que aún puede hacer.
 *
 * ES UN ARCHIVO DE FUNCIONES PURAS. No consulta la base, no conoce NestJS y no lee
 * parámetros: recibe el estado de la ventana y devuelve qué mostrar.
 */

import type { RolDepartamental } from '@prisma/client';

import { NOMBRE_ROL } from '../../../common/roles/catalogo-roles';

/** Estado de la ventana del rol dueño, tal como lo publica M-08. */
export interface VentanaDelFormulario {
  /** `vcar_activo`. Una ventana desactivada no impone horario y por tanto no vence. */
  activo: boolean;
  /** Si el rol todavía puede escribir en este momento. */
  abierta: boolean;
  horaCierre: string | null;
}

/** Lo que la matriz pinta en lugar de las filas ausentes. */
export interface FilaEvidencia {
  leyenda: string;
  responsable: string;
  horaCierre: string | null;
}

/**
 * RN-53 y RN-54. Si al formulario vacío le corresponde fila de evidencia.
 *
 * @param tieneOperativos si el formulario tiene alguna fila en la jornada
 * @param ventana estado de la ventana del rol dueño en el momento de componer
 */
export function correspondeEvidencia(
  tieneOperativos: boolean,
  ventana: VentanaDelFormulario,
): boolean {
  if (tieneOperativos) return false;

  // Sin restricción horaria no hay vencimiento: el formulario puede cargarse a cualquier
  // hora, así que su vacío no constituye una omisión. Mismo criterio que M-13 aplicó al
  // avance del estado del cuadro.
  if (!ventana.activo) return false;

  return !ventana.abierta;
}

/**
 * Compone la fila de evidencia. RN-54 exige el departamento y la hora de cierre.
 *
 * @param responsable nombre legible del rol dueño del formulario
 */
export function componerEvidencia(
  responsable: string,
  ventana: VentanaDelFormulario,
): FilaEvidencia {
  return {
    leyenda: 'La información de este formulario no fue ingresada.',
    responsable,
    horaCierre: ventana.horaCierre
      ? comoHoraInstitucional(ventana.horaCierre)
      : null,
  };
}

// ─────────────────────── Presentación de la cabecera ───────────────────────

const DIAS = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * «viernes 31 de julio de 2026», tal como lo pide la cabecera de FASE5 §4.3.
 *
 * NO SE USA `Intl`. En español devuelve resultados que dependen de los datos de
 * localización disponibles en el proceso —«sept.» con punto, mayúsculas distintas según
 * la versión de ICU—, y este texto va impreso en un documento institucional. Es el mismo
 * criterio con el que M-09 escribió los meses del identificador.
 *
 * Se lee en UTC: `cuad_fecha` es una fecha de calendario, no un instante.
 */
export function enLenguajeNatural(fecha: Date): string {
  const dia = DIAS[fecha.getUTCDay()];
  const mes = MESES[fecha.getUTCMonth()];

  return `${dia} ${fecha.getUTCDate()} de ${mes} de ${fecha.getUTCFullYear()}`;
}

/** `15:00` → `15H00`. La notación institucional del cuadro. */
export function comoHoraInstitucional(hora: string): string {
  return hora.replace(':', 'H');
}

/**
 * Nombre legible de la dirección responsable, para la fila de evidencia.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DEJÓ DE TENER SU PROPIO MAPA EL 2026-09-01, Y ERA EL MÁS PELIGROSO DE LOS TRES.
 *
 * Aquí vivía una copia tipada `Record<string, string>` con `?? rol` de respaldo. Al
 * ampliar el enumerado ese mismo día, el compilador obligó a completar la copia de
 * `solicitud-apoyo` —que sí está tipada por el enumerado— pero **no ésta**: sin
 * completarla a mano, la matriz habría impreso `ADMINISTRADOR_DMIP` en crudo dentro de un
 * documento oficial y nada habría fallado.
 *
 * Ahora sale de `common/roles/catalogo-roles`, tipado `Record<RolDepartamental, string>`.
 * El respaldo se conserva porque el parámetro sigue siendo `string` —lo llama código que
 * lee de la base— pero ya no es lo único que separa un documento correcto de uno con un
 * código interno impreso.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function nombreDeDireccion(rol: string): string {
  return NOMBRE_ROL[rol as RolDepartamental] ?? rol;
}
