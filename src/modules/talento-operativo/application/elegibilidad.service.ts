/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: elegibilidad.service.ts
 * Responsabilidad: Reunir antecedentes, resolver umbrales y emitir el veredicto.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ES EL ÚNICO PUNTO POR EL QUE OTROS SUBMÓDULOS PREGUNTAN si una persona puede salir.
 * `operativos` (M-14) invocará `verificar()` y recibirá un veredicto; nunca los datos
 * con los que se decidió. Esa es la frontera que impide que la lógica de descanso se
 * filtre a otro submódulo: sin acceso a los antecedentes, no hay forma de reimplementarla.
 *
 * REPARTE EL TRABAJO ASÍ:
 *   · este servicio consulta y traduce —parámetros, fechas, franjas—;
 *   · `descanso-personal.policy.ts` decide, sin tocar nada externo.
 *
 * LOS UMBRALES SE LEEN DE PARÁMETROS EN CADA VERIFICACIÓN. `ParametroPoliticaService`
 * los sirve de su caché en memoria, así que no cuesta una consulta; y es lo que hace
 * verdadero el caso 10 del plan: cambiar `JORNADA_MAXIMA_HORAS` de 12 a 8 altera el
 * comportamiento **sin recompilar ni reiniciar**.
 */

import { Injectable } from '@nestjs/common';
import { EstadoTurno } from '@prisma/client';

import { RecursoNoEncontradoError } from '../../../common/errors/errores-dominio';
import { ParametroPoliticaService } from '../../configuracion/application/parametro-politica.service';
import { RangoHorario } from '../../operativos/domain/rango-horario';
import {
  ElegibilidadRepository,
  type AsignacionDelDia,
} from '../infrastructure/elegibilidad.repository';
import {
  verificarDescansoConductor,
  type AntecedentesConductor,
} from './politicas/descanso-conductor.policy';
import {
  verificarDescanso,
  type AntecedentesPersona,
  type ContextoAsignacion,
  type UmbralesDescanso,
  type VeredictoElegibilidad,
} from './politicas/descanso-personal.policy';
import {
  calcularFatiga,
  type NivelFatiga,
  type UmbralesFatiga,
} from './politicas/indice-fatiga.policy';
import { esFinDeSemana } from './reglas-historial';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Días de calendario transcurridos entre dos fechas (UTC), truncados a entero. */
function diasEntre(desde: Date, hasta: Date): number {
  return Math.floor((hasta.getTime() - desde.getTime()) / MS_POR_DIA);
}

/** Lo que el submódulo que pregunta sabe de la asignación que pretende hacer. */
export interface ContextoOperativo {
  fecha: Date;
  horaInicio: string;
  horaFin: string;
  /** `form_es_patrulla` del formulario destino. */
  esPatrulla: boolean;
  /** Al editar, el operativo que se está modificando: no se solapa consigo mismo. */
  operativoId?: number;
}

/**
 * Índice de carga y semáforo de fatiga de una persona (FRMS / ISO 45001). Es ADVISORY: no
 * decide `elegible`, solo da visibilidad y ordena la sugerencia. Lo calcula `calcularCargas`
 * reutilizando los antecedentes que ya se reúnen por lote. Ver `indice-fatiga.policy.ts`.
 */
export interface IndiceCarga {
  indiceCarga: number;
  nivelFatiga: NivelFatiga;
  /** Los factores que suman al índice, en palabras (regla 6). */
  factores: string[];
  /** Cuántos operativos tiene asignados la persona en el período de equidad (semana/mes). */
  operativos: number;
}

@Injectable()
export class ElegibilidadService {
  constructor(
    private readonly repositorio: ElegibilidadRepository,
    private readonly parametros: ParametroPoliticaService,
  ) {}

  /**
   * POL-01. Veredicto para una persona concreta.
   *
   * Lo consume M-14 al asignar personal a un operativo. Devuelve el **primer** motivo
   * que impide la asignación, y nada más: ni cédula, ni teléfono, ni área.
   */
  async verificar(
    funcionarioId: number,
    contexto: ContextoOperativo,
  ): Promise<VeredictoElegibilidad> {
    const [veredicto] = await this.verificarVarios([funcionarioId], contexto);
    return veredicto.veredicto;
  }

  /**
   * El mismo veredicto para un grupo, con los antecedentes traídos por lote.
   *
   * Es lo que usa la pantalla de registro al abrir el desplegable de personal: una
   * consulta por antecedente para todo el grupo, en lugar de tres por persona.
   */
  async verificarVarios(
    funcionarioIds: number[],
    contexto: ContextoOperativo,
  ): Promise<{ funcionarioId: number; veredicto: VeredictoElegibilidad }[]> {
    if (funcionarioIds.length === 0) return [];

    const rango = RangoHorario.de(contexto.horaInicio, contexto.horaFin);
    const umbrales = await this.umbrales();
    const contextoAsignacion = await this.componerContexto(contexto, rango);
    const antecedentes = await this.reunirAntecedentes(
      funcionarioIds,
      contexto,
    );

    return funcionarioIds.map((funcionarioId) => {
      const persona = antecedentes.get(funcionarioId);

      if (!persona) {
        // Un identificador que no está en el maestro no es «no elegible»: es un dato
        // equivocado, y confundirlos ocultaría el error real.
        throw new RecursoNoEncontradoError(
          `No existe un funcionario con identificador ${funcionarioId}.`,
          { funcionarioId },
        );
      }

      return {
        funcionarioId,
        veredicto: verificarDescanso(persona, contextoAsignacion, umbrales),
      };
    });
  }

  /**
   * Quiénes están en DESCANSO en la cobertura de Instrucción para esa fecha.
   *
   * Lo usa la lista de elegibles cuando se pide SIN horario: el descanso es
   * disponibilidad por día y se puede decir sin él, a diferencia de las reglas que
   * dependen del rango. Con horario, `verificar`/`verificarVarios` ya lo incluyen.
   */
  async descansosEnFecha(
    funcionarioIds: number[],
    fecha: Date,
  ): Promise<Set<number>> {
    const turnos = await this.repositorio.turnosEnFecha(funcionarioIds, fecha);
    const enDescanso = new Set<number>();
    for (const [id, turno] of turnos) {
      if (turno === EstadoTurno.DESCANSO) enDescanso.add(id);
    }
    return enDescanso;
  }

  /**
   * ÍNDICE DE CARGA / SEMÁFORO DE FATIGA por persona (FRMS / ISO 45001, 2026-09-24). ADVISORY.
   *
   * Reutiliza EL MISMO LOTE de antecedentes que el veredicto (`reunirAntecedentes`, que solo usa
   * la fecha) más los umbrales/pesos de `t_parametro_politica`: no añade consultas por persona ni
   * depende del horario, así que la lista de elegibles del registro —que se pide SIN horario— puede
   * enriquecerse igual. NO decide `elegible`: solo puntúa la carga y la sitúa en el semáforo, para
   * que la pantalla la muestre y sugiera a quién asignar. Ver `indice-fatiga.policy.ts`.
   */
  async calcularCargas(
    funcionarioIds: number[],
    fecha: Date,
  ): Promise<Map<number, IndiceCarga>> {
    if (funcionarioIds.length === 0) return new Map();

    const equidad = await this.periodoDeEquidad(fecha);
    const [
      antecedentes,
      umbrales,
      diasDescansoPatrulla,
      horasPeriodoMapa,
      operativosMapa,
    ] = await Promise.all([
      this.reunirAntecedentes(funcionarioIds, { fecha }),
      this.umbralesFatiga(),
      this.parametros.obtenerEntero('DIAS_DESCANSO_PATRULLA'),
      // Horas acumuladas en el período de equidad (semana/mes): la carga de otros días.
      this.repositorio.horasAsignadasEnPeriodo(
        funcionarioIds,
        equidad.desde,
        equidad.hasta,
      ),
      // Cuántos operativos, para mostrarlo junto a las horas (mismo período).
      this.repositorio.operativosAsignadosEnPeriodo(
        funcionarioIds,
        equidad.desde,
        equidad.hasta,
      ),
    ]);

    const resultado = new Map<number, IndiceCarga>();
    for (const [id, persona] of antecedentes) {
      const horasDia = persona.asignacionesDelDia.reduce(
        (suma, asignacion) => suma + asignacion.horas,
        0,
      );
      // Horas del PERÍODO en días DISTINTOS al de hoy: el total del período menos las de hoy, para
      // no contar dos veces la jornada actual. Nunca negativo (por redondeos de horas propias).
      const horasPeriodo = Math.max(
        0,
        (horasPeriodoMapa.get(id) ?? 0) - horasDia,
      );
      // «Reciente» = dentro del descanso de patrulla (RN-24), el parámetro que ya existe: no se
      // introduce una ventana nueva. Quien salió dentro de esa ventana carga fatiga de patrulla.
      const patrullaReciente =
        persona.ultimaPatrulla != null &&
        diasEntre(persona.ultimaPatrulla, fecha) <= diasDescansoPatrulla;

      const { indice, nivel, factores } = calcularFatiga(
        {
          horasDia,
          horasPeriodo,
          salidasPesadas: persona.salidasPesadas,
          patrullaReciente,
        },
        umbrales,
      );
      resultado.set(id, {
        indiceCarga: indice,
        nivelFatiga: nivel,
        factores,
        operativos: operativosMapa.get(id) ?? 0,
      });
    }
    return resultado;
  }

  /**
   * POL-02. Veredicto para un conductor. Lo aplicará M-17 al asignar transporte.
   */
  async verificarConductor(
    conductorId: number,
    contexto: ContextoOperativo,
  ): Promise<VeredictoElegibilidad> {
    const conductor = await this.repositorio.buscarConductor(conductorId);

    if (!conductor) {
      throw new RecursoNoEncontradoError(
        `No existe un conductor con identificador ${conductorId}.`,
        { conductorId },
      );
    }

    const rango = RangoHorario.de(contexto.horaInicio, contexto.horaFin);

    // RN-26 y RN-33: solo hace falta saber si el operativo es pesado, y la noche la
    // decide la franja configurada, nunca el llamador. Mismo criterio que el personal.
    const contextoPesado = await this.componerContexto(contexto, rango);
    const periodo = await this.periodoDeComputo(contexto.fecha);

    const [ausencia, ultimaPatrulla, conducciones, salidas, umbrales] =
      await Promise.all([
        this.repositorio.ausenciaDeConductor(conductorId, contexto.fecha),
        this.repositorio.ultimaPatrullaDeConductor(conductorId, contexto.fecha),
        this.repositorio.conduccionesDelDia(
          conductorId,
          contexto.fecha,
          contexto.operativoId,
        ),
        this.repositorio.salidasPesadasDeConductor(
          conductorId,
          periodo.desde,
          periodo.hasta,
          contexto.operativoId,
        ),
        this.umbrales(),
      ]);

    const antecedentes: AntecedentesConductor = {
      nombre: conductor.nombreCompleto,
      ausencia: ausencia ?? undefined,
      ultimaPatrulla,
      // VAL-21 y VAL-22, incorporadas en M-17.
      conduccionesDelDia: conducciones.map((conduccion) => ({
        identificador: conduccion.identificador,
        rango: RangoHorario.de(conduccion.horaInicio, conduccion.horaFin),
        horas: conduccion.horas,
      })),
      // Las dos del 2026-08-31. `tipoContrato` viaja tal cual: si es nulo, la regla del
      // contrato no se aplica, y eso es parte de la regla.
      tipoContrato: conductor.tipoContrato,
      salidasPesadas: salidas.filter(
        (salida) => salida.esNocturno || esFinDeSemana(salida.fecha),
      ).length,
    };

    return verificarDescansoConductor(antecedentes, {
      fecha: contexto.fecha,
      esPatrulla: contexto.esPatrulla,
      diasDescansoPatrulla: umbrales.diasDescansoPatrulla,
      rango,
      jornadaMaximaHoras: umbrales.jornadaMaximaHoras,
      esNocturno: contextoPesado.esNocturno,
      esFinDeSemana: contextoPesado.esFinDeSemana,
      topeSalidasPesadas: umbrales.topeSalidasPesadas,
      ventanaNombramiento: umbrales.ventanaNombramiento,
    });
  }

  /**
   * ÍNDICE DE CARGA / SEMÁFORO DE FATIGA por CONDUCTOR (FRMS / ISO 39001+45001, 2026-09-24).
   * ADVISORY, para el desplegable de asignación de la DAF. Lo consume `transporte` (regla 1: la
   * fatiga se calcula aquí y se publica; `transporte` no la reimplementa).
   *
   * Por lote y sin N+1: dos consultas para todo el desplegable (horas del día y salidas del
   * período), no una por conductor. Reutiliza la MISMA política y los MISMOS umbrales que el
   * personal. La patrulla reciente NO entra en el índice del conductor: la regla RN-44 ya la
   * bloquea al asignar, y aquí solo se pondera la carga (horas del día y salidas pesadas).
   */
  async calcularCargasConductores(
    conductorIds: number[],
    fecha: Date,
  ): Promise<Map<number, IndiceCarga>> {
    if (conductorIds.length === 0) return new Map();

    const periodo = await this.periodoDeComputo(fecha);
    const [horas, salidas, umbrales] = await Promise.all([
      this.repositorio.horasConducidasDelDiaDeVarios(conductorIds, fecha),
      this.repositorio.salidasDeConductoresEnPeriodo(
        conductorIds,
        periodo.desde,
        periodo.hasta,
      ),
      this.umbralesFatiga(),
    ]);

    const salidasPesadasPorConductor = new Map<number, number>();
    for (const salida of salidas) {
      if (salida.esNocturno || esFinDeSemana(salida.fecha)) {
        salidasPesadasPorConductor.set(
          salida.conductorId,
          (salidasPesadasPorConductor.get(salida.conductorId) ?? 0) + 1,
        );
      }
    }

    const resultado = new Map<number, IndiceCarga>();
    for (const conductorId of conductorIds) {
      const { indice, nivel, factores } = calcularFatiga(
        {
          horasDia: horas.get(conductorId) ?? 0,
          // La acumulación por período de equidad es del personal; el conductor no la usa aún.
          horasPeriodo: 0,
          salidasPesadas: salidasPesadasPorConductor.get(conductorId) ?? 0,
          patrullaReciente: false,
        },
        umbrales,
      );
      resultado.set(conductorId, {
        indiceCarga: indice,
        nivelFatiga: nivel,
        factores,
        // El conteo de operativos es del personal (se muestra en su reparto); el conductor mide su
        // carga por horas de conducción, así que aquí no aplica y va en cero.
        operativos: 0,
      });
    }
    return resultado;
  }

  // ─────────────────────────── Apoyo ───────────────────────────

  private async umbrales(): Promise<UmbralesDescanso> {
    const [
      diasDescansoPatrulla,
      topeSalidasPesadas,
      jornadaMaximaHoras,
      diurnoInicio,
      diurnoFin,
      nocturnoInicio,
      nocturnoFin,
      nombramientoInicio,
      nombramientoFin,
    ] = await Promise.all([
      this.parametros.obtenerEntero('DIAS_DESCANSO_PATRULLA'),
      this.parametros.obtenerEntero('TOPE_SALIDAS_PESADAS'),
      this.parametros.obtenerDecimal('JORNADA_MAXIMA_HORAS'),
      this.parametros.obtenerTexto('HORA_TURNO_DIURNO_INICIO'),
      this.parametros.obtenerTexto('HORA_TURNO_DIURNO_FIN'),
      this.parametros.obtenerTexto('HORA_TURNO_NOCTURNO_INICIO'),
      this.parametros.obtenerTexto('HORA_TURNO_NOCTURNO_FIN'),
      this.parametros.obtenerTexto('HORA_NOMBRAMIENTO_INICIO'),
      this.parametros.obtenerTexto('HORA_NOMBRAMIENTO_FIN'),
    ]);

    return {
      diasDescansoPatrulla,
      topeSalidasPesadas,
      jornadaMaximaHoras,
      // Ventanas de los turnos de la cobertura de Instrucción (RN de cobertura).
      ventanaDiurna: { inicio: diurnoInicio, fin: diurnoFin },
      ventanaNocturna: { inicio: nocturnoInicio, fin: nocturnoFin },
      // Jornada del personal de nombramiento (RN-26): fuera de ella no se asigna.
      ventanaNombramiento: { inicio: nombramientoInicio, fin: nombramientoFin },
    };
  }

  /**
   * Umbrales y pesos del índice de fatiga, de `t_parametro_politica` (regla 2). Cambiar
   * `FATIGA_UMBRAL_*` o los `PESO_*` calibra el semáforo sin recompilar.
   */
  private async umbralesFatiga(): Promise<UmbralesFatiga> {
    const [
      umbralAmbar,
      umbralRojo,
      pesoHorasDia,
      pesoCargaPeriodo,
      pesoSalidasPesadas,
      pesoPatrullaReciente,
    ] = await Promise.all([
      this.parametros.obtenerDecimal('FATIGA_UMBRAL_AMBAR'),
      this.parametros.obtenerDecimal('FATIGA_UMBRAL_ROJO'),
      this.parametros.obtenerDecimal('PESO_HORAS_DIA'),
      this.parametros.obtenerDecimal('PESO_CARGA_PERIODO'),
      this.parametros.obtenerDecimal('PESO_SALIDAS_PESADAS'),
      this.parametros.obtenerDecimal('PESO_PATRULLA_RECIENTE'),
    ]);

    return {
      umbralAmbar,
      umbralRojo,
      pesoHorasDia,
      pesoCargaPeriodo,
      pesoSalidasPesadas,
      pesoPatrullaReciente,
    };
  }

  /**
   * SEÑAL DE EQUIDAD. Banda (fracción) alrededor de la cuota justa dentro de la cual la carga se
   * considera EQUILIBRADA, de `EQUIDAD_MARGEN` (regla 2). Fuera de ella, la persona queda por
   * DEBAJO o por ENCIMA de su parte. Es distinta de los umbrales de fatiga (seguridad): esto mide
   * reparto. La usa `PersonalElegibleService` sobre el grupo completo de elegibles.
   */
  async margenEquidad(): Promise<number> {
    return this.parametros.obtenerDecimal('EQUIDAD_MARGEN');
  }

  /**
   * Deriva lo que la política necesita saber de la asignación.
   *
   * `esNocturno` NO llega del que pregunta: se calcula aquí con la franja configurada.
   * Si lo aportara el llamador, cada submódulo tendría su propia idea de qué es la
   * noche, y RN-43 dejaría de ser una sola regla.
   */
  private async componerContexto(
    contexto: ContextoOperativo,
    rango: RangoHorario,
  ): Promise<ContextoAsignacion> {
    const franja = {
      inicio: await this.parametros.obtenerTexto('FRANJA_NOCTURNA_INICIO'),
      fin: await this.parametros.obtenerTexto('FRANJA_NOCTURNA_FIN'),
    };

    return {
      fecha: contexto.fecha,
      rango,
      esPatrulla: contexto.esPatrulla,
      esNocturno: rango.esNocturno(franja),
      esFinDeSemana: esFinDeSemana(contexto.fecha),
    };
  }

  private async reunirAntecedentes(
    funcionarioIds: number[],
    // Solo necesita la fecha y, al editar, el operativo que no debe contarse. NO el rango: el
    // horario lo usa el veredicto, no los antecedentes. Así `calcularCargas` puede reunirlos sin
    // horario (la lista de elegibles del registro se pide sin él).
    contexto: { fecha: Date; operativoId?: number },
  ): Promise<Map<number, AntecedentesPersona>> {
    const periodo = await this.periodoDeComputo(contexto.fecha);

    const [personas, ausencias, asignaciones, patrullas, salidas, turnos] =
      await Promise.all([
        this.repositorio.buscarFuncionarios(funcionarioIds),
        this.repositorio.ausenciasEnFecha(funcionarioIds, contexto.fecha),
        this.repositorio.asignacionesDelDia(
          funcionarioIds,
          contexto.fecha,
          contexto.operativoId,
        ),
        this.repositorio.ultimasPatrullas(funcionarioIds, contexto.fecha),
        this.repositorio.salidasPesadasEnPeriodo(
          funcionarioIds,
          periodo.desde,
          periodo.hasta,
        ),
        this.repositorio.turnosEnFecha(funcionarioIds, contexto.fecha),
      ]);

    const porPersona = new Map<number, AsignacionDelDia[]>();
    for (const asignacion of asignaciones) {
      const previas = porPersona.get(asignacion.funcionarioId) ?? [];
      previas.push(asignacion);
      porPersona.set(asignacion.funcionarioId, previas);
    }

    return new Map(
      personas.map((persona) => [
        persona.id,
        {
          nombre: `${persona.apellidos} ${persona.nombres}`,
          tipoContrato: persona.tipoContrato,
          ausencia: ausencias.get(persona.id),
          turnoCobertura: turnos.get(persona.id),
          ultimaPatrulla: patrullas.get(persona.id) ?? null,
          salidasPesadas: salidas.get(persona.id) ?? 0,
          asignacionesDelDia: (porPersona.get(persona.id) ?? []).map(
            (asignacion) => ({
              identificador: asignacion.identificador,
              rango: RangoHorario.de(asignacion.horaInicio, asignacion.horaFin),
              horas: asignacion.horas,
            }),
          ),
        },
      ]),
    );
  }

  /**
   * RN-37. Ventana sobre la que se cuentan las salidas pesadas.
   *
   * SE INTERPRETA COMO PERÍODO DE CALENDARIO y no como ventana deslizante: «mensual»
   * significa el mes en curso, no los últimos treinta días. Es la lectura natural de
   * los tres valores que admite el parámetro —SEMANAL, QUINCENAL, MENSUAL—, todos
   * nombres de períodos del calendario, y la que permite al funcionario saber cuándo
   * se le renueva el cupo. Queda anotado en M12_POLITICAS_DESCANSO.md §8 por si el
   * Product Owner prefiere la ventana deslizante.
   */
  private async periodoDeComputo(
    fecha: Date,
  ): Promise<{ desde: Date; hasta: Date }> {
    return this.rangoDelPeriodo(
      await this.parametros.obtenerTexto('PERIODO_COMPUTO_SALIDAS'),
      fecha,
    );
  }

  /**
   * Ventana de EQUIDAD sobre la que se acumula la carga (2026-09-25), del parámetro
   * `PERIODO_EQUIDAD` (SEMANAL por omisión). Es un período de calendario, igual que RN-37.
   */
  private async periodoDeEquidad(
    fecha: Date,
  ): Promise<{ desde: Date; hasta: Date }> {
    return this.rangoDelPeriodo(
      await this.parametros.obtenerTexto('PERIODO_EQUIDAD'),
      fecha,
    );
  }

  /**
   * El rango de calendario de un período nombrado (SEMANAL, QUINCENAL o MENSUAL) que contiene la
   * fecha. Lo comparten el cómputo de salidas (RN-37) y la equidad de carga. «Mensual» es el mes
   * en curso, no los últimos treinta días.
   */
  private rangoDelPeriodo(
    periodo: string,
    fecha: Date,
  ): { desde: Date; hasta: Date } {
    const anio = fecha.getUTCFullYear();
    const mes = fecha.getUTCMonth();
    const dia = fecha.getUTCDate();

    if (periodo === 'SEMANAL') {
      // Semana ISO: de lunes a domingo.
      const diaSemana = (fecha.getUTCDay() + 6) % 7;
      const lunes = new Date(Date.UTC(anio, mes, dia - diaSemana));
      return {
        desde: lunes,
        hasta: new Date(Date.UTC(anio, mes, dia - diaSemana + 6)),
      };
    }

    if (periodo === 'QUINCENAL') {
      return dia <= 15
        ? {
            desde: new Date(Date.UTC(anio, mes, 1)),
            hasta: new Date(Date.UTC(anio, mes, 15)),
          }
        : {
            desde: new Date(Date.UTC(anio, mes, 16)),
            hasta: new Date(Date.UTC(anio, mes + 1, 0)),
          };
    }

    return {
      desde: new Date(Date.UTC(anio, mes, 1)),
      hasta: new Date(Date.UTC(anio, mes + 1, 0)),
    };
  }
}
