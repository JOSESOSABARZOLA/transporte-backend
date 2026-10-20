/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · operación diaria de la flota (Fase 5)
 * Archivo: operacion-flota.service.ts
 * Responsabilidad: Registrar el checklist diario (Art. 9), el kilometraje y los vales de combustible.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * TRES REGISTROS DE LA OPERACIÓN DIARIA, cada uno con su auditoría dentro de la transacción (regla 5).
 *
 * - CHECKLIST: uno por (vehículo, conductor, día); repetirlo lo corrige. Los ítems son pares
 *   «rubro → conforme»; si trae kilometraje de salida, cuenta también como lectura del día.
 * - KILOMETRAJE: uno por (vehículo, día). No puede ser menor que una lectura de un día anterior, y
 *   sube el kilometraje de la ficha del vehículo solo si es mayor (nunca lo hace retroceder).
 * - VALES: se acumulan; el monto solo puede ser 10 o 20 (`montoValeValido`, y `ck_vale_monto` en la base).
 */

import { Injectable } from '@nestjs/common';
import { AccionAuditoria } from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { OperacionFlotaRepository } from '../infrastructure/operacion-flota.repository';
import { MONTOS_VALE, montoValeValido } from './politicas/estado-mantenimiento';

export interface DatosChecklist {
  vehiculoId: number;
  conductorId: number;
  fecha: Date;
  items: Record<string, boolean>;
  observacion?: string | null;
  kilometrajeSalida?: number | null;
}

export interface DatosKilometraje {
  vehiculoId: number;
  conductorId?: number | null;
  fecha: Date;
  kilometraje: number;
}

export interface DatosVale {
  conductorId: number;
  vehiculoId: number;
  fecha: Date;
  monto: number;
  numero?: string | null;
}

@Injectable()
export class OperacionFlotaService {
  constructor(
    private readonly repositorio: OperacionFlotaRepository,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─────────── Checklist ───────────

  async registrarChecklist(datos: DatosChecklist, usuarioId: number) {
    const vehiculo = await this.exigirVehiculo(datos.vehiculoId);
    await this.exigirConductor(datos.conductorId);
    const rubros = Object.entries(datos.items);
    if (rubros.length === 0) {
      throw new ValidacionError(
        'El checklist debe traer al menos un rubro revisado.',
      );
    }
    if (
      rubros.length > 40 ||
      rubros.some(
        ([rubro, conforme]) =>
          rubro.length > 60 || typeof conforme !== 'boolean',
      )
    ) {
      throw new ValidacionError(
        'Cada rubro del checklist se marca como conforme (sí o no); como máximo 40 rubros de 60 caracteres.',
      );
    }
    const km = datos.kilometrajeSalida ?? null;
    if (km !== null)
      await this.exigirNoRetrocede(
        vehiculo.id,
        vehiculo.placa,
        datos.fecha,
        km,
      );

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const fila = await this.repositorio.guardarChecklist(
        {
          vehiculoId: datos.vehiculoId,
          conductorId: datos.conductorId,
          fecha: datos.fecha,
          items: datos.items,
          observacion: datos.observacion?.trim() || null,
          kilometrajeSalida: km,
          registradoPor: usuarioId,
        },
        cliente,
      );
      if (km !== null) {
        await this.repositorio.guardarKilometraje(
          {
            vehiculoId: datos.vehiculoId,
            conductorId: datos.conductorId,
            fecha: datos.fecha,
            kilometraje: km,
            registradoPor: usuarioId,
          },
          cliente,
        );
        await this.repositorio.subirKilometrajeFicha(
          datos.vehiculoId,
          km,
          cliente,
        );
      }
      await this.auditoria.registrar(
        {
          entidad: 't_checklist_vehiculo',
          entidadId: fila.id,
          accion: AccionAuditoria.CREAR,
          usuario: usuarioId,
        },
        cliente,
      );
      return fila;
    });
  }

  async checklistsDe(fecha: Date) {
    return this.repositorio.checklistsDe(fecha);
  }

  // ─────────── Kilometraje ───────────

  async registrarKilometraje(datos: DatosKilometraje, usuarioId: number) {
    const vehiculo = await this.exigirVehiculo(datos.vehiculoId);
    if (datos.conductorId) await this.exigirConductor(datos.conductorId);
    await this.exigirNoRetrocede(
      vehiculo.id,
      vehiculo.placa,
      datos.fecha,
      datos.kilometraje,
    );

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const fila = await this.repositorio.guardarKilometraje(
        {
          vehiculoId: datos.vehiculoId,
          conductorId: datos.conductorId ?? null,
          fecha: datos.fecha,
          kilometraje: datos.kilometraje,
          registradoPor: usuarioId,
        },
        cliente,
      );
      await this.repositorio.subirKilometrajeFicha(
        datos.vehiculoId,
        datos.kilometraje,
        cliente,
      );
      await this.auditoria.registrar(
        {
          entidad: 't_kilometraje_vehiculo',
          entidadId: fila.id,
          accion: AccionAuditoria.CREAR,
          cambios: [
            { campo: 'kive_km', valorNuevo: String(datos.kilometraje) },
          ],
          usuario: usuarioId,
        },
        cliente,
      );
      return fila;
    });
  }

  async historialKilometraje(vehiculoId: number) {
    await this.exigirVehiculo(vehiculoId);
    return this.repositorio.historialKilometraje(vehiculoId, 60);
  }

  // ─────────── Vales ───────────

  async registrarVale(datos: DatosVale, usuarioId: number) {
    if (!montoValeValido(datos.monto)) {
      throw new ValidacionError(
        `El vale de combustible solo puede ser de ${MONTOS_VALE.map((m) => `$${m}`).join(' o ')}.`,
        { monto: datos.monto },
      );
    }
    await this.exigirVehiculo(datos.vehiculoId);
    await this.exigirConductor(datos.conductorId);

    return this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      const fila = await this.repositorio.crearVale(
        {
          conductorId: datos.conductorId,
          vehiculoId: datos.vehiculoId,
          fecha: datos.fecha,
          monto: datos.monto,
          numero: datos.numero?.trim() || null,
          registradoPor: usuarioId,
        },
        cliente,
      );
      await this.auditoria.registrar(
        {
          entidad: 't_vale_combustible',
          entidadId: fila.id,
          accion: AccionAuditoria.CREAR,
          cambios: [{ campo: 'vaco_monto', valorNuevo: String(datos.monto) }],
          usuario: usuarioId,
        },
        cliente,
      );
      return fila;
    });
  }

  async valesDe(fecha: Date) {
    return this.repositorio.valesDe(fecha);
  }

  // ─────────── Apoyo ───────────

  private async exigirVehiculo(id: number) {
    const vehiculo = await this.repositorio.existeVehiculo(id);
    if (!vehiculo)
      throw new RecursoNoEncontradoError('El vehículo indicado no existe.', {
        vehiculoId: id,
      });
    return vehiculo;
  }

  private async exigirConductor(id: number): Promise<void> {
    if (!(await this.repositorio.existeConductor(id))) {
      throw new RecursoNoEncontradoError('El conductor indicado no existe.', {
        conductorId: id,
      });
    }
  }

  /** Un odómetro no retrocede: la lectura no puede ser menor que la de un día anterior. */
  private async exigirNoRetrocede(
    vehiculoId: number,
    placa: string,
    fecha: Date,
    km: number,
  ): Promise<void> {
    const anterior = await this.repositorio.lecturaAnterior(vehiculoId, fecha);
    if (anterior && km < anterior.kilometraje) {
      throw new ValidacionError(
        `El kilometraje de ${placa} no puede ser menor que el registrado el ${anterior.fecha.toISOString().slice(0, 10)} (${anterior.kilometraje} km).`,
        { vehiculoId, kilometraje: km, anterior: anterior.kilometraje },
      );
    }
  }
}
