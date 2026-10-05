/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: orden-servicio.dto.ts
 * Responsabilidad: Componer la respuesta de la orden de servicio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA RESPUESTA LLEVA EL DATO AISLADO TAL COMO SE GUARDÓ. Ni un campo más.
 *
 * Es donde INV-24 podría romperse sin que nadie lo note: bastaría con «enriquecer» la
 * respuesta con el punto de encuentro «para que el funcionario sepa a dónde ir». No se
 * hace, y la razón es RN-51: el punto de encuentro de los demás operativos es lo que
 * permitía a los intervenidos anticiparse.
 *
 * Lo único que acompaña al dato es lo que **identifica al documento**: su código, cuándo
 * se emitió y a qué jornada corresponde. Nada de eso describe el operativo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { DatoAislado } from '../../domain/dato-aislado';
import { esDatoAisladoValido } from '../../domain/dato-aislado';
import type { OrdenConOperativo } from '../../infrastructure/orden-servicio.repository';
import {
  estadoDeOrden,
  faltantesDeOrden,
  firmanteDeOrden,
  formatearNumeroOrden,
  versionDeCodigo,
  type EstadoOrden,
  type Faltante,
  type FirmanteOrden,
} from '../../application/estado-orden';

// Los helpers del estado/faltantes/número viven en `application/estado-orden`. Se re-exportan aquí
// por compatibilidad con quien ya los importaba del DTO.
export { faltantesDeOrden, firmanteDeOrden, formatearNumeroOrden };
export type { EstadoOrden, Faltante, FirmanteOrden };

export interface OrdenServicioResponseDto {
  codigo: string;
  emitidaEn: string;
  vigente: boolean;
  /** Estado único derivado (A). */
  estado: EstadoOrden;
  /** Versión (v1, v2…): el nº de emisión que ya lleva el código `OS-...-N`. */
  version: number;
  /** Número oficial AMC-OS-<8>-<año> una vez Vigente, o `null` mientras es Borrador (G). */
  numeroOrden: string | null;
  /** Fecha de la jornada, para ordenar «mis órdenes» sin abrir el documento. */
  fechaJornada: string;
  /** Los cuatro campos, y solo los cuatro. INV-24. */
  datoAislado: DatoAislado;
  /**
   * Datos OBLIGATORIOS del memorando que aún no se han completado (D13), cada uno con su `token`, su
   * `etiqueta` legible y su `origen` (persona/configuración/firmante) para agruparlos en el aviso de
   * borrador (E21). Si hay alguno, la orden está en BORRADOR: el documento saldría con huecos
   * resaltados. Vacío = lista. `numeroOrden` NO cuenta como faltante: se asigna al quedar Vigente (G14).
   */
  faltantes: Faltante[];
  /** Copia del firmante (Director) congelada al emitir, o `null` si aún no se guardó. */
  firmante: FirmanteOrden | null;
  /** PLANTILLA POR DIRECTOR (2026-10-05): quién generó la orden (`null` = anterior a la migración). */
  directorId: number | null;
  /** Nombre del Director que la generó, para «Generada por …». */
  directorNombre: string | null;
  /** Si la generó el usuario en sesión: solo entonces puede reemitirla o editarla (punto 8). */
  esPropia: boolean;
  /** Versión de la plantilla con la que se resuelve. */
  plantillaVersion: number | null;
}

/** Lo que la respuesta necesita del contexto: quién consulta y el nombre de los Directores. */
export interface ContextoRespuestaOrden {
  usuarioId: number;
  nombresDirectores: Map<number, string>;
}

export function aOrdenServicioResponse(
  orden: OrdenConOperativo,
  faltantes: Faltante[],
  contexto: ContextoRespuestaOrden,
): OrdenServicioResponseDto {
  // Los faltantes se calculan en el servicio (plantilla-aware, D12/D15) y llegan ya resueltos: el
  // DTO no vuelve a derivarlos para que tabla, chip, tarjeta y visor listen exactamente lo mismo.
  const numero = formatearNumeroOrden(orden.numeroAnio, orden.numeroSecuencial);
  const estado = estadoDeOrden(orden.vigente, faltantes, numero !== null);

  return {
    codigo: orden.codigo,
    emitidaEn: orden.emitidaEn.toISOString(),
    vigente: orden.vigente,
    estado,
    version: versionDeCodigo(orden.codigo),
    // Un BORRADOR nunca expone número (punto 13): si una reemisión incompleta lo conserva reservado,
    // se muestra recién al quedar Vigente. Una Reemplazada conserva el suyo como histórico.
    numeroOrden: estado === 'BORRADOR' ? null : numero,
    fechaJornada: orden.operativo.cuadro.fecha.toISOString().slice(0, 10),
    datoAislado: exigirDatoAislado(orden),
    faltantes,
    firmante: firmanteDeOrden(orden.firmante),
    directorId: orden.directorId,
    directorNombre:
      orden.directorId !== null
        ? (contexto.nombresDirectores.get(orden.directorId) ?? null)
        : null,
    esPropia: orden.directorId === contexto.usuarioId,
    plantillaVersion: orden.plantillaVersion,
  };
}

/**
 * Comprueba el contenido guardado antes de devolverlo.
 *
 * Si alguien hubiera escrito en la columna `JSONB` por fuera del sistema —una migración
 * a mano, una corrección directa en la base—, esto lo detiene aquí en lugar de entregar
 * un documento con un campo que nadie autorizó. Es barato y cierra el único camino por el
 * que INV-24 podría romperse después de la emisión.
 */
function exigirDatoAislado(orden: OrdenConOperativo): DatoAislado {
  const dato = orden.datoAislado as unknown;

  if (!esDatoAisladoValido(dato)) {
    throw new Error(
      `La orden ${orden.codigo} tiene un contenido que no corresponde a los cuatro campos autorizados.`,
    );
  }

  return dato;
}
