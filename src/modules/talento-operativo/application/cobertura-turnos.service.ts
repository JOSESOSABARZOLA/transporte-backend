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
 * sale de `direccionesAlAlcance`. Desde el 2026-10-05, quien NO gestiona Instrucción recibe 404
 * en TODOS los endpoints —también en la matriz, que antes devolvía vacía—, sin revelar que exista
 * nada. Las ausencias (vacaciones/reposo…) se DERIVAN de la disponibilidad y se superponen: en la
 * matriz solo se editan DIURNO/NOCTURNO/DESCANSO, o se limpia la celda.
 *
 * 2026-10-05 · edición en lote (selección de rango, «Aplicar patrón», «Continuar rotación»), totales
 * completos, estado INFORMATIVO del mes (borrador/publicado) y avisos entre días por parámetro.
 */

import { Injectable } from '@nestjs/common';
import {
  AreaPersonal,
  EstadoCoberturaMes,
  EstadoTurno,
  type DenominacionInstruccion,
  type RolDepartamental,
} from '@prisma/client';

import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ParametroPoliticaService } from '../../configuracion/application/parametro-politica.service';
import { ROL_DEL_AREA } from '../domain/areas-del-rol';
import { FuncionariosService } from './funcionarios.service';
import { CoberturaTurnosRepository } from '../infrastructure/cobertura-turnos.repository';
import { exportarCoberturaXlsx } from './cobertura-exportador';
import {
  avisosConfigurados,
  calcularAvisosCobertura,
  comoValorNocturnoADiurno,
  type DiaAviso,
  type ParametrosAvisosCobertura,
} from './politicas/cobertura-alertas.policy';
import {
  proponerRotacion,
  type DiaRotacion,
  type TurnoRotacion,
} from './politicas/cobertura-rotacion.policy';

export interface CeldaCobertura {
  fecha: string; // AAAA-MM-DD
  /** DIURNO | NOCTURNO | DESCANSO | VACACIONES | REPOSO_MEDICO | … | null si el día está vacío. */
  estado: string | null;
  /** `true` cuando el estado viene de una ausencia (no editable en la matriz). */
  esAusencia: boolean;
  /** Aviso entre días (solo avisa, no bloquea). Ausente si no hay aviso. */
  aviso?: string;
}

export interface PersonaCobertura {
  funcionarioId: number;
  nombre: string;
  /** Cargo del Maestro de personal. */
  cargo: string | null;
  zonalId: number | null;
  zona: string | null;
  denominacion: string | null;
  /** Cuántas celdas de la persona tienen aviso en el mes. */
  avisos: number;
  celdas: CeldaCobertura[];
}

export interface TotalDia {
  fecha: string;
  diurno: number;
  nocturno: number;
  descanso: number;
  ausencias: number;
  /** Celda vacía sin ausencia: ese día la persona no tiene turno ni restricción de la matriz. */
  sinTurno: number;
  /** diurno + nocturno (se conserva por compatibilidad). */
  activos: number;
}

export interface MatrizCobertura {
  mes: string; // AAAA-MM
  dias: string[]; // fechas AAAA-MM-DD del mes
  personas: PersonaCobertura[];
  totales: TotalDia[];
  /** Estado INFORMATIVO del mes: la elegibilidad usa la matriz esté publicada o no. */
  estadoMes: EstadoCoberturaMes;
  /** Si alguna regla de aviso está encendida por parámetro. */
  avisosConfigurados: boolean;
}

export interface CeldaLote {
  funcionarioId: number;
  fecha: string;
  estado: EstadoTurno | null;
}

export interface OmisionLote {
  funcionarioId: number;
  fecha: string;
  motivo: string;
}

export interface ResultadoLote {
  aplicadas: number;
  omitidas: OmisionLote[];
}

export interface PropuestaRotacionCelda {
  funcionarioId: number;
  fecha: string;
  estado: TurnoRotacion;
}

export interface ResultadoPropuestaRotacion {
  propuestas: PropuestaRotacionCelda[];
  /** Personas con al menos una celda propuesta. */
  personas: number;
  /** Días de ausencia que la rotación salta. */
  omitidas: number;
}

export interface ResultadoPublicar {
  estadoMes: EstadoCoberturaMes;
  /** Celdas vacías (sin turno ni ausencia) que quedaron sin restricción de horario. */
  celdasVacias: number;
}

/** Días previos al mes que se leen para que la racha de avisos y la rotación arrastren. */
const DIAS_PREVIOS = 31;

/** La dirección dueña de Instrucción: clave del estado del mes. */
const DIRECCION_INSTRUCCION: RolDepartamental =
  ROL_DEL_AREA[AreaPersonal.INSTRUCCION];

const NO_ENCONTRADO =
  'No tiene a su cargo personal de Instrucción para la cobertura por turnos.';

/** Lo que el servicio necesita saber de cada persona y cada día, ya resuelto. */
interface DiaResuelto {
  fecha: string;
  turno: EstadoTurno | null;
  ausencia: string | null;
}

@Injectable()
export class CoberturaTurnosService {
  constructor(
    private readonly repositorio: CoberturaTurnosRepository,
    private readonly funcionarios: FuncionariosService,
    private readonly parametros: ParametroPoliticaService,
  ) {}

  /**
   * Las direcciones al alcance, exigiendo que gestione Instrucción. Si no, 404 sin revelar nada.
   */
  private async alcanceInstruccion(
    usuario: UsuarioAutenticado,
  ): Promise<RolDepartamental[]> {
    const direcciones = await this.funcionarios.direccionesAlAlcance(
      usuario.roles,
    );
    if (!direcciones.includes(DIRECCION_INSTRUCCION)) {
      throw new RecursoNoEncontradoError(NO_ENCONTRADO, {});
    }
    return direcciones;
  }

  /** Los parámetros de avisos (regla 2). Apagados por defecto: 0 y SIN_CONFIGURAR. */
  private async parametrosAvisos(): Promise<ParametrosAvisosCobertura> {
    const [maximo, nocturno] = await Promise.all([
      this.parametros.obtenerTextoOpcional('COBERTURA_MAX_DIAS_SIN_DESCANSO'),
      this.parametros.obtenerTextoOpcional(
        'COBERTURA_PERMITE_NOCTURNO_A_DIURNO',
      ),
    ]);
    const numero = Number(maximo);
    return {
      maxDiasSinDescanso: Number.isInteger(numero) && numero > 0 ? numero : 0,
      permiteNocturnoADiurno: comoValorNocturnoADiurno(nocturno),
    };
  }

  /**
   * Resuelve, para cada persona, cada día del rango: su turno guardado y/o su ausencia.
   * Dos consultas en lote para todo el personal (sin N+1).
   */
  private async resolverDias(
    ids: number[],
    desde: Date,
    hasta: Date,
  ): Promise<Map<number, DiaResuelto[]>> {
    const [coberturas, ausencias] = await Promise.all([
      this.repositorio.coberturasEnRango(ids, desde, hasta),
      this.repositorio.ausenciasEnRango(ids, desde, hasta),
    ]);

    const turnoDe = new Map<string, EstadoTurno>();
    for (const c of coberturas) {
      turnoDe.set(`${c.funcionarioId}|${claveFecha(c.fecha)}`, c.estado);
    }

    const fechas = rangoDeFechas(desde, hasta);
    const porPersona = new Map<number, DiaResuelto[]>();
    for (const id of ids) {
      const ausenciasPersona = ausencias.filter((a) => a.funcionarioId === id);
      porPersona.set(
        id,
        fechas.map((fecha) => ({
          fecha,
          turno: turnoDe.get(`${id}|${fecha}`) ?? null,
          ausencia:
            ausenciasPersona.find((a) => cubre(a.desde, a.hasta, fecha))
              ?.estado ?? null,
        })),
      );
    }
    return porPersona;
  }

  /** La matriz del mes: personas × días, con ausencias, avisos, totales y estado del mes. */
  async matriz(
    usuario: UsuarioAutenticado,
    mes: string,
  ): Promise<MatrizCobertura> {
    const direcciones = await this.alcanceInstruccion(usuario);
    const { anio, mesNum, cantidadDias } = interpretarMes(mes);
    const desde = fechaUtc(anio, mesNum, 1);
    const hasta = fechaUtc(anio, mesNum, cantidadDias);
    const previo = sumarDias(desde, -DIAS_PREVIOS);
    const dias = rangoDeFechas(desde, hasta);

    const personal = await this.repositorio.personalDeInstruccion(direcciones);
    const ids = personal.map((p) => p.id);

    const [resueltos, parametros, filaMes] = await Promise.all([
      this.resolverDias(ids, previo, hasta),
      this.parametrosAvisos(),
      this.repositorio.estadoMes(mes, DIRECCION_INSTRUCCION),
    ]);

    const totales: TotalDia[] = dias.map((fecha) => ({
      fecha,
      diurno: 0,
      nocturno: 0,
      descanso: 0,
      ausencias: 0,
      sinTurno: 0,
      activos: 0,
    }));

    const personas: PersonaCobertura[] = personal.map((persona) => {
      const secuencia = resueltos.get(persona.id) ?? [];
      const avisos = calcularAvisosCobertura(
        secuencia.map(aDiaAviso),
        parametros,
      );
      const delMes = secuencia.slice(DIAS_PREVIOS);
      const avisosMes = avisos.slice(DIAS_PREVIOS);
      let cuenta = 0;

      const celdas = delMes.map((dia, indice): CeldaCobertura => {
        const total = totales[indice];
        const aviso = avisosMes[indice];
        if (aviso) cuenta += 1;

        if (dia.ausencia) {
          total.ausencias += 1;
          return { fecha: dia.fecha, estado: dia.ausencia, esAusencia: true };
        }

        if (dia.turno === EstadoTurno.DIURNO) total.diurno += 1;
        else if (dia.turno === EstadoTurno.NOCTURNO) total.nocturno += 1;
        else if (dia.turno === EstadoTurno.DESCANSO) total.descanso += 1;
        else total.sinTurno += 1;

        return {
          fecha: dia.fecha,
          estado: dia.turno,
          esAusencia: false,
          ...(aviso ? { aviso } : {}),
        };
      });

      return {
        funcionarioId: persona.id,
        nombre: `${persona.apellidos} ${persona.nombres}`,
        cargo: persona.cargo ?? null,
        zonalId: persona.zonalId,
        zona: persona.zonal?.nombre ?? null,
        denominacion: persona.denominacion,
        avisos: cuenta,
        celdas,
      };
    });

    for (const total of totales) total.activos = total.diurno + total.nocturno;

    return {
      mes,
      dias,
      personas,
      totales,
      estadoMes: filaMes?.estado ?? EstadoCoberturaMes.BORRADOR,
      avisosConfigurados: avisosConfigurados(parametros),
    };
  }

  /**
   * Fija o LIMPIA (estado `null`) el turno de una persona en un día. Solo su gente de Instrucción,
   * y no sobre un día de ausencia —ese lo manda la disponibilidad, no la matriz—.
   */
  async editarCelda(
    usuario: UsuarioAutenticado,
    funcionarioId: number,
    fecha: string,
    estado: EstadoTurno | null,
  ): Promise<void> {
    const direcciones = await this.alcanceInstruccion(usuario);

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

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      if (estado === null) {
        await this.repositorio.borrarCelda(funcionarioId, fechaUtcDia, cliente);
      } else {
        await this.repositorio.guardarCelda(
          funcionarioId,
          fechaUtcDia,
          estado,
          usuario.usuarioId,
          cliente,
        );
      }
      await this.repositorio.marcarConCambios(
        [fecha.slice(0, 7)],
        DIRECCION_INSTRUCCION,
        cliente,
      );
    });
  }

  /**
   * EDICIÓN EN LOTE (selección de rango, «Aplicar patrón», «Continuar rotación»). Valida CADA
   * celda —alcance, área, ausencia ese día— y aplica las válidas en UNA transacción. Las demás
   * se devuelven como omitidas con su motivo, en vez de abortar el lote entero.
   */
  async editarLote(
    usuario: UsuarioAutenticado,
    celdas: CeldaLote[],
  ): Promise<ResultadoLote> {
    const direcciones = await this.alcanceInstruccion(usuario);
    if (celdas.length === 0) return { aplicadas: 0, omitidas: [] };

    const conFecha = celdas.map((celda) => ({
      ...celda,
      dia: interpretarFecha(celda.fecha),
    }));
    const ids = [...new Set(celdas.map((celda) => celda.funcionarioId))];
    const minimo = conFecha.reduce(
      (menor, c) => (c.dia < menor ? c.dia : menor),
      conFecha[0].dia,
    );
    const maximo = conFecha.reduce(
      (mayor, c) => (c.dia > mayor ? c.dia : mayor),
      conFecha[0].dia,
    );

    const [enAlcance, ausencias] = await Promise.all([
      this.repositorio.idsDeInstruccion(ids, direcciones),
      this.repositorio.ausenciasEnRango(ids, minimo, maximo),
    ]);

    const omitidas: OmisionLote[] = [];
    const validas: typeof conFecha = [];
    for (const celda of conFecha) {
      if (!enAlcance.has(celda.funcionarioId)) {
        omitidas.push({
          funcionarioId: celda.funcionarioId,
          fecha: celda.fecha,
          motivo: 'Fuera de su alcance o no es personal de Instrucción.',
        });
        continue;
      }
      const tieneAusencia = ausencias.some(
        (a) =>
          a.funcionarioId === celda.funcionarioId &&
          cubre(a.desde, a.hasta, celda.fecha),
      );
      if (tieneAusencia) {
        omitidas.push({
          funcionarioId: celda.funcionarioId,
          fecha: celda.fecha,
          motivo: 'Ausencia registrada ese día.',
        });
        continue;
      }
      validas.push(celda);
    }

    if (validas.length > 0) {
      const meses = [...new Set(validas.map((c) => c.fecha.slice(0, 7)))];
      await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
        for (const celda of validas) {
          if (celda.estado === null) {
            await this.repositorio.borrarCelda(
              celda.funcionarioId,
              celda.dia,
              cliente,
            );
          } else {
            await this.repositorio.guardarCelda(
              celda.funcionarioId,
              celda.dia,
              celda.estado,
              usuario.usuarioId,
              cliente,
            );
          }
        }
        await this.repositorio.marcarConCambios(
          meses,
          DIRECCION_INSTRUCCION,
          cliente,
        );
      });
    }

    return { aplicadas: validas.length, omitidas };
  }

  /**
   * «CONTINUAR ROTACIÓN»: propone el turno de cada celda VACÍA del mes siguiendo el ciclo de cada
   * persona. No escribe nada: el front lo aplica con el lote, después de mostrar el resumen.
   */
  async proponerRotacion(
    usuario: UsuarioAutenticado,
    mes: string,
    funcionarioIds?: number[],
  ): Promise<ResultadoPropuestaRotacion> {
    const direcciones = await this.alcanceInstruccion(usuario);
    const { anio, mesNum, cantidadDias } = interpretarMes(mes);
    const desde = fechaUtc(anio, mesNum, 1);
    const hasta = fechaUtc(anio, mesNum, cantidadDias);
    const previo = sumarDias(desde, -DIAS_PREVIOS);

    const personal = await this.repositorio.personalDeInstruccion(direcciones);
    const ids = personal
      .map((p) => p.id)
      .filter((id) => !funcionarioIds || funcionarioIds.includes(id));

    const resueltos = await this.resolverDias(ids, previo, hasta);

    const propuestas: PropuestaRotacionCelda[] = [];
    let personas = 0;
    let omitidas = 0;
    for (const id of ids) {
      const dias = resueltos.get(id) ?? [];
      const resultado = proponerRotacion(dias.map(aDiaRotacion), DIAS_PREVIOS);
      if (resultado.propuestas.length === 0) continue;
      personas += 1;
      omitidas += resultado.omitidas;
      for (const { indice, estado } of resultado.propuestas) {
        propuestas.push({
          funcionarioId: id,
          fecha: dias[indice].fecha,
          estado,
        });
      }
    }

    return { propuestas, personas, omitidas };
  }

  /**
   * Publica el mes. Es INFORMATIVO: no cambia la elegibilidad. Devuelve cuántas celdas quedaron
   * vacías (sin restricción de horario); la confirmación de publicar así la pide el front.
   */
  async publicarMes(
    usuario: UsuarioAutenticado,
    mes: string,
  ): Promise<ResultadoPublicar> {
    await this.alcanceInstruccion(usuario);
    interpretarMes(mes);

    const fila = await this.repositorio.publicarMes(
      mes,
      DIRECCION_INSTRUCCION,
      usuario.usuarioId,
    );
    const matriz = await this.matriz(usuario, mes);
    const celdasVacias = matriz.totales.reduce(
      (suma, total) => suma + total.sinTurno,
      0,
    );

    return { estadoMes: fila.estado, celdasVacias };
  }

  /** La matriz del mes en Excel (.xlsx), con el formato de Instrucción. Mismo alcance que la matriz. */
  async exportar(usuario: UsuarioAutenticado, mes: string): Promise<Buffer> {
    return exportarCoberturaXlsx(await this.matriz(usuario, mes));
  }

  /** Fija la zona y denominación de Instrucción de una persona a su alcance. */
  async fijarDatosInstruccion(
    usuario: UsuarioAutenticado,
    funcionarioId: number,
    zonalId: number | null | undefined,
    denominacion: DenominacionInstruccion | null | undefined,
  ): Promise<void> {
    const direcciones = await this.alcanceInstruccion(usuario);

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

// ─────────────────────── Conversión a las políticas ───────────────────────

function aDiaAviso(dia: DiaResuelto): DiaAviso {
  if (dia.ausencia) return 'AUSENCIA';
  if (dia.turno === null) return 'VACIA';
  return dia.turno;
}

function aDiaRotacion(dia: DiaResuelto): DiaRotacion {
  if (dia.ausencia) return 'AUSENCIA';
  return dia.turno;
}

// ─────────────────────── Fechas (AAAA-MM-DD, UTC, sin huso) ───────────────────────

function fechaUtc(anio: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * 24 * 60 * 60 * 1000);
}

function claveFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Las fechas AAAA-MM-DD de `desde` a `hasta`, ambas incluidas. */
function rangoDeFechas(desde: Date, hasta: Date): string[] {
  const fechas: string[] = [];
  for (let dia = desde; dia <= hasta; dia = sumarDias(dia, 1)) {
    fechas.push(claveFecha(dia));
  }
  return fechas;
}

/** `desde <= dia <= hasta`, comparando como texto AAAA-MM-DD (orden alfabético = cronológico). */
function cubre(desde: Date, hasta: Date, dia: string): boolean {
  return claveFecha(desde) <= dia && dia <= claveFecha(hasta);
}

export function interpretarMes(mes: string): {
  anio: number;
  mesNum: number;
  cantidadDias: number;
} {
  const partes = /^(\d{4})-(\d{2})$/.exec(mes ?? '');

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
