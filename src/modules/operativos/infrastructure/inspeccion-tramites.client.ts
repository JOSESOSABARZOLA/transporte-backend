/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos · Trámites de Inspección
 * Archivo: inspeccion-tramites.client.ts
 * Responsabilidad: Preguntarle al sistema de Inspección qué trámites tiene cada inspector en una fecha.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES LA TERCERA LLAMADA SALIENTE DEL MÓDULO, después del canje y del directorio de Auth.
 *
 * `GET {INSPECCION_API_URL}/operativos?fecha=AAAA-MM-DD` devuelve, agrupados por inspector (con su
 * cédula), los trámites que tiene asignados ese día. El operador elige uno por inspector al
 * registrar el operativo, y la orden de servicio lo menciona.
 *
 * LA AUTENTICACIÓN ES EL TOKEN DE AUTH CENTRAL DEL USUARIO CONECTADO, con prefijo `Bearer`, igual
 * que el directorio. Comprobado contra el servicio desplegado el 2026-10-07:
 *
 * ```
 * sin cabecera  → 500 {"message":"Token no encontrado"}
 * Bearer x      → 500 {"message":"Token incorrecto o expirado"}
 * ```
 *
 * Como Auth, Inspección rechaza con 500 y el motivo en `message`: se arrastra ese texto para que
 * la pantalla distinga una sesión caducada de un servicio caído.
 *
 * EL TOKEN NUNCA SE ESCRIBE EN LA BITÁCORA (B-01): solo el estado y el motivo que devuelve Inspección.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * TOLERANTE A PROPÓSITO, con el mismo criterio que `auth-usuarios.client.ts`: el contrato llegó
 * como un ejemplo, no como una especificación. Lo único que se exige es la cédula del inspector
 * —la llave con la que se cruza contra la ficha— y el código de cada trámite.
 */

import { Injectable, Logger } from '@nestjs/common';

import { conBearer } from '../../../common/auth/con-bearer';
import { ApplicationError } from '../../../common/errors/application.error';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import { appConfig } from '../../../config/app.config';

/** Cinco segundos, el mismo tope que Auth. El registro no debe quedar colgado de otro sistema. */
const ESPERA_MAXIMA_MS = 5000;

/** Un trámite asignado a un inspector, ya normalizado. Los campos ausentes quedan en `null`. */
export interface TramiteDeInspeccion {
  codigoTramite: string;
  nroSitra: string | null;
  predio: string | null;
  zonal: string | null;
  materia: string | null;
  tipoTramite: string | null;
  estado: string | null;
}

/** Los trámites de un inspector en la fecha consultada. */
export interface AsignacionesDeInspector {
  cedula: string;
  inspector: string;
  tramites: TramiteDeInspeccion[];
}

/**
 * 503 · Inspección no está configurado, no respondió o rechazó la consulta.
 *
 * `ApplicationError` y no `Error` pelado por la misma razón que `AuthNoDisponibleError`: el filtro
 * global solo muestra tal cual los mensajes de su jerarquía (regla 7).
 */
export class InspeccionNoDisponibleError extends ApplicationError {
  constructor(motivo: string) {
    super(motivo, 503, CODIGOS_ERROR.INSPECCION_NO_DISPONIBLE);
    this.name = 'InspeccionNoDisponibleError';
  }
}

@Injectable()
export class InspeccionTramitesClient {
  private readonly logger = new Logger(InspeccionTramitesClient.name);

  /** `true` si hay a dónde preguntar. */
  get configurado(): boolean {
    return appConfig.inspeccion.urlApi !== '';
  }

  /** Los trámites de cada inspector en `fecha` (AAAA-MM-DD). Lanza `InspeccionNoDisponibleError`. */
  async consultar(
    fecha: string,
    tokenAuth: string,
  ): Promise<AsignacionesDeInspector[]> {
    if (!this.configurado) {
      throw new InspeccionNoDisponibleError(
        'La consulta de trámites de Inspección no está configurada en este ambiente. Comuníquelo al administrador del sistema.',
      );
    }

    const destino = `${appConfig.inspeccion.urlApi}/operativos?fecha=${encodeURIComponent(fecha)}`;
    let respuesta: Response;

    try {
      respuesta = await fetch(destino, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: conBearer(tokenAuth),
        },
        signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
      });
    } catch (error: unknown) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Inspección no respondió al consultar trámites: ${motivo}`,
      );
      throw new InspeccionNoDisponibleError(
        'El sistema de Inspección no respondió. Puede registrar el operativo sin trámite y completarlo después.',
      );
    }

    if (!respuesta.ok) {
      const suyo = await this.motivoDeInspeccion(respuesta);
      this.logger.warn(
        `Inspección rechazó la consulta de trámites con ${respuesta.status}${
          suyo ? `: ${suyo}` : '.'
        }`,
      );
      throw new InspeccionNoDisponibleError(
        `El sistema de Inspección rechazó la consulta${suyo ? ` («${suyo}»)` : ''}. Si su sesión caducó, vuelva a entrar desde el portal institucional.`,
      );
    }

    let cuerpo: unknown;
    try {
      cuerpo = await respuesta.json();
    } catch {
      cuerpo = null;
    }

    const filas = registrosDe(cuerpo);
    if (filas === null) {
      throw new InspeccionNoDisponibleError(
        'El sistema de Inspección devolvió los trámites en un formato inesperado. Comuníquelo al administrador del sistema.',
      );
    }

    return filas
      .map((fila) => normalizarInspector(fila))
      .filter((fila): fila is AsignacionesDeInspector => fila !== null);
  }

  /** El `message` del rechazo, si lo hay. Cadena vacía ante cualquier tropiezo. */
  private async motivoDeInspeccion(respuesta: Response): Promise<string> {
    try {
      const cuerpo: unknown = await respuesta.json();
      if (
        typeof cuerpo === 'object' &&
        cuerpo !== null &&
        'message' in cuerpo &&
        typeof (cuerpo as { message: unknown }).message === 'string'
      ) {
        return (cuerpo as { message: string }).message.trim();
      }
    } catch {
      // Sin cuerpo legible. El estado ya quedó en la bitácora.
    }
    return '';
  }
}

/** `registroAsignacion` si el cuerpo tiene la forma esperada; `null` si no. */
function registrosDe(cuerpo: unknown): unknown[] | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;
  const registros = (cuerpo as { registroAsignacion?: unknown })
    .registroAsignacion;
  return Array.isArray(registros) ? registros : null;
}

/** Un inspector con sus trámites. Sin cédula la fila no sirve: no se puede cruzar con la ficha. */
function normalizarInspector(fila: unknown): AsignacionesDeInspector | null {
  const dato = (fila ?? {}) as Record<string, unknown>;
  const cedula = texto(dato.cedula);
  if (!cedula) return null;

  const asignaciones = Array.isArray(dato.asignaciones)
    ? dato.asignaciones
    : [];

  return {
    cedula,
    inspector: texto(dato.inspector) ?? '',
    tramites: asignaciones
      .map((asignacion) => normalizarTramite(asignacion))
      .filter((tramite): tramite is TramiteDeInspeccion => tramite !== null),
  };
}

/** Un trámite. Sin código no se puede elegir ni volver a comprobar, así que se descarta. */
function normalizarTramite(fila: unknown): TramiteDeInspeccion | null {
  const dato = (fila ?? {}) as Record<string, unknown>;
  const codigoTramite = texto(dato.codigoTramite);
  if (!codigoTramite) return null;

  return {
    codigoTramite,
    nroSitra: texto(dato.nroSitra) ?? null,
    predio: texto(dato.predio) ?? null,
    zonal: texto(dato.zonal) ?? null,
    materia: texto(dato.materia) ?? null,
    tipoTramite: texto(dato.tipoTramite) ?? null,
    estado: texto(dato.estado) ?? null,
  };
}

/** Texto recortado; los números también valen (un predio puede llegar como número). */
function texto(valor: unknown): string | undefined {
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return typeof valor === 'string' && valor.trim() !== ''
    ? valor.trim()
    : undefined;
}
