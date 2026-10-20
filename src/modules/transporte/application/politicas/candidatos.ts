/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (paso 2)
 * Archivo: candidatos.ts
 * Responsabilidad: Clasificar y ordenar los conductores para un operativo, con su motivo en palabras.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL DIÁLOGO «ASIGNAR / CAMBIAR CONDUCTOR» NO DECIDE NADA NUEVO. La decisión sigue siendo la de
 * `asignacion-conductor.policy.ts` (✓ / ⚠ / ✕ con sus motivos); aquí solo se TRADUCE a cuatro
 * categorías que la analista lee de un vistazo, con UN motivo en lenguaje simple:
 *
 *   · DISPONIBLE     — sin bloqueos y dentro de su turno. «Disponible en ese horario» o, si ya
 *                      trabaja hoy en la misma zonal, «Disponible · ya trabaja en Calderón».
 *   · FUERA_TURNO    — se puede, pero fuera de su turno (horas extra): «Fuera de su turno
 *                      (Noche 18H00–06H00)». Se asigna con «Asignar igual» y el aviso queda en su carril.
 *   · COMPARTE       — «ocupado» SOLO porque ya hace un traslado con el que este operativo puede
 *                      viajar en su misma unidad (2026-10-21: el «completo» que deja y retira en su
 *                      punto): «Comparte unidad con OCPMO-001». Se toma con «Compartir unidad».
 *   · OCUPADO        — algún bloqueo: «Ocupado 08H00–16H30 con OCPMO-001», o el primer motivo duro.
 *   · LIBRE_INACTIVO — de libre y sin activar: «De libre hoy · active "Usar conductores de libre"».
 *
 * ORDEN: disponibles → comparte unidad → fuera de turno → ocupados → libres sin activar, y AL FINAL el conductor que
 * ya tiene asignado (marcado `actual`). Dentro de cada grupo se respeta el orden de entrada, que ya
 * viene por costo (`evaluarBloque`).
 *
 * Los demás avisos (jornada larga, descanso, arranque lejos) viajan aparte en `avisos`: no cambian
 * la categoría, pero la analista los ve antes de asignar.
 *
 * ES PURA: sin base de datos ni reloj.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type {
  CodigoMotivo,
  TurnoDelConductor,
} from './asignacion-conductor.policy';
import { institucional, type Franja } from './linea-de-tiempo';

export type CategoriaCandidato =
  | 'DISPONIBLE'
  | 'COMPARTE'
  | 'FUERA_TURNO'
  | 'OCUPADO'
  | 'LIBRE_INACTIVO';

/** Lo que se sabe de un conductor evaluado para el operativo. */
export interface EntradaCandidato {
  conductorId: number;
  nombre: string;
  turno: TurnoDelConductor | null;
  /** Ventana de su turno (escala interna, desde las 00H00), si tiene una con horario. */
  ventanaTurno: Franja | null;
  vehiculoId: number | null;
  placa: string | null;
  estado: 'OK' | 'AVISO' | 'DURO';
  motivos: { codigo: CodigoMotivo; mensaje: string; tipo: 'DURO' | 'AVISO' }[];
  /** ¿Es quien hoy tiene asignado el operativo? */
  actual: boolean;
  /** El tramo suyo con el que se pisa (para «Ocupado 08H00–16H30 con OCPMO-001»), si se pisa. */
  choque: { etiqueta: string; franja: Franja } | null;
  /** Zonales donde ya trabaja hoy que coinciden con la del operativo. */
  zonasComunes: string[];
  /**
   * Compartir unidad (2026-10-21): el operativo ya asignado a ESTE conductor con el que este puede
   * viajar en su misma unidad (`compartibles`, compatible), si lo hay.
   */
  compartirCon?: { operativoId: number; identificador: string } | null;
}

export interface Candidato {
  conductorId: number;
  nombre: string;
  turno: TurnoDelConductor | null;
  vehiculoId: number | null;
  placa: string | null;
  categoria: CategoriaCandidato;
  /** Una frase para la analista. */
  motivo: string;
  /** Los demás avisos (no cambian la categoría). */
  avisos: string[];
  actual: boolean;
  /** Solo DISPONIBLE y FUERA_TURNO se pueden asignar. */
  asignable: boolean;
  /** Con COMPARTE: el operativo cuya unidad se comparte (`POST /transporte/tramos/compartir`). */
  compartirCon: { operativoId: number; identificador: string } | null;
}

const NOMBRE_TURNO: Record<TurnoDelConductor, string> = {
  DIA: 'Día',
  NOCHE: 'Noche',
  ECU_NOCHE: 'ECU noche',
  LIBRE: 'Libre',
  ADMINISTRATIVO: 'Administrativo',
};

const ORDEN: Record<CategoriaCandidato, number> = {
  DISPONIBLE: 0,
  COMPARTE: 1,
  FUERA_TURNO: 2,
  OCUPADO: 3,
  LIBRE_INACTIVO: 4,
};

/** «08H00–16H30». */
export function franjaInstitucional(franja: Franja): string {
  return `${institucional(franja.inicio)}–${institucional(franja.fin)}`;
}

/** Clasifica un conductor y redacta su motivo. */
export function clasificarCandidato(entrada: EntradaCandidato): Candidato {
  const duros = entrada.motivos.filter((m) => m.tipo === 'DURO');
  const avisos = entrada.motivos.filter((m) => m.tipo === 'AVISO');
  const fueraDeTurno = avisos.find((m) => m.codigo === 'FUERA_DE_TURNO');

  let categoria: CategoriaCandidato;
  let motivo: string;
  const compartirCon = entrada.compartirCon ?? null;
  if (
    compartirCon &&
    duros.length > 0 &&
    duros.every((m) => m.codigo === 'SOLAPAMIENTO')
  ) {
    categoria = 'COMPARTE';
    motivo = `Comparte unidad con ${compartirCon.identificador}`;
  } else if (duros.some((m) => m.codigo === 'LIBRE_NO_ACTIVADO')) {
    categoria = 'LIBRE_INACTIVO';
    motivo = 'De libre hoy · active «Usar conductores de libre»';
  } else if (duros.length > 0) {
    categoria = 'OCUPADO';
    const solapa = duros.find((m) => m.codigo === 'SOLAPAMIENTO');
    motivo =
      solapa && entrada.choque
        ? `Ocupado ${franjaInstitucional(entrada.choque.franja)} con ${entrada.choque.etiqueta}`
        : duros[0].mensaje;
  } else if (fueraDeTurno) {
    categoria = 'FUERA_TURNO';
    motivo = motivoFueraDeTurno(entrada, fueraDeTurno.mensaje);
  } else {
    categoria = 'DISPONIBLE';
    motivo =
      entrada.zonasComunes.length > 0
        ? `Disponible · ya trabaja en ${entrada.zonasComunes[0]}`
        : 'Disponible en ese horario';
  }

  return {
    conductorId: entrada.conductorId,
    nombre: entrada.nombre,
    turno: entrada.turno,
    vehiculoId: entrada.vehiculoId,
    placa: entrada.placa,
    categoria,
    motivo,
    avisos: avisos
      .filter((m) => m.codigo !== 'FUERA_DE_TURNO')
      .map((m) => m.mensaje),
    actual: entrada.actual,
    asignable: categoria === 'DISPONIBLE' || categoria === 'FUERA_TURNO',
    compartirCon: categoria === 'COMPARTE' ? compartirCon : null,
  };
}

function motivoFueraDeTurno(
  entrada: EntradaCandidato,
  mensajeOriginal: string,
): string {
  if (entrada.turno === 'LIBRE') return 'De libre, activado: horas extra';
  if (entrada.turno === 'ADMINISTRATIVO') return 'Turno administrativo ese día';
  if (entrada.turno && entrada.ventanaTurno) {
    return `Fuera de su turno (${NOMBRE_TURNO[entrada.turno]} ${franjaInstitucional(entrada.ventanaTurno)})`;
  }
  return mensajeOriginal;
}

/**
 * La lista del diálogo: disponibles → fuera de turno → ocupados → libres sin activar, y el
 * asignado actual al final. Orden estable dentro de cada grupo.
 */
export function ordenarCandidatos(
  entradas: readonly EntradaCandidato[],
): Candidato[] {
  return entradas
    .map((entrada, indice) => ({ c: clasificarCandidato(entrada), indice }))
    .sort(
      (a, b) =>
        Number(a.c.actual) - Number(b.c.actual) ||
        ORDEN[a.c.categoria] - ORDEN[b.c.categoria] ||
        a.indice - b.indice,
    )
    .map((x) => x.c);
}
