/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ausencias de conductores
 * Archivo: ausencias-conductor.service.ts
 * Responsabilidad: Registrar, listar y retirar las ausencias de los conductores de la flota.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-16
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA AUSENCIA DEL CONDUCTOR YA SE LEÍA; FALTABA ESCRIBIRLA. 2026-10-16.
 *
 * `t_disponibilidad` admite `cond_id` desde el esquema inicial (`ck_disponibilidad_sujeto`) y
 * toda la planificación DAF la respeta: la política (`CONDUCTOR_AUSENTE`), el optimizador, la
 * jornada, `GET /transporte/conductores`, la capacidad y los turnos del mes. Lo que no existía
 * era el camino para registrarla: era un `INSERT` a mano. Es el mismo hueco que el
 * mantenimiento de vehículos cerró el 2026-08-31, y se cierra igual: en `transporte`, junto
 * al conductor, que es de este submódulo.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * MISMAS REGLAS QUE LAS AUSENCIAS DEL PERSONAL (`talento-operativo/disponibilidad.service.ts`),
 * con las mismas funciones puras (`common/ausencias/reglas-ausencia.ts`), para que las dos se
 * midan con la misma vara:
 *   · RN-30: solo las situaciones que excluyen (VACACIONES, REPOSO_MEDICO, CALAMIDAD, PERMISO,
 *     LICENCIA, CAPACITACION, COMISION_SERVICIOS). Ni `DISPONIBLE` —no es una ausencia— ni
 *     `MANTENIMIENTO` —es de vehículos—.
 *   · El rango no se invierte (`ck_disponibilidad_rango` lo respalda en la base).
 *   · INV-14: dos ausencias del mismo conductor no se cruzan (409 `AUSENCIA_SOLAPADA`).
 *   · B7 de P-07: una ausencia que ya terminó no se quita, es historia (409 `AUSENCIA_PASADA`).
 *   · El motivo NO entra en la traza: puede describir una condición de salud.
 *
 * LO QUE NO SE COPIA DEL PERSONAL, Y POR QUÉ. El alcance por dirección (`exigirSuDepartamento`,
 * H-01) y la autoría al retirar existen porque allí cada departamento administra SU gente. La
 * flota tiene un solo dueño: quien tiene `flota:ausencias` (hoy DAF, ADMINISTRADOR_DAF y
 * ADMINISTRADOR), igual que el mantenimiento. Si el negocio reparte la flota, se acota aquí.
 *
 * NO RETIRA AL CONDUCTOR DE LO YA ASIGNADO (A5). Registrar la ausencia devuelve los tramos que
 * el conductor ya tiene en esas fechas para que la pantalla avise; reasignarlos es un acto de
 * la DAF en «Planificar el día», con sus reglas. Es el mismo criterio que con el personal.
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  type Disponibilidad,
  type EstadoDisponibilidad,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  comoFechaIso,
  ESTADOS_QUE_EXCLUYEN,
  estadoDeAusencia,
  seSolapan,
} from '../../../common/ausencias/reglas-ausencia';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { fechaIsoEnZona } from '../../../common/utilidades/marca-tiempo';
import {
  AusenciasConductorRepository,
  type AusenciaDeLaFlota,
  type TramoDelConductor,
} from '../infrastructure/ausencias-conductor.repository';

export interface DatosAusenciaConductor {
  estado: EstadoDisponibilidad;
  desde: Date;
  hasta: Date;
  motivo?: string | null;
}

export interface AusenciaRegistrada {
  ausencia: Disponibilidad;
  /** A5: tramos que el conductor ya tenía en el rango. La ausencia no los retira. */
  tramosAfectados: TramoDelConductor[];
}

@Injectable()
export class AusenciasConductorService {
  constructor(
    private readonly repositorio: AusenciasConductorRepository,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─────────────────────────── Consulta ───────────────────────────

  /** Las ausencias de un conductor, con su motivo: las lee quien las administra. */
  async listarDe(conductorId: number): Promise<Disponibilidad[]> {
    await this.exigirConductor(conductorId);
    return this.repositorio.listarDe(conductorId);
  }

  /** En curso y próximas de toda la flota, sin motivo, en una sola consulta. */
  async deLaFlota(desde: Date): Promise<AusenciaDeLaFlota[]> {
    return this.repositorio.vigentesYProximas(desde);
  }

  // ─────────────────────────── Registro ───────────────────────────

  async registrar(
    conductorId: number,
    datos: DatosAusenciaConductor,
    usuarioId: number,
  ): Promise<AusenciaRegistrada> {
    await this.exigirConductor(conductorId);

    exigirSituacionDeAusencia(datos.estado);
    exigirRango(datos.desde, datos.hasta);
    await this.exigirSinSolape(conductorId, datos);

    const ausencia = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const creada = await this.repositorio.crear(
          {
            conductorId,
            estado: datos.estado,
            desde: datos.desde,
            hasta: datos.hasta,
            motivo: datos.motivo?.trim() || null,
            registradoPor: usuarioId,
          },
          cliente,
        );

        // La traza NO copia el motivo (dato de salud posible): qué, sobre quién y cuándo.
        await this.auditoria.registrar(
          {
            entidad: 't_disponibilidad',
            entidadId: creada.id,
            accion: AccionAuditoria.CREAR,
            cambios: [
              {
                campo: 'disp_estado',
                valorNuevo: resumen(
                  datos.estado,
                  conductorId,
                  datos.desde,
                  datos.hasta,
                ),
              },
            ],
            usuario: usuarioId,
          },
          cliente,
        );

        return creada;
      },
    );

    const tramosAfectados = await this.repositorio.tramosEnRango(
      conductorId,
      datos.desde,
      datos.hasta,
    );

    return { ausencia, tramosAfectados };
  }

  /**
   * Retira una ausencia registrada por error. Borrado físico, como en el personal: nada apunta
   * a ella y la traza conserva la constancia. EXIGE EL CONDUCTOR de la ruta: sin comprobar que
   * el período es suyo, un identificador equivocado borraría la ausencia de otro.
   */
  async retirar(
    conductorId: number,
    id: number,
    usuarioId: number,
    hoy: string = fechaIsoEnZona(),
  ): Promise<void> {
    await this.exigirConductor(conductorId);
    const ausencia = await this.repositorio.buscar(id);

    if (!ausencia || ausencia.conductorId !== conductorId) {
      throw new RecursoNoEncontradoError(
        `El conductor ${conductorId} no tiene registrada una ausencia con identificador ${id}.`,
        { conductorId, id },
      );
    }

    // B7 de P-07: una ausencia que ya terminó explica por qué el conductor no salió esos días.
    if (
      estadoDeAusencia(
        comoFechaIso(ausencia.desde),
        comoFechaIso(ausencia.hasta),
        hoy,
      ) === 'PASADA'
    ) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.AUSENCIA_PASADA,
        `La ausencia del ${comoFechaIso(ausencia.desde)} al ${comoFechaIso(ausencia.hasta)} ya terminó y forma parte del historial: no se puede quitar.`,
        { ausenciaId: ausencia.id },
      );
    }

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      await this.repositorio.eliminar(id, cliente);

      await this.auditoria.registrar(
        {
          entidad: 't_disponibilidad',
          entidadId: id,
          accion: AccionAuditoria.ELIMINAR,
          cambios: [
            {
              campo: 'disp_estado',
              valorAnterior: resumen(
                ausencia.estado,
                conductorId,
                ausencia.desde,
                ausencia.hasta,
              ),
            },
          ],
          usuario: usuarioId,
        },
        cliente,
      );
    });
  }

  // ─────────────────────────── Reglas ───────────────────────────

  private async exigirConductor(id: number) {
    const conductor = await this.repositorio.existeConductor(id);

    if (!conductor) {
      throw new RecursoNoEncontradoError('El conductor indicado no existe.', {
        conductorId: id,
      });
    }

    return conductor;
  }

  /** INV-14 aplicado al conductor. 409 con su código, como en el personal. */
  private async exigirSinSolape(
    conductorId: number,
    datos: DatosAusenciaConductor,
  ): Promise<void> {
    const existentes = await this.repositorio.solapadas(
      conductorId,
      datos.desde,
      datos.hasta,
    );

    const choque = existentes.find((periodo) =>
      seSolapan(
        { desde: periodo.desde, hasta: periodo.hasta },
        { desde: datos.desde, hasta: datos.hasta },
      ),
    );

    if (choque) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.AUSENCIA_SOLAPADA,
        `El conductor ya tiene registrada una ausencia del ${comoFechaIso(choque.desde)} al ${comoFechaIso(choque.hasta)}, que se cruza con la que intenta registrar. Retire la anterior o ajuste las fechas.`,
        {
          periodoExistenteId: choque.id,
          desde: comoFechaIso(choque.desde),
          hasta: comoFechaIso(choque.hasta),
        },
      );
    }
  }
}

/** RN-30: solo las situaciones que excluyen. El DTO ya lo exige; aquí es la segunda barrera. */
function exigirSituacionDeAusencia(estado: EstadoDisponibilidad): void {
  if (!ESTADOS_QUE_EXCLUYEN.includes(estado)) {
    throw new ValidacionError(
      `${estado} no es una ausencia de conductor. Las situaciones son: ${ESTADOS_QUE_EXCLUYEN.join(', ')}.`,
      { estado },
    );
  }
}

/** Lo respalda `ck_disponibilidad_rango`; aquí se dice en palabras. */
function exigirRango(desde: Date, hasta: Date): void {
  if (hasta < desde) {
    throw new ValidacionError(
      `La ausencia no puede terminar antes de empezar: del ${comoFechaIso(desde)} al ${comoFechaIso(hasta)}.`,
      { desde: comoFechaIso(desde), hasta: comoFechaIso(hasta) },
    );
  }
}

/** Resumen para la traza. **Sin el motivo**, a propósito. */
function resumen(
  estado: EstadoDisponibilidad,
  conductorId: number,
  desde: Date,
  hasta: Date,
): string {
  return `${estado} · conductor ${conductorId} · ${comoFechaIso(desde)} a ${comoFechaIso(hasta)}`;
}
