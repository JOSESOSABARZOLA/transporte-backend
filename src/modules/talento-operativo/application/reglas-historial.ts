/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Historial de jornada
 * Archivo: reglas-historial.ts
 * Responsabilidad: Consolidar los operativos de una jornada en una fila por persona.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Funciones puras: no tocan la base ni el contenedor. Reciben lo que ocurrió ese día y
 * devuelven lo que hay que guardar.
 *
 * EL FIN DE SEMANA SE CALCULA EN UTC, Y NO EN `America/Guayaquil`. Parece lo contrario
 * de lo que exige RT-03, y por eso conviene dejarlo escrito: `hist_fecha` y
 * `cuad_fecha` son columnas `@db.Date`, sin hora ni zona, que llegan como medianoche
 * UTC. Preguntarle a esa fecha por su día de la semana en Guayaquil —UTC-5— devolvería
 * las 19H00 del día ANTERIOR, y un operativo del sábado se contaría como viernes: la
 * persona sumaría una salida de fin de semana menos de las que hizo.
 *
 * La zona horaria importa cuando se compara un INSTANTE con una hora de reloj —las
 * ventanas de carga, la franja nocturna—. Una fecha de calendario no es un instante.
 */

const SABADO = 6;
const DOMINGO = 0;

/** Lo que aportó un operativo a la jornada de una persona. */
export interface AporteOperativo {
  funcionarioId: number;
  /** `oper_duracion_horas`, ya calculada por el dominio al registrar. */
  horas: number;
  /** `form_es_patrulla` del formulario del operativo. RN-24. */
  esPatrulla: boolean;
  /** `oper_es_nocturno`, derivado de la franja nocturna. RN-25. */
  esNocturno: boolean;
}

/** Una fila de `t_historial_jornada`, antes de guardarse. */
export interface JornadaConsolidada {
  funcionarioId: number;
  fuePatrulla: boolean;
  fueNocturna: boolean;
  fueFinSemana: boolean;
  horasJornada: number;
  operativos: number;
}

/** RN-25. Sábado o domingo, leídos de una fecha de calendario. */
export function esFinDeSemana(fecha: Date): boolean {
  const dia = fecha.getUTCDay();
  return dia === SABADO || dia === DOMINGO;
}

/**
 * Agrupa los aportes del día en una fila por persona.
 *
 * SUMA HORAS Y ACUMULA BANDERAS POR SEPARADO. Quien sale dos veces el mismo día suma
 * las dos duraciones —es lo que RN-36 controla como jornada máxima— pero le basta UNA
 * salida en patrulla para que el día entero cuente como patrulla: RN-24 pregunta si
 * salió, no cuántas veces.
 *
 * @param aportes lo que cada operativo del día aportó a cada persona
 * @param fecha jornada del cuadro, que fija el fin de semana para todas las filas
 */
export function consolidar(
  aportes: AporteOperativo[],
  fecha: Date,
): JornadaConsolidada[] {
  const finDeSemana = esFinDeSemana(fecha);
  const porPersona = new Map<number, JornadaConsolidada>();

  for (const aporte of aportes) {
    const acumulado = porPersona.get(aporte.funcionarioId) ?? {
      funcionarioId: aporte.funcionarioId,
      fuePatrulla: false,
      fueNocturna: false,
      fueFinSemana: finDeSemana,
      horasJornada: 0,
      operativos: 0,
    };

    acumulado.fuePatrulla = acumulado.fuePatrulla || aporte.esPatrulla;
    acumulado.fueNocturna = acumulado.fueNocturna || aporte.esNocturno;
    acumulado.horasJornada = redondear(acumulado.horasJornada + aporte.horas);
    acumulado.operativos += 1;

    porPersona.set(aporte.funcionarioId, acumulado);
  }

  return [...porPersona.values()];
}

/**
 * `hist_horas_jornada` es `DECIMAL(4,1)`: una sola cifra decimal.
 *
 * Sumar medias horas en coma flotante produce 8.399999999999999, que la base
 * rechazaría o truncaría en silencio. Se redondea aquí, donde se sabe por qué.
 */
function redondear(horas: number): number {
  return Math.round(horas * 10) / 10;
}
