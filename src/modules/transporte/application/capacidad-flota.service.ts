/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Capacidad de flota
 * Archivo: capacidad-flota.service.ts
 * Responsabilidad: Declarar la capacidad del día y compararla con la demanda.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * RF-057 y RN-46. La DAF declara cuántos vehículos y conductores tiene hábiles ese día,
 * y el sistema compara esa cifra con lo que la jornada necesita.
 *
 * ADVIERTE, NO BLOQUEA. La decisión está en `politicas/capacidad-flota.ts` y es
 * estructural: la política **no puede lanzar**, así que no hay forma de que un número
 * provisional impida una asignación. Nadie sabe todavía cuántos conductores hábiles
 * existen (PV-03), y bloquear con ese dato devolvería el cuadro a WhatsApp.
 *
 * LA CONSULTA FUNCIONA SIN DECLARACIÓN. Mientras la DAF no declare nada, el endpoint
 * responde con la demanda y `declarada: null`: la pantalla puede mostrar «faltan por
 * declarar» en lugar de un error, que es lo que hoy ocurre todos los días.
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  type CapacidadFlota,
  type RolDepartamental,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import { OperativosService } from '../../operativos/application/operativos.service';
import { CapacidadFlotaRepository } from '../infrastructure/capacidad-flota.repository';
import { PlanificacionTransporteRepository } from '../infrastructure/planificacion-transporte.repository';
import {
  calcularCapacidad,
  type CapacidadCalculada,
} from './politicas/capacidad-calculada';
import {
  verificarCapacidad,
  type VeredictoCapacidad,
} from './politicas/capacidad-flota';

/** Lo que la DAF declara para una fecha. */
export interface DatosDeclaracion {
  vehiculosHabiles: number;
  conductoresHabiles: number;
  observacion?: string;
}

/** Estado de la flota para un día, con o sin declaración. */
export interface EstadoCapacidad {
  fecha: Date;
  /** `null` mientras la DAF no haya declarado nada para esa fecha. */
  declarada: CapacidadFlota | null;
  vehiculosRequeridos: number;
  /** `null` sin declaración: no hay contra qué comparar. */
  veredicto: VeredictoCapacidad | null;
}

@Injectable()
export class CapacidadFlotaService {
  constructor(
    private readonly repositorio: CapacidadFlotaRepository,
    private readonly cuadros: CuadroDiarioService,
    private readonly operativos: OperativosService,
    private readonly auditoria: AuditoriaService,
    private readonly logger: LoggerService,
    private readonly planificacion: PlanificacionTransporteRepository,
  ) {}

  /**
   * La capacidad CALCULADA del día (2026-10-06): conductores con turno trabajable − ausentes +
   * libres activados; vehículos activos − en taller. Ver `politicas/capacidad-calculada.ts`.
   * Devuelve también lo declarado, para que la DAF la confirme o la corrija.
   */
  async calcular(
    fecha: Date,
  ): Promise<CapacidadCalculada & { declarada: CapacidadFlota | null }> {
    const [
      conductores,
      turnos,
      ausentes,
      activaciones,
      vehiculos,
      enTaller,
      declarada,
    ] = await Promise.all([
      this.planificacion.conductoresActivos(),
      // Solo un mes PUBLICADO cuenta (2026-10-07).
      this.planificacion.turnosPublicadosEnRango(fecha, fecha),
      this.planificacion.conductoresAusentes(fecha),
      this.planificacion.activacionesDe(fecha),
      this.planificacion.vehiculosActivos(),
      this.planificacion.vehiculosEnTaller(fecha),
      this.repositorio.buscarPorFecha(fecha),
    ]);

    const calculo = calcularCapacidad({
      conductoresActivos: conductores.map((c) => c.id),
      turnos: new Map(turnos.map((t) => [t.conductorId, String(t.turno)])),
      ausentes,
      activados: new Set(activaciones.map((a) => a.conductorId)),
      vehiculosActivos: vehiculos.map((v) => v.id),
      enTaller,
    });

    return { ...calculo, declarada };
  }

  /**
   * POL-07. Compara lo declarado con lo que la jornada necesita.
   *
   * No exige que el cuadro exista: consultar la capacidad de un día sin jornada abierta
   * devuelve cero demanda, que es la respuesta correcta y no un error.
   */
  async verificarDemanda(fecha: Date): Promise<EstadoCapacidad> {
    const [declarada, vehiculosRequeridos] = await Promise.all([
      this.repositorio.buscarPorFecha(fecha),
      this.operativos.contarDemandaDeTransporte(fecha),
    ]);

    return {
      fecha,
      declarada,
      vehiculosRequeridos,
      veredicto: declarada
        ? verificarCapacidad(declarada, {
            vehiculosRequeridos,
            // Un operativo con vehículo lleva un conductor: la demanda es la misma
            // cifra. No hay en el modelo nada que permita distinguirlas.
            conductoresRequeridos: vehiculosRequeridos,
          })
        : null,
    };
  }

  /**
   * RF-057. Declara la capacidad del día.
   *
   * Exige que **el cuadro exista**: `capa_cuad_id` es obligatoria en el modelo, y
   * declarar capacidad para un día que nadie abrió no describe nada. El 404 se responde
   * con una frase, en lugar de dejar que salte la clave foránea.
   */
  async declarar(
    fecha: Date,
    datos: DatosDeclaracion,
    autor: { usuarioId: number; rol: RolDepartamental },
  ): Promise<EstadoCapacidad> {
    const cuadro = await this.cuadros.obtenerPorFecha(fecha);
    const anterior = await this.repositorio.buscarPorFecha(fecha);

    // CONFIRMAR o CORREGIR (2026-10-06): si lo declarado difiere de lo calculado, es una
    // corrección y debe decir por qué. Coincidir es confirmar: la observación es opcional.
    const { calculada } = await this.calcular(fecha);
    const corrige =
      datos.conductoresHabiles !== calculada.conductoresHabiles ||
      datos.vehiculosHabiles !== calculada.vehiculosHabiles;
    if (corrige && (datos.observacion?.trim().length ?? 0) < 5) {
      throw new ValidacionError(
        `Para corregir la capacidad calculada escriba una observación que explique la diferencia (calculado: ${calculada.conductoresHabiles} conductores y ${calculada.vehiculosHabiles} vehículos).`,
        { calculada },
      );
    }

    const declarada = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const guardada = await this.repositorio.declarar(
          {
            cuadroId: cuadro.id,
            fecha,
            vehiculosHabiles: datos.vehiculosHabiles,
            conductoresHabiles: datos.conductoresHabiles,
            observacion: datos.observacion?.trim() || null,
            declaradoPor: autor.usuarioId,
          },
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_capacidad_flota',
            entidadId: guardada.id,
            accion: anterior
              ? AccionAuditoria.ACTUALIZAR
              : AccionAuditoria.CREAR,
            cambios: anterior
              ? this.auditoria.compararCambios(
                  comoColumnas(anterior),
                  comoColumnas(guardada),
                )
              : undefined,
            usuario: autor.usuarioId,
            rol: autor.rol,
          },
          cliente,
        );

        return guardada;
      },
    );

    const estado = await this.verificarDemanda(fecha);

    // Evento `CapacidadFlotaExcedida`, después de confirmar. Se emite **solo cuando la
    // demanda supera lo declarado**: es el aviso, y el único efecto que RN-46 admite.
    if (estado.veredicto?.hayAdvertencia) {
      this.logger.warn('Capacidad de flota excedida', {
        fecha: comoFecha(fecha),
        vehiculosHabiles: declarada.vehiculosHabiles,
        vehiculosRequeridos: estado.vehiculosRequeridos,
      });
    } else {
      this.logger.log('Capacidad de flota declarada', {
        fecha: comoFecha(fecha),
        vehiculosHabiles: declarada.vehiculosHabiles,
        conductoresHabiles: declarada.conductoresHabiles,
      });
    }

    return estado;
  }
}

/** La traza nombra columnas, no propiedades del modelo. */
function comoColumnas(capacidad: CapacidadFlota): Record<string, unknown> {
  return {
    capa_vehiculos_habiles: capacidad.vehiculosHabiles,
    capa_conductores_habiles: capacidad.conductoresHabiles,
    capa_observacion: capacidad.observacion,
  };
}

function comoFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
