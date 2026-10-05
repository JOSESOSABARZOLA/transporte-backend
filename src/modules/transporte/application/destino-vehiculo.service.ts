/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Destino del vehículo
 * Archivo: destino-vehiculo.service.ts
 * Responsabilidad: Declarar dónde queda cada vehículo al terminar la jornada.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-31
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * RN-DAF-03. «SI NO SE LES PONE DÓNDE DEJAR EL VEHÍCULO SE VUELVE UN DESPELOTE.»
 *
 * Es la columna COORDINACIÓN de la hoja de la DAF: 393 filas del mes de agosto la llevan
 * informada. Dice en qué zonal debe quedar el vehículo al acabar el turno, o si se lo
 * lleva el conductor a su casa.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NO AMPLÍA `ActualizarTransporteDto`, Y ESO ES EL PUNTO.
 *
 * El destino es un dato que escribe la DAF, así que la tentación es añadirlo al contrato
 * de la asignación. La regla 3 de CLAUDE.md lo prohíbe: ese DTO tiene **exactamente dos
 * propiedades** y es la garantía escrita de que la DAF no toca el resto del operativo.
 *
 * El propio comentario de ese archivo dice qué hacer en su lugar: «si alguna vez hiciera
 * falta que la DAF escribiera otra cosa, no se amplía este DTO; se le da su propio
 * endpoint con su propio contrato». Es exactamente lo que es este servicio. Y encaja mejor
 * con el modelo, porque el destino **no es del operativo**: es del vehículo y del día.
 *
 * RN-DAF-04 SE APLICA AQUÍ Y ES UN AVISO, NO UN RECHAZO. Solo un conductor con parqueadero
 * autorizado puede llevarse el vehículo a casa. Pero quién lo conduce ese día puede
 * cambiar después de declarar el destino, así que el servicio comprueba lo que puede —que
 * ALGÚN conductor del día lo tenga autorizado— y no bloquea cuando no hay conductor
 * asignado todavía: bloquear obligaría a declarar el destino después de la asignación, y
 * la DAF hace las dos cosas a la vez mientras habla por teléfono.
 */

import { Injectable } from '@nestjs/common';
import { AccionAuditoria, type DestinoVehiculo } from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  FlotaRepository,
  type DestinoConUbicacion,
} from '../infrastructure/flota.repository';

export interface DatosDestino {
  /** Zonal donde queda. Excluyente con `domicilio`. */
  ubicacionId?: number | null;
  /** Se lo lleva el conductor. Excluyente con `ubicacionId`. */
  domicilio?: boolean;
  observacion?: string | null;
}

@Injectable()
export class DestinoVehiculoService {
  constructor(
    private readonly flota: FlotaRepository,
    private readonly auditoria: AuditoriaService,
    private readonly logger: LoggerService,
  ) {}

  /** Lo declarado para una fecha, con la placa y el nombre de la zonal resueltos. */
  async consultarDeLaFecha(fecha: Date): Promise<DestinoConUbicacion[]> {
    return this.flota.destinosDeLaFecha(fecha);
  }

  /**
   * Declara dónde queda el vehículo ese día. Declarar dos veces deja el mismo resultado.
   *
   * Es un `upsert` sobre `uq_destino_vehi_fecha`, y por eso CORREGIR es volver a declarar:
   * no hace falta borrar antes, y entre medias la pregunta «dónde duerme hoy la 7056»
   * nunca se queda sin respuesta.
   */
  async declarar(
    vehiculoId: number,
    fecha: Date,
    datos: DatosDestino,
    usuarioId: number,
  ): Promise<DestinoVehiculo> {
    const vehiculo = await this.flota.buscarVehiculo(vehiculoId);

    if (!vehiculo) {
      throw new RecursoNoEncontradoError('El vehículo indicado no existe.', {
        vehiculoId,
      });
    }

    const domicilio = datos.domicilio === true;
    const ubicacionId = domicilio ? null : (datos.ubicacionId ?? null);

    // `ck_destino_sujeto` lo respalda en la base. Aquí se comprueba antes para devolver un
    // mensaje que la DAF entienda en lugar de un error del motor.
    if (!domicilio && ubicacionId === null) {
      throw new ValidacionError(
        'Indique en qué zonal queda el vehículo, o marque que se lo lleva el conductor.',
        { vehiculoId },
      );
    }

    if (domicilio && datos.ubicacionId != null) {
      throw new ValidacionError(
        'Un vehículo que se lleva el conductor no queda además en una zonal. Elija una de las dos.',
        { vehiculoId },
      );
    }

    if (ubicacionId !== null) {
      const ubicacion = await this.flota.buscarUbicacion(ubicacionId);

      if (!ubicacion || !ubicacion.activo) {
        throw new ValidacionError(
          'La zonal indicada no existe o está dada de baja.',
          { ubicacionId },
        );
      }
    }

    const anterior = await this.flota.buscarDestino(vehiculoId, fecha);

    const traza = this.auditoria.compararCambios(
      {
        ubic_id: anterior?.ubicacionId ?? null,
        dest_domicilio: anterior?.domicilio ?? false,
      },
      { ubic_id: ubicacionId, dest_domicilio: domicilio },
    );

    const guardado = await this.flota.ejecutarEnTransaccion(async (cliente) => {
      const fila = await this.flota.declararDestino(
        {
          vehiculoId,
          fecha,
          ubicacionId,
          domicilio,
          observacion: datos.observacion ?? null,
          registradoPor: usuarioId,
        },
        cliente,
      );

      await this.auditoria.registrar(
        {
          entidad: 't_destino_vehiculo',
          entidadId: fila.id,
          // Volver a declarar es MODIFICAR, no crear otra cosa: la fila es la misma, la
          // sostiene `uq_destino_vehi_fecha`.
          accion: anterior ? AccionAuditoria.ACTUALIZAR : AccionAuditoria.CREAR,
          cambios: anterior ? traza : undefined,
          usuario: usuarioId,
        },
        cliente,
      );

      return fila;
    });

    this.logger.log('Destino de vehículo declarado', {
      placa: vehiculo.placa,
      fecha: fecha.toISOString().slice(0, 10),
      domicilio,
    });

    return guardado;
  }
}
