/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos · Trámites de Inspección
 * Archivo: tramites-inspeccion.service.ts
 * Responsabilidad: Ofrecer y validar los trámites de Inspección de los inspectores asignados.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * DOS USOS, CON DOS ACTITUDES ANTE LA FALLA DE INSPECCIÓN:
 *
 *   · **Consultar** (el combo del registro): si Inspección no está, la respuesta lo DICE
 *     (`disponible: false` y el motivo) y nunca lanza. El operativo se registra igual sin trámite.
 *   · **Copiar para guardar** (alta y edición): el servidor VUELVE A PREGUNTAR a Inspección y solo
 *     guarda el trámite si de verdad está asignado a esa persona en esa fecha. Lo que el navegador
 *     envía no se cree. Si Inspección no responde, el guardado de ese trámite se rechaza.
 *
 * SOLO PARA INSPECTORES: área `GENERAL` o `TECNICO` de la ficha. El cruce es por CÉDULA, que es la
 * identidad de la ficha (`uq_funcionario_cedula`). La cédula no sale de este servicio.
 *
 * ALCANCE (H-01): la consulta solo devuelve a las personas que los roles de quien pregunta pueden
 * ASIGNAR (`PersonalElegibleService.areasAsignables`); las ajenas se omiten en silencio, como si no
 * se hubieran pedido. La Dirección, que ya ve la matriz completa, no se acota.
 *
 * CACHÉ CORTA, SOLO PARA CONSULTAR: el combo se vuelve a pedir cada vez que cambia el personal, y
 * sin caché cada cambio sería una llamada a Inspección. Se guarda el registro del día 60 s por
 * (fecha, SHA-256 del token): el token nunca se guarda en claro. El GUARDADO no la usa: un trámite
 * reasignado hace un minuto no debe copiarse.
 */

import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { AreaPersonal, RolDepartamental } from '@prisma/client';

import { ReglaNegocioError } from '../../../common/errors/errores-dominio';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import { FuncionariosService } from '../../talento-operativo/application/funcionarios.service';
import { PersonalElegibleService } from '../../talento-operativo/application/personal-elegible.service';
import {
  InspeccionNoDisponibleError,
  InspeccionTramitesClient,
  type AsignacionesDeInspector,
  type TramiteDeInspeccion,
} from '../infrastructure/inspeccion-tramites.client';

/** Áreas de la ficha que son inspectores (General y Técnico). */
const AREAS_INSPECTOR: readonly AreaPersonal[] = [
  AreaPersonal.GENERAL,
  AreaPersonal.TECNICO,
];

/** ¿El área de la ficha es de inspector? */
export function esAreaInspector(area: AreaPersonal): boolean {
  return AREAS_INSPECTOR.includes(area);
}

/** Lo que el combo necesita de una persona: si es inspector y sus trámites del día. */
export interface TramitesDePersona {
  funcionarioId: number;
  esInspector: boolean;
  tramites: TramiteDeInspeccion[];
}

/** Respuesta de la consulta. `disponible: false` NO es un error: es un estado. */
export interface ConsultaTramites {
  disponible: boolean;
  motivo: string | null;
  personas: TramitesDePersona[];
}

/** Una persona que pide guardar un trámite, ya identificada por su ficha. */
export interface SolicitudDeTramite {
  funcionarioId: number;
  cedula: string;
  area: AreaPersonal;
  nombre: string;
  codigoTramite: string;
}

/** Motivo cuando la sesión no trae token de Auth central (sesiones locales o de pruebas). */
const MOTIVO_SIN_TOKEN =
  'Su sesión no tiene un token de Auth central con el que consultar el sistema de Inspección. Vuelva a entrar desde el portal institucional.';

/** Vida de una entrada de la caché de consulta. */
const VIGENCIA_CACHE_MS = 60_000;

interface EntradaCache {
  vence: number;
  registro: AsignacionesDeInspector[];
}

@Injectable()
export class TramitesInspeccionService {
  private readonly cache = new Map<string, EntradaCache>();

  constructor(
    private readonly cliente: InspeccionTramitesClient,
    private readonly funcionarios: FuncionariosService,
    private readonly elegibles: PersonalElegibleService,
  ) {}

  /**
   * Los trámites de cada persona en la fecha. Nunca lanza por causa de Inspección. Solo vuelven
   * las personas que existen y que estos roles pueden asignar.
   */
  async consultar(
    fecha: string,
    funcionarioIds: readonly number[],
    tokenAuth: string | null,
    roles: readonly RolDepartamental[] = [],
  ): Promise<ConsultaTramites> {
    const todas = await this.funcionarios.obtenerVarios(funcionarioIds);
    const fichas = await this.alAlcance(todas, roles);
    const inspectores = fichas.filter((ficha) => esAreaInspector(ficha.area));

    const vacias = (): TramitesDePersona[] =>
      fichas.map((ficha) => ({
        funcionarioId: ficha.id,
        esInspector: esAreaInspector(ficha.area),
        tramites: [],
      }));

    // Sin inspectores no hace falta preguntar a nadie: el combo no se pinta.
    if (inspectores.length === 0) {
      return { disponible: true, motivo: null, personas: vacias() };
    }

    let registro: AsignacionesDeInspector[];
    try {
      registro = await this.registroConCache(fecha, tokenAuth);
    } catch (error: unknown) {
      if (error instanceof InspeccionNoDisponibleError) {
        return { disponible: false, motivo: error.message, personas: vacias() };
      }
      throw error;
    }

    const porCedula = indexarPorCedula(registro);
    return {
      disponible: true,
      motivo: null,
      personas: fichas.map((ficha) => ({
        funcionarioId: ficha.id,
        esInspector: esAreaInspector(ficha.area),
        tramites: esAreaInspector(ficha.area)
          ? (porCedula.get(normalizarCedula(ficha.cedula)) ?? [])
          : [],
      })),
    };
  }

  /**
   * Las COPIAS a guardar, por funcionario, tras volver a preguntar a Inspección. Una sola consulta
   * para todo el registro. Lanza si Inspección no está o si un trámite no es de esa persona.
   */
  async copiasParaGuardar(
    fecha: string,
    solicitudes: readonly SolicitudDeTramite[],
    tokenAuth: string | null,
  ): Promise<Map<number, TramiteDeInspeccion>> {
    const copias = new Map<number, TramiteDeInspeccion>();
    if (solicitudes.length === 0) return copias;

    for (const solicitud of solicitudes) {
      if (!esAreaInspector(solicitud.area)) {
        throw new ReglaNegocioError(
          CODIGOS_ERROR.TRAMITE_INSPECCION_NO_VALIDO,
          `${solicitud.nombre} no es inspector: solo a los inspectores se les asigna un trámite de Inspección.`,
          { funcionarioId: solicitud.funcionarioId },
        );
      }
    }

    let registro: AsignacionesDeInspector[];
    try {
      registro = await this.registroDelDia(fecha, tokenAuth);
    } catch (error: unknown) {
      if (error instanceof InspeccionNoDisponibleError) {
        throw new ReglaNegocioError(
          CODIGOS_ERROR.INSPECCION_NO_DISPONIBLE,
          `No se pudo comprobar el trámite de Inspección: ${error.message} Quite el trámite para guardar sin él.`,
        );
      }
      throw error;
    }

    const porCedula = indexarPorCedula(registro);
    for (const solicitud of solicitudes) {
      const codigo = solicitud.codigoTramite.trim();
      const tramite = (
        porCedula.get(normalizarCedula(solicitud.cedula)) ?? []
      ).find((fila) => fila.codigoTramite === codigo);

      if (!tramite) {
        throw new ReglaNegocioError(
          CODIGOS_ERROR.TRAMITE_INSPECCION_NO_VALIDO,
          `El trámite ${codigo} no figura entre los asignados a ${solicitud.nombre} en el sistema de Inspección para el ${fecha}.`,
          { funcionarioId: solicitud.funcionarioId, codigoTramite: codigo },
        );
      }
      copias.set(solicitud.funcionarioId, tramite);
    }
    return copias;
  }

  /** Recorte H-01: la Dirección no se acota; el resto, a las áreas que puede asignar. */
  private async alAlcance<T extends { area: AreaPersonal }>(
    fichas: T[],
    roles: readonly RolDepartamental[],
  ): Promise<T[]> {
    if (roles.includes(RolDepartamental.DIRECTOR)) return fichas;
    const areas = await this.elegibles.areasAsignables(roles);
    return fichas.filter((ficha) => areas.includes(ficha.area));
  }

  /** El registro del día con la caché corta de la consulta. Ver la cabecera. */
  private async registroConCache(
    fecha: string,
    tokenAuth: string | null,
  ): Promise<AsignacionesDeInspector[]> {
    if (!tokenAuth) throw new InspeccionNoDisponibleError(MOTIVO_SIN_TOKEN);
    const ahora = Date.now();
    const clave = `${fecha}|${createHash('sha256').update(tokenAuth).digest('hex')}`;
    const guardada = this.cache.get(clave);
    if (guardada && guardada.vence > ahora) return guardada.registro;

    const registro = await this.registroDelDia(fecha, tokenAuth);
    // Se purgan las vencidas al escribir: la caché no crece sin límite.
    for (const [otra, entrada] of this.cache) {
      if (entrada.vence <= ahora) this.cache.delete(otra);
    }
    this.cache.set(clave, { vence: ahora + VIGENCIA_CACHE_MS, registro });
    return registro;
  }

  private async registroDelDia(
    fecha: string,
    tokenAuth: string | null,
  ): Promise<AsignacionesDeInspector[]> {
    if (!tokenAuth) throw new InspeccionNoDisponibleError(MOTIVO_SIN_TOKEN);
    return this.cliente.consultar(fecha, tokenAuth);
  }
}

/** Cédula comparable: sin espacios ni guiones. */
function normalizarCedula(cedula: string): string {
  return cedula.replace(/[\s-]/g, '');
}

function indexarPorCedula(
  registro: readonly AsignacionesDeInspector[],
): Map<string, TramiteDeInspeccion[]> {
  const indice = new Map<string, TramiteDeInspeccion[]>();
  for (const fila of registro) {
    const clave = normalizarCedula(fila.cedula);
    indice.set(clave, [...(indice.get(clave) ?? []), ...fila.tramites]);
  }
  return indice;
}
