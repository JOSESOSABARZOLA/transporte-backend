/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Mantenimiento de vehículos
 * Archivo: mantenimiento-vehiculo.service.ts
 * Responsabilidad: Registrar y retirar las paradas de taller de un vehículo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-31
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * RN-DAF-05. UN VEHÍCULO EN TALLER NO SE ASIGNA, Y HASTA HOY NADIE PODÍA DECIRLO.
 *
 * `MANTENIMIENTO` está en `e_estado_disponibilidad` desde el esquema inicial y
 * `exigirVehiculoUtilizable` lo respeta desde M-17: la placa parada se rechaza al asignar.
 * Lo que no existía era la forma de REGISTRARLO. No había endpoint ni pantalla, así que
 * parar un vehículo era un `INSERT` a mano en la base, y en la práctica no se hacía: el
 * aviso llegaba por mensaje y vivía en la cabeza de la planificadora.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * VIVE EN `transporte` Y NO EN `talento-operativo`, aunque escriba en la misma tabla que
 * las ausencias del personal. La regla 1 de CLAUDE.md reserva aquel submódulo para las
 * reglas que protegen a las PERSONAS; aquí no se protege a nadie, se declara que un activo
 * está fuera de servicio. Y el activo es de este submódulo: `t_vehiculo` la administra
 * `FlotaService`, que está al lado.
 *
 * NO SE COMPARTE `DisponibilidadService`, que es el vecino más parecido. Aquél exige
 * funcionario, aplica RN-30 y oculta el motivo por ser un dato de salud (`disp_motivo`
 * puede decir «cirugía programada»). Ninguna de las tres cosas vale para una camioneta, y
 * el motivo de un taller —«cambio de frenos»— **sí se muestra**: es lo que le permite a la
 * DAF calcular cuándo vuelve.
 */

import { Injectable } from '@nestjs/common';
import { AccionAuditoria, type Disponibilidad } from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import { FlotaRepository } from '../infrastructure/flota.repository';

export interface DatosMantenimiento {
  desde: Date;
  hasta: Date;
  taller?: string | null;
  hora?: string | null;
  motivo?: string | null;
}

@Injectable()
export class MantenimientoVehiculoService {
  constructor(
    private readonly flota: FlotaRepository,
    private readonly auditoria: AuditoriaService,
    private readonly logger: LoggerService,
  ) {}

  /** Las paradas registradas de un vehículo, de la más reciente hacia atrás. */
  async listarDe(vehiculoId: number): Promise<Disponibilidad[]> {
    await this.exigirVehiculo(vehiculoId);
    return this.flota.listarMantenimientos(vehiculoId);
  }

  /**
   * Registra una parada de taller.
   *
   * ORDEN DE LAS COMPROBACIONES, cada una con su motivo:
   *
   *   1. El vehículo existe. Un identificador equivocado es un 404, no una regla rota.
   *   2. El rango tiene sentido. `ck_disponibilidad_rango` lo respalda en la base; aquí se
   *      comprueba antes para devolver un mensaje que el funcionario entienda en lugar de
   *      un error del motor.
   *   3. No se cruza con otra parada del mismo vehículo. Es INV-14 aplicado al activo: dos
   *      registros solapados dejarían «¿hasta cuándo está parado?» decidido por el orden
   *      en que se consulten, que es la peor forma de decidirlo.
   */
  async registrar(
    vehiculoId: number,
    datos: DatosMantenimiento,
    usuarioId: number,
  ): Promise<Disponibilidad> {
    const vehiculo = await this.exigirVehiculo(vehiculoId);

    if (datos.hasta < datos.desde) {
      throw new ValidacionError(
        'La fecha de fin del mantenimiento no puede ser anterior a la de inicio.',
        { desde: comoFecha(datos.desde), hasta: comoFecha(datos.hasta) },
      );
    }

    const cruces = await this.flota.mantenimientosQueSolapan(
      vehiculoId,
      datos.desde,
      datos.hasta,
    );

    if (cruces.length > 0) {
      const cruce = cruces[0];
      throw new ReglaNegocioError(
        CODIGOS_ERROR.VEHICULO_OCUPADO,
        `El vehículo de placa ${vehiculo.placa} ya tiene un mantenimiento registrado del ${comoFecha(cruce.desde)} al ${comoFecha(cruce.hasta)}, que se cruza con estas fechas.`,
        { vehiculoId, mantenimientoId: cruce.id },
      );
    }

    const registrado = await this.flota.ejecutarEnTransaccion(
      async (cliente) => {
        const fila = await this.flota.crearMantenimiento(
          {
            vehiculoId,
            desde: datos.desde,
            hasta: datos.hasta,
            taller: datos.taller ?? null,
            hora: datos.hora ?? null,
            motivo: datos.motivo ?? null,
            registradoPor: usuarioId,
          },
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_disponibilidad',
            entidadId: fila.id,
            accion: AccionAuditoria.CREAR,
            usuario: usuarioId,
          },
          cliente,
        );

        return fila;
      },
    );

    this.logger.log('Mantenimiento de vehículo registrado', {
      placa: vehiculo.placa,
      desde: comoFecha(datos.desde),
      hasta: comoFecha(datos.hasta),
    });

    return registrado;
  }

  /**
   * Retira una parada.
   *
   * SE BORRA LA FILA, no se marca de baja. `t_disponibilidad` no tiene columna de estado
   * lógico y añadírsela por esto cambiaría el comportamiento de las ausencias del personal,
   * que comparten la tabla. Lo que queda es la traza: la auditoría sobrevive al registro
   * borrado —es la única relación con `SET NULL`— y ahí consta quién lo retiró.
   */
  async retirar(id: number, usuarioId: number): Promise<void> {
    const mantenimiento = await this.flota.buscarMantenimiento(id);

    if (!mantenimiento) {
      throw new RecursoNoEncontradoError(
        'El mantenimiento indicado no existe.',
        { mantenimientoId: id },
      );
    }

    await this.flota.ejecutarEnTransaccion(async (cliente) => {
      await this.flota.eliminarMantenimiento(id, cliente);

      await this.auditoria.registrar(
        {
          entidad: 't_disponibilidad',
          entidadId: id,
          accion: AccionAuditoria.ELIMINAR,
          usuario: usuarioId,
        },
        cliente,
      );
    });

    this.logger.log('Mantenimiento de vehículo retirado', {
      mantenimientoId: id,
    });
  }

  private async exigirVehiculo(id: number) {
    const vehiculo = await this.flota.buscarVehiculo(id);

    if (!vehiculo) {
      throw new RecursoNoEncontradoError('El vehículo indicado no existe.', {
        vehiculoId: id,
      });
    }

    return vehiculo;
  }
}

/** `@db.Date` se interpreta en UTC, igual que en el resto del módulo. */
function comoFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
