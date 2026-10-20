/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Notas del operativo
 * Archivo: notas-operativo.ts
 * Responsabilidad: Armar las notas de la celda «Observaciones» —las de la bitácora y la tarjeta
 *                  COMPARTIDA— a partir de lo mínimo de un operativo. Función pura.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 *
 * UNA SOLA FUENTE PARA CUATRO PANTALLAS Y UN PDF (plan «notas-jornada-matriz», J1). Nació en
 * `operativos/presentation/dto/operativo.dto.ts` (`notasDelOperativo`) para Mis operativos y el
 * Registro. La Jornada y la Matriz viven en `documentos`, con repositorios propios a propósito, y
 * no pueden importar la presentación de otro submódulo: por eso la regla baja aquí con un tipo
 * MÍNIMO que cumplen los tres payloads de Prisma, y `operativos` delega en ella sin cambiar una
 * coma de su respuesta.
 *
 * La tarjeta COMPARTIDA no es una fila de la bitácora: sale de `oper_compartir_con_id` (N1). Así
 * retirar la intención la quita de todas partes sin limpiar notas.
 */

import { RolDepartamental } from '@prisma/client';

import { NOMBRE_ROL } from '../roles/catalogo-roles';

/** Una nota de la celda Observaciones, la misma forma en las cuatro pantallas. */
export interface NotaOperativo {
  id: string;
  tipo: 'NOTA' | 'COMPARTIDA';
  texto: string;
  /** Solo el nombre del autor (o el rol en palabras si no hay cuenta): nada más de su cuenta. */
  autor: string;
  /** ISO 8601. */
  fecha: string;
  operativoRelacionadoId: number | null;
}

/** Lo mínimo de un operativo para armar sus notas. Lo cumplen los payloads de las tres consultas. */
export interface OperativoConNotas {
  id: number;
  creadoPor: number;
  creadoPorRol: RolDepartamental;
  creadoEn: Date;
  compartirSolicitadoPor: number | null;
  compartirSolicitadoEn: Date | null;
  compartirCon: { id: number; identificador: string } | null;
  /** La columna de la intención, si viaja (los listados de `operativos`): basta para pedir su firmante. */
  compartirConId?: number | null;
  observaciones: {
    id: number;
    texto: string;
    creadoPor: number;
    creadoPorRol: RolDepartamental;
    creadoEn: Date;
  }[];
}

/** `usua_id` → nombre, de UNA consulta por listado (`autoresPorIds`). */
export type MapaDeAutores = Record<number, string>;

/** Los `usua_id` que firman las notas de un lote: los que `autoresPorIds` debe resolver. */
export function firmantesDeNotas(operativos: OperativoConNotas[]): number[] {
  const ids = new Set<number>();
  for (const operativo of operativos) {
    for (const nota of operativo.observaciones) ids.add(nota.creadoPor);
    if (operativo.compartirCon || (operativo.compartirConId ?? null) !== null) {
      ids.add(operativo.compartirSolicitadoPor ?? operativo.creadoPor);
    }
  }
  return [...ids];
}

/**
 * Las notas de un operativo: las de la bitácora y, si pidió compartir unidad, la COMPARTIDA. La más
 * reciente primero; a igual fecha, la compartida delante. Sin autor en el mapa, el rol en palabras.
 */
export function notasDeOperativo(
  operativo: OperativoConNotas,
  autores: MapaDeAutores = {},
): NotaOperativo[] {
  const notas: NotaOperativo[] = operativo.observaciones.map((nota) => ({
    id: `nota-${nota.id}`,
    tipo: 'NOTA',
    texto: nota.texto,
    autor: autores[nota.creadoPor] ?? NOMBRE_ROL[nota.creadoPorRol],
    fecha: nota.creadoEn.toISOString(),
    operativoRelacionadoId: null,
  }));

  if (operativo.compartirCon) {
    const solicitante = operativo.compartirSolicitadoPor ?? operativo.creadoPor;
    notas.push({
      id: `compartida-${operativo.id}`,
      tipo: 'COMPARTIDA',
      texto: `Comparte con ${operativo.compartirCon.identificador}`,
      autor: autores[solicitante] ?? NOMBRE_ROL[operativo.creadoPorRol],
      fecha: (
        operativo.compartirSolicitadoEn ?? operativo.creadoEn
      ).toISOString(),
      operativoRelacionadoId: operativo.compartirCon.id,
    });
  }

  return notas.sort((una, otra) => {
    if (una.fecha !== otra.fecha) return una.fecha < otra.fecha ? 1 : -1;
    return una.tipo === otra.tipo ? 0 : una.tipo === 'COMPARTIDA' ? -1 : 1;
  });
}

/** Texto de la COMPARTIDA cuando el anfitrión es de un formulario que el rol no ve (RN-48, J3). */
export const TEXTO_COMPARTIDA_AJENA =
  'Comparte unidad con un operativo de otro formulario';

/**
 * RN-48 (J3). La Jornada solo muestra los formularios del rol: si el anfitrión de una COMPARTIDA no
 * está entre los operativos visibles, la nota no lo nombra ni enlaza.
 */
export function ocultarCompartidaAjena(
  notas: NotaOperativo[],
  visibles: ReadonlySet<number>,
): NotaOperativo[] {
  return notas.map((nota) =>
    nota.tipo === 'COMPARTIDA' &&
    nota.operativoRelacionadoId !== null &&
    !visibles.has(nota.operativoRelacionadoId)
      ? { ...nota, texto: TEXTO_COMPARTIDA_AJENA, operativoRelacionadoId: null }
      : nota,
  );
}
