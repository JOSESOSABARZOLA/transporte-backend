/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Administración · carga inicial
 * Archivo: carga-inicial.service.ts
 * Responsabilidad: Previsualizar y aplicar la carga inicial desde Excel (conductores, vehículos, garajes y turnos).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * Opción OCULTA del administrador general (`carga-inicial:administrar`). La vista previa NO escribe.
 * `aplicar` vuelve a validar cada fila con la misma función pura (`politicas/carga-inicial.ts`) y
 * escribe POR LOS SERVICIOS DE SIEMPRE —`FlotaService` y el lote de turnos—, así cada alta o cambio
 * pasa por sus reglas y queda en la auditoría. Upsert: conductor por cédula, vehículo por placa,
 * garaje por nombre (sin tildes ni mayúsculas); los turnos, por el lote del mes. Una fila que falla
 * no detiene las demás: vuelve en `omitidos` con su motivo.
 */

import { Injectable } from '@nestjs/common';
import type {
  SectorCiudad,
  TipoContrato,
  TurnoConductor,
} from '@prisma/client';

import { ApplicationError } from '../../../common/errors/application.error';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { normalizarParaComparar } from '../../../common/utilidades/texto';
import type { Autor } from '../../operativos/application/operativos.service';
import { FlotaRepository } from '../infrastructure/flota.repository';
import { PlanificacionTransporteRepository } from '../infrastructure/planificacion-transporte.repository';
import { FlotaService } from './flota.service';
import {
  FORMATO_ESPERADO,
  previsualizarCarga,
  validarDatos,
  type FilaCarga,
  type PreviaCarga,
  type TipoCarga,
} from './politicas/carga-inicial';
import type { TurnoImportado } from './politicas/importar-horario';
import { leerHojaHorario } from './turnos-conductores-importador';
import { TurnosConductoresService } from './turnos-conductores.service';

export interface ResultadoCarga {
  creados: number;
  actualizados: number;
  omitidos: { fila: number; motivo: string }[];
}

const TURNOS: readonly TurnoImportado[] = [
  'DIA',
  'NOCHE',
  'ECU_NOCHE',
  'LIBRE',
  'ADMINISTRATIVO',
];

const aFecha = (texto: unknown): Date | null =>
  typeof texto === 'string' && texto
    ? new Date(`${texto}T00:00:00.000Z`)
    : null;

/** Solo las claves con valor: al ACTUALIZAR, una celda vacía no borra lo que ya hay. */
function conValor<T extends object>(
  datos: T,
): { [K in keyof T]?: Exclude<T[K], null> } {
  return Object.fromEntries(
    Object.entries(datos).filter(([, v]) => v !== null && v !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], null> };
}

@Injectable()
export class CargaInicialService {
  constructor(
    private readonly flota: FlotaService,
    private readonly flotaRepositorio: FlotaRepository,
    private readonly planificacion: PlanificacionTransporteRepository,
    private readonly turnos: TurnosConductoresService,
  ) {}

  async previsualizar(
    tipo: TipoCarga,
    mes: string | undefined,
    contenido: Buffer,
  ): Promise<PreviaCarga> {
    if (tipo === 'turnos')
      return this.previsualizarTurnos(exigirMes(mes), contenido);
    const [hoja, zonales] = await Promise.all([
      leerHojaHorario(
        contenido,
        `con las columnas ${FORMATO_ESPERADO[tipo].join(', ')}`,
      ),
      this.planificacion.zonalesActivas(),
    ]);
    return previsualizarCarga(tipo, hoja, { zonales });
  }

  async aplicar(
    tipo: TipoCarga,
    mes: string | undefined,
    filas: readonly { fila: number; datos: Record<string, unknown> }[],
    autor: Autor,
  ): Promise<ResultadoCarga> {
    if (tipo === 'turnos')
      return this.aplicarTurnos(exigirMes(mes), filas, autor);

    const zonales = await this.planificacion.zonalesActivas();
    const resultado: ResultadoCarga = {
      creados: 0,
      actualizados: 0,
      omitidos: [],
    };
    for (const { fila, datos: crudos } of filas) {
      const { datos, errores } = validarDatos(tipo, crudos ?? {}, { zonales });
      if (errores.length > 0) {
        resultado.omitidos.push({ fila, motivo: errores.join(' ') });
        continue;
      }
      try {
        const creado =
          tipo === 'conductores'
            ? await this.upsertConductor(datos, autor.usuarioId)
            : tipo === 'vehiculos'
              ? await this.upsertVehiculo(datos, autor.usuarioId)
              : await this.upsertGaraje(datos, autor.usuarioId);
        if (creado) resultado.creados += 1;
        else resultado.actualizados += 1;
      } catch (error) {
        if (!(error instanceof ApplicationError)) throw error;
        resultado.omitidos.push({ fila, motivo: error.message });
      }
    }
    return resultado;
  }

  // ─────────────────────────── Upsert por clave natural ───────────────────────────

  /** Devuelve `true` si lo creó, `false` si lo actualizó. */
  private async upsertConductor(
    d: Record<string, unknown>,
    usuarioId: number,
  ): Promise<boolean> {
    const campos = {
      nombreCompleto: d.nombreCompleto as string,
      telefono: d.telefono as string | null,
      sector: d.sector as SectorCiudad | null,
      tipoContrato: d.tipoContrato as TipoContrato | null,
      parqueaderoAutorizado: d.parqueaderoAutorizado as boolean | null,
      actaParqueaderoNumero: d.actaParqueaderoNumero as string | null,
      actaParqueaderoDesde: aFecha(d.actaParqueaderoDesde),
      actaParqueaderoHasta: aFecha(d.actaParqueaderoHasta),
      patronRotacion: d.patronRotacion as string | null,
    };
    const existente = await this.flotaRepositorio.buscarConductorPorCedula(
      d.cedula as string,
    );
    if (existente) {
      await this.flota.actualizarConductor(
        existente.id,
        { ...conValor(campos), ...(existente.activo ? {} : { activo: true }) },
        usuarioId,
      );
      return false;
    }
    await this.flota.crearConductor(
      {
        ...campos,
        cedula: d.cedula as string,
        parqueaderoAutorizado: campos.parqueaderoAutorizado ?? false,
      },
      usuarioId,
    );
    return true;
  }

  private async upsertVehiculo(
    d: Record<string, unknown>,
    usuarioId: number,
  ): Promise<boolean> {
    const campos = {
      tipo: d.tipo as string | null,
      asientos: d.asientos as number | null,
      kilometraje: d.kilometraje as number | null,
      matriculaVencimiento: aFecha(d.matriculaVencimiento),
      soatVencimiento: aFecha(d.soatVencimiento),
    };
    // Normalizada (A1): «PMA3370» del Excel encuentra al «PMA-3370» registrado.
    const existente = await this.flota.buscarVehiculoPorPlaca(
      d.placa as string,
    );
    if (existente) {
      await this.flota.actualizarVehiculo(
        existente.id,
        { ...conValor(campos), ...(existente.activo ? {} : { activo: true }) },
        usuarioId,
      );
      return false;
    }
    await this.flota.crearVehiculo(
      { ...campos, placa: d.placa as string },
      usuarioId,
    );
    return true;
  }

  private async upsertGaraje(
    d: Record<string, unknown>,
    usuarioId: number,
  ): Promise<boolean> {
    const nombre = d.nombre as string;
    const zonalId = d.zonalId as number | null;
    const existentes = await this.flota.listarUbicaciones(true);
    const existente = existentes.find(
      (u) =>
        normalizarParaComparar(u.nombre) === normalizarParaComparar(nombre),
    );
    if (existente) {
      await this.flota.actualizarUbicacion(
        existente.id,
        {
          garajeAutorizado: true,
          ...(zonalId !== null ? { zonalId } : {}),
          ...(existente.activo ? {} : { activo: true }),
        },
        usuarioId,
      );
      return false;
    }
    await this.flota.crearUbicacion(nombre, usuarioId, {
      zonalId,
    });
    return true;
  }

  // ─────────────────────────── Turnos: el HORARIO y el lote ───────────────────────────

  private async previsualizarTurnos(
    mes: string,
    contenido: Buffer,
  ): Promise<PreviaCarga> {
    const previa = await this.turnos.previsualizarImportacion(mes, contenido);
    const usadas = new Set<number>();
    const filas: FilaCarga[] = previa.filas.map((f) => {
      const valido = f.errores.length === 0 && f.conductorId !== null;
      const suyas =
        valido && !usadas.has(f.conductorId as number)
          ? previa.celdas
              .filter((c) => c.conductorId === f.conductorId)
              .map((c) => ({ fecha: c.fecha, turno: c.turno }))
          : [];
      if (valido) usadas.add(f.conductorId as number);
      return {
        fila: f.fila,
        valido,
        errores: f.errores,
        datos: {
          nombre: f.nombre,
          conductorId: f.conductorId,
          conductor: f.conductor,
          celdas: suyas,
          omitidas: previa.omitidas
            .filter((o) => o.fila === f.fila)
            .map((o) => ({ fecha: o.fecha, motivo: o.motivo })),
        },
      };
    });
    const validas = filas.filter((f) => f.valido).length;
    return {
      tipo: 'turnos',
      filas,
      resumen: { validas, invalidas: filas.length - validas },
      formatoEsperado: FORMATO_ESPERADO.turnos,
    };
  }

  private async aplicarTurnos(
    mes: string,
    filas: readonly { fila: number; datos: Record<string, unknown> }[],
    autor: Autor,
  ): Promise<ResultadoCarga> {
    const omitidos: ResultadoCarga['omitidos'] = [];
    const celdas: {
      conductorId: number;
      fecha: string;
      turno: TurnoConductor;
    }[] = [];
    const filaDe = new Map<number, number>();
    for (const { fila, datos } of filas) {
      const conductorId = datos?.conductorId;
      const lista = datos?.celdas;
      if (typeof conductorId !== 'number' || !Array.isArray(lista)) {
        omitidos.push({
          fila,
          motivo: 'La fila no trae el conductor ni sus turnos.',
        });
        continue;
      }
      filaDe.set(conductorId, fila);
      for (const celda of lista as { fecha?: unknown; turno?: unknown }[]) {
        const fecha = typeof celda?.fecha === 'string' ? celda.fecha : '';
        const turno = celda?.turno as TurnoImportado;
        if (!fecha.startsWith(`${mes}-`) || !TURNOS.includes(turno)) {
          omitidos.push({
            fila,
            motivo:
              `Celda no válida para ${mes}: ${fecha || 'sin fecha'} ${typeof celda?.turno === 'string' ? celda.turno : ''}.`.trim(),
          });
          continue;
        }
        celdas.push({ conductorId, fecha, turno: turno as TurnoConductor });
      }
    }
    const lote = await this.turnos.editarLote(celdas, autor);
    for (const o of lote.omitidas) {
      omitidos.push({
        fila: filaDe.get(o.conductorId) ?? 0,
        motivo: `${o.fecha}: ${o.motivo}`,
      });
    }
    return { creados: 0, actualizados: lote.aplicadas, omitidos };
  }
}

function exigirMes(mes: string | undefined): string {
  if (!mes) {
    throw new ValidacionError(
      'Indique el mes (AAAA-MM) de los turnos que se cargan.',
    );
  }
  return mes;
}
