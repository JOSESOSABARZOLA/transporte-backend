/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: catalogos-response.dto.ts
 * Responsabilidad: Componer las respuestas de zonales, puntos, tipos e instituciones.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * `capturaLibrePunto` y `capturaLibreTipo` son RN-20: indican qué CATÁLOGO del
 * formulario ofrece la opción ADICIONALES con captura de texto libre. Van aquí y no
 * dentro de cada catálogo porque ADICIONALES no es una fila, sino una opción.
 *
 * Eran una sola bandera hasta el 2026-08-11, y la interfaz la aplicaba a los dos
 * desplegables: ofrecía captura libre del punto de encuentro, que el insumo aprobado no
 * contempla en ninguno de los nueve formularios.
 */

import type {
  Institucion,
  PuntoEncuentro,
  TipoControl,
  Zonal,
} from '@prisma/client';

import type { CatalogosDeFormulario } from '../../application/catalogos.service';
import type {
  PuntoConZonal,
  TipoControlDelimitado,
} from '../../infrastructure/catalogos.repository';

export interface ZonalResponseDto {
  id: number;
  codigo: string;
  nombre: string;
  esDmq: boolean;
  /**
   * Vigente o desactivada. Al registrar solo llegan las vigentes —la cascada las filtra—,
   * así que allí siempre es `true`; importa en administración, que sí ve las inactivas
   * (`GET /zonales?incluirInactivas=true`) para poder reactivarlas.
   */
  activo: boolean;
}

export interface PuntoResponseDto {
  id: number;
  nombre: string;
  zonalId: number;
  zonalNombre?: string;
  /** PV-36. Vigente o desactivado; solo el camino de administración lo trae. */
  activo?: boolean;
  /** El punto de encuentro pertenece a UN formulario (2026-09-29). */
  formularioId: number;
}

export interface TipoControlResponseDto {
  id: number;
  nombre: string;
  activo?: boolean;
  /** El tipo de control pertenece a UN formulario (2026-09-07). */
  formularioId: number;
}

export interface InstitucionResponseDto {
  id: number;
  sigla: string;
  nombre: string;
  activo?: boolean;
  /** La institución pertenece a UN formulario (2026-09-29). */
  formularioId: number;
}

export interface CatalogosFormularioResponseDto {
  zonales: ZonalResponseDto[];
  puntos: PuntoResponseDto[];
  tiposControl: TipoControlResponseDto[];
  instituciones: InstitucionResponseDto[];
  capturaLibrePunto: boolean;
  capturaLibreTipo: boolean;
  /**
   * Si el formulario admite VARIOS tipos de control a la vez (los nueve desde 2026-09-14; al
   * principio solo el 8). El registro pinta un selector múltiple (`SelectorTokens`) en lugar
   * del desplegable único cuando es true. Se serializa aquí a propósito: el servicio lo
   * calcula, pero sin esta línea no llegaba al navegador y quedaba en selección única.
   */
  tipoControlMultiple: boolean;
  /**
   * Si cada persona asignada genera su propio operativo —el SPLIT— (el 8 y el 5, este último
   * para que cada área lleve su código). No implica la columna de cantidad: eso es
   * `cantidadPorPersona`.
   */
  variosPorPersona: boolean;
  /**
   * Si el formulario OFRECE fijar cuántos operativos genera cada persona (cantidad > 1). Solo
   * el 8. El registro pinta la columna «Cantidad de operativos» por persona cuando es true; el
   * 5 divide por persona pero no la ofrece.
   */
  cantidadPorPersona: boolean;
  /**
   * Si al registrar se puede AGREGAR un punto de encuentro al catálogo, ligado a la zonal
   * elegida (Unidad de Operativos, formularios 1-4). Distinto de `capturaLibrePunto`.
   */
  puntoManual: boolean;
}

export function aZonalResponse(zonal: Zonal): ZonalResponseDto {
  return {
    id: zonal.id,
    codigo: zonal.codigo,
    nombre: zonal.nombre,
    esDmq: zonal.esDmq,
    activo: zonal.activo,
  };
}

export function aPuntoResponse(punto: PuntoEncuentro): PuntoResponseDto {
  return {
    id: punto.id,
    nombre: punto.nombre,
    zonalId: punto.zonalId,
    activo: punto.activo,
    formularioId: punto.formularioId,
  };
}

export function aPuntoConZonalResponse(punto: PuntoConZonal): PuntoResponseDto {
  return {
    ...aPuntoResponse(punto),
    zonalNombre: punto.zonal.nombre,
  };
}

export function aTipoControlDelimitadoResponse(
  tipo: TipoControlDelimitado,
): TipoControlResponseDto {
  // El tipo ya lleva su `formularioId`; no hay lista de delimitación que anexar.
  return aTipoControlResponse(tipo);
}

export function aTipoControlResponse(
  tipo: TipoControl,
): TipoControlResponseDto {
  return {
    id: tipo.id,
    nombre: tipo.nombre,
    activo: tipo.activo,
    formularioId: tipo.formularioId,
  };
}

export function aInstitucionResponse(
  institucion: Institucion,
): InstitucionResponseDto {
  return {
    id: institucion.id,
    sigla: institucion.sigla,
    nombre: institucion.nombre,
    activo: institucion.activo,
    formularioId: institucion.formularioId,
  };
}

export function aCatalogosResponse(
  catalogos: CatalogosDeFormulario,
): CatalogosFormularioResponseDto {
  return {
    zonales: catalogos.zonales.map(aZonalResponse),
    puntos: catalogos.puntos.map(aPuntoConZonalResponse),
    tiposControl: catalogos.tiposControl.map(aTipoControlDelimitadoResponse),
    instituciones: catalogos.instituciones.map(aInstitucionResponse),
    capturaLibrePunto: catalogos.capturaLibrePunto,
    capturaLibreTipo: catalogos.capturaLibreTipo,
    tipoControlMultiple: catalogos.tipoControlMultiple,
    variosPorPersona: catalogos.variosPorPersona,
    cantidadPorPersona: catalogos.cantidadPorPersona,
    puntoManual: catalogos.puntoManual,
  };
}
