/**
 * Microservicio: transporte
 * Módulo: Talento operativo
 * Feature: Cobertura por turnos (Instrucción)
 * Archivo: cobertura-turnos.service.ts
 * Responsabilidad: Componer la matriz mensual de turnos de Instrucción y editar sus celdas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 *
 * ES SOLO DE INSTRUCCIÓN, Y SE ACOTA CON LA MISMA VARA QUE EL MAESTRO (PER-09). El alcance
 * sale de `direccionesAlAlcance`; un administrador cuyo alcance no incluye Instrucción
 * recibe la matriz vacía. Las ausencias (vacaciones/reposo) se DERIVAN de la disponibilidad
 * y se superponen: en la matriz solo se editan DIURNO/NOCTURNO/DESCANSO.
 */

import { Injectable } from '@nestjs/common';
import { EstadoTurno, type DenominacionInstruccion } from '@prisma/client';

import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { FuncionariosService } from './funcionarios.service';
import { CoberturaTurnosRepository } from '../infrastructure/cobertura-turnos.repository';

export interface CeldaCobertura {
  fecha: string; // AAAA-MM-DD
  /** DIURNO | NOCTURNO | DESCANSO | VACACIONES | REPOSO_MEDICO | … | null si el día está vacío. */
  estado: string | null;
  /** `true` cuando el estado viene de una ausencia (no editable en la matriz). */
  esAusencia: boolean;
}

export interface PersonaCobertura {
  funcionarioId: number;
  nombre: string;
  zonalId: number | null;
  zona: string | null;
  denominacion: string | null;
  celdas: CeldaCobertura[];
}

export interface TotalDia {
  fecha: string;
  diurno: number;
  nocturno: number;
  activos: number;
}

export interface MatrizCobertura {
  mes: string; // AAAA-MM
  dias: string[]; // fechas AAAA-MM-DD del mes
  personas: PersonaCobertura[];
  totales: TotalDia[];
}

@Injectable()
export class CoberturaTurnosService {
  constructor(
    private readonly repositorio: CoberturaTurnosRepository,
    private readonly funcionarios: FuncionariosService,
  ) {}

  /** La matriz del mes: personas × días, con las ausencias superpuestas y los totales. */
  async matriz(
    usuario: UsuarioAutenticado,
    mes: string,
  ): Promise<MatrizCobertura> {
    const { anio, mesNum, cantidadDias } = interpretarMes(mes);
    const desde = fechaUtc(anio, mesNum, 1);
    const hasta = fechaUtc(anio, mesNum, cantidadDias);
    const dias = Array.from({ length: cantidadDias }, (_, i) =>
      claveFecha(fechaUtc(anio, mesNum, i + 1)),
    );

    const direcciones = await this.funcionarios.direccionesAlAlcance(
      usuario.roles,
    );
    const personal = await this.repositorio.personalDeInstruccion(direcciones);
    const ids = personal.map((p) => p.id);

    const coberturas = await this.repositorio.coberturasEnRango(
      ids,
      desde,
      hasta,
    );
    const ausencias = await this.repositorio.ausenciasEnRango(
      ids,
      desde,
      hasta,
    );

    // Índice de turnos por persona+día.
    const turnoDe = new Map<string, string>();
    for (const c of coberturas) {
      turnoDe.set(`${c.funcionarioId}|${claveFecha(c.fecha)}`, c.estado);
    }

    const totales: TotalDia[] = dias.map((fecha) => ({
      fecha,
      diurno: 0,
      nocturno: 0,
      activos: 0,
    }));

    const personas: PersonaCobertura[] = personal.map((persona) => {
      const ausenciasPersona = ausencias.filter(
        (a) => a.funcionarioId === persona.id,
      );

      const celdas = dias.map((fecha, indice): CeldaCobertura => {
        const ausencia = ausenciasPersona.find((a) =>
          cubre(a.desde, a.hasta, fecha),
        );

        if (ausencia) {
          return { fecha, estado: ausencia.estado, esAusencia: true };
        }

        const turno = turnoDe.get(`${persona.id}|${fecha}`) ?? null;

        if (turno === EstadoTurno.DIURNO) totales[indice].diurno += 1;
        if (turno === EstadoTurno.NOCTURNO) totales[indice].nocturno += 1;

        return { fecha, estado: turno, esAusencia: false };
      });

      return {
        funcionarioId: persona.id,
        nombre: `${persona.apellidos} ${persona.nombres}`,
        zonalId: persona.zonalId,
        zona: persona.zonal?.nombre ?? null,
        denominacion: persona.denominacion,
        celdas,
      };
    });

    for (const total of totales) total.activos = total.diurno + total.nocturno;

    return { mes, dias, personas, totales };
  }

  /**
   * Fija el turno de una persona en un día. Solo DIURNO/NOCTURNO/DESCANSO, solo su gente, y
   * no sobre un día de ausencia —ese lo manda la disponibilidad, no la matriz—.
   */
  async editarCelda(
    usuario: UsuarioAutenticado,
    funcionarioId: number,
    fecha: string,
    estado: EstadoTurno,
  ): Promise<void> {
    const direcciones = await this.funcionarios.direccionesAlAlcance(
      usuario.roles,
    );

    const enAlcance = await this.repositorio.esDeInstruccion(
      funcionarioId,
      direcciones,
    );

    if (!enAlcance) {
      // Igual que el maestro: pedir lo ajeno no confirma que exista.
      throw new RecursoNoEncontradoError(
        'Esa persona no pertenece al personal de Instrucción a su alcance.',
        { funcionarioId },
      );
    }

    const fechaUtcDia = interpretarFecha(fecha);
    const ausencias = await this.repositorio.ausenciasEnRango(
      [funcionarioId],
      fechaUtcDia,
      fechaUtcDia,
    );

    if (ausencias.length > 0) {
      throw new ValidacionError(
        'Ese día la persona tiene una ausencia registrada (vacaciones, reposo…). Se gestiona en «Ausencias», no en la matriz de turnos.',
        { funcionarioId, fecha },
      );
    }

    await this.repositorio.guardarCelda(
      funcionarioId,
      fechaUtcDia,
      estado,
      usuario.usuarioId,
    );
  }

  /** Fija la zona y denominación de Instrucción de una persona a su alcance. */
  async fijarDatosInstruccion(
    usuario: UsuarioAutenticado,
    funcionarioId: number,
    zonalId: number | null | undefined,
    denominacion: DenominacionInstruccion | null | undefined,
  ): Promise<void> {
    const direcciones = await this.funcionarios.direccionesAlAlcance(
      usuario.roles,
    );

    const enAlcance = await this.repositorio.esDeInstruccion(
      funcionarioId,
      direcciones,
    );

    if (!enAlcance) {
      throw new RecursoNoEncontradoError(
        'Esa persona no pertenece al personal de Instrucción a su alcance.',
        { funcionarioId },
      );
    }

    await this.repositorio.actualizarZonaDenominacion(
      funcionarioId,
      zonalId,
      denominacion,
    );
  }
}

// ─────────────────────── Fechas (AAAA-MM-DD, UTC, sin huso) ───────────────────────

function fechaUtc(anio: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function claveFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** `desde <= dia <= hasta`, comparando como texto AAAA-MM-DD (orden alfabético = cronológico). */
function cubre(desde: Date, hasta: Date, dia: string): boolean {
  return claveFecha(desde) <= dia && dia <= claveFecha(hasta);
}

function interpretarMes(mes: string): {
  anio: number;
  mesNum: number;
  cantidadDias: number;
} {
  const partes = /^(\d{4})-(\d{2})$/.exec(mes);

  if (!partes) {
    throw new ValidacionError(
      `«${mes}» no es un mes válido. Se escribe como AAAA-MM.`,
      { mes },
    );
  }

  const anio = Number(partes[1]);
  const mesNum = Number(partes[2]);

  if (mesNum < 1 || mesNum > 12) {
    throw new ValidacionError(`El mes ${mes} no existe.`, { mes });
  }

  return {
    anio,
    mesNum,
    cantidadDias: new Date(Date.UTC(anio, mesNum, 0)).getUTCDate(),
  };
}

function interpretarFecha(texto: string): Date {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);

  if (!partes) {
    throw new ValidacionError(
      `«${texto}» no es una fecha válida. Se escribe como AAAA-MM-DD.`,
      { fecha: texto },
    );
  }

  const [, anio, mes, dia] = partes.map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    throw new ValidacionError(`La fecha ${texto} no existe.`, { fecha: texto });
  }

  return fecha;
}
