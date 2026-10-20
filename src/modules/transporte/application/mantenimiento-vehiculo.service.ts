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
 *
 * FASE 5 (2026-10-06). La cita con HORA genera una TAREA «Llevar a taller» (tramo sin operativo,
 * con el vehículo y la zonal del taller como destino) que se asigna a un conductor como un bloque
 * más, en la línea de tiempo o con el optimizador. La cita tiene estado PROGRAMADO → EN_TALLER →
 * LISTO; LISTO devuelve el vehículo a circulación. Al retirar la cita, su tarea se va con ella
 * (`fk_tramo_mantenimiento` en cascada).
 *
 * AVISO ANTES DE PROGRAMAR (2026-10-20, D4): `impacto` lista los traslados ya asignados a esa placa
 * en el rango. La parada NO los retira —mismo criterio que la ausencia de un conductor—: la pantalla
 * avisa y se reasignan en «Planificar el día».
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  type Disponibilidad,
  type EstadoMantenimiento,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import { FlotaRepository } from '../infrastructure/flota.repository';
import { ParametrosTransporteService } from './parametros-transporte.service';
import { aHora, aMinutos } from './politicas/linea-de-tiempo';
import { puedeTransitar } from './politicas/estado-mantenimiento';
import {
  componerSemana,
  type SemanaDeVehiculo,
} from './politicas/semana-mantenimiento';

/** Un traslado ya asignado a la placa dentro del rango de una parada (D4). */
export interface TramoAfectadoPorParada {
  operativoId: number;
  identificador: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
}

export interface DatosMantenimiento {
  desde: Date;
  hasta: Date;
  taller?: string | null;
  hora?: string | null;
  motivo?: string | null;
  /** Zonal del taller: destino de la TAREA «Llevar a taller». */
  zonalTallerId?: number | null;
}

@Injectable()
export class MantenimientoVehiculoService {
  constructor(
    private readonly flota: FlotaRepository,
    private readonly auditoria: AuditoriaService,
    private readonly logger: LoggerService,
    private readonly parametros: ParametrosTransporteService,
  ) {}

  /**
   * Vista semanal de vehículos parados (2026-10-06): los vehículos activos × 7 días desde
   * `desde`, con el estado de su cita de taller. Ver `politicas/semana-mantenimiento.ts`.
   */
  async semana(desde: Date): Promise<SemanaDeVehiculo[]> {
    const hasta = new Date(desde.getTime() + 6 * 24 * 60 * 60 * 1000);
    const [vehiculos, citas] = await Promise.all([
      this.flota.listarVehiculos(true),
      this.flota.mantenimientosEnRango(desde, hasta),
    ]);
    return componerSemana(desde, vehiculos, citas);
  }

  /**
   * D4: los traslados de operativos activos que la placa ya tiene entre `desde` y `hasta`. Una
   * consulta. La pantalla los muestra antes de guardar; la parada no los retira.
   */
  async impacto(
    vehiculoId: number,
    desde: Date,
    hasta: Date,
  ): Promise<TramoAfectadoPorParada[]> {
    await this.exigirVehiculo(vehiculoId);
    if (hasta < desde) {
      throw new ValidacionError(
        'La fecha de fin del mantenimiento no puede ser anterior a la de inicio.',
        { desde: comoFecha(desde), hasta: comoFecha(hasta) },
      );
    }
    const tramos = await this.flota.tramosDeVehiculoEnRango(
      vehiculoId,
      desde,
      hasta,
    );
    return tramos.map((t) => ({ ...t, fecha: comoFecha(t.fecha) }));
  }

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

    // La TAREA solo nace si hay hora de cita: sin hora no hay franja que ocupar en la jornada.
    const duracion = datos.hora
      ? (await this.parametros.leerOptimizacion()).duracionTareaTallerMin
      : 0;

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
            zonalTallerId: datos.zonalTallerId ?? null,
            registradoPor: usuarioId,
          },
          cliente,
        );

        if (datos.hora) {
          const inicio = aMinutos(datos.hora);
          const fin = inicio + duracion;
          await this.flota.crearTareaTaller(
            {
              mantenimientoId: fila.id,
              vehiculoId,
              fecha: datos.desde,
              horaInicio: datos.hora,
              horaFin: aHora(fin),
              cruzaMedianoche: fin >= 1440,
              zonalDestinoId: datos.zonalTallerId ?? null,
              descripcion: `Llevar a taller${datos.taller ? `: ${datos.taller}` : ''} (${vehiculo.placa})`,
              creadoPor: usuarioId,
            },
            cliente,
          );
        }

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
   * Cambia el estado de la cita: PROGRAMADO → EN_TALLER → LISTO (ver `estado-mantenimiento.ts`).
   * LISTO devuelve el vehículo a circulación: deja de contar como «en taller» ese día.
   */
  async cambiarEstado(
    id: number,
    estado: EstadoMantenimiento,
    usuarioId: number,
  ): Promise<Disponibilidad> {
    const mantenimiento = await this.flota.buscarMantenimiento(id);

    if (!mantenimiento) {
      throw new RecursoNoEncontradoError(
        'El mantenimiento indicado no existe.',
        { mantenimientoId: id },
      );
    }

    const actual = mantenimiento.estadoMantenimiento ?? 'PROGRAMADO';
    if (actual === estado) return mantenimiento;
    if (!puedeTransitar(actual, estado)) {
      throw new ValidacionError(
        `Una cita ${NOMBRE_ESTADO[actual]} no puede pasar a ${NOMBRE_ESTADO[estado]}.`,
        { mantenimientoId: id, desde: actual, hacia: estado },
      );
    }

    return this.flota.ejecutarEnTransaccion(async (cliente) => {
      const fila = await this.flota.actualizarEstadoMantenimiento(
        id,
        estado,
        cliente,
      );
      await this.auditoria.registrar(
        {
          entidad: 't_disponibilidad',
          entidadId: id,
          accion: AccionAuditoria.ACTUALIZAR,
          cambios: [
            {
              campo: 'disp_estado_mantenimiento',
              valorAnterior: actual,
              valorNuevo: estado,
            },
          ],
          usuario: usuarioId,
        },
        cliente,
      );
      return fila;
    });
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

const NOMBRE_ESTADO: Record<EstadoMantenimiento, string> = {
  PROGRAMADO: 'programada',
  EN_TALLER: 'en taller',
  LISTO: 'lista',
};

/** `@db.Date` se interpreta en UTC, igual que en el resto del módulo. */
function comoFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
