/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Objetos de valor del dominio
 * Archivo: rango-horario.ts
 * Responsabilidad: Representar el horario de un operativo y responder sobre él.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES EL ARCHIVO DE MAYOR RIESGO DEL SISTEMA.
 *
 * Un defecto aquí no produce un error visible: produce un funcionario asignado a
 * dieciséis horas seguidas, o dos operativos que se cruzan sin que nadie lo advierta.
 * El análisis lo dice sin rodeos: «la lógica de solapamiento con cruce de medianoche
 * es la fuente de error más probable en todo el sistema» (FASE3, OV-02).
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * LA DECISIÓN QUE ELIMINA EL RIESGO. Un horario que cruza la medianoche —22H00 a
 * 02H00— tiene la hora de fin MENOR que la de inicio. Comparar esas dos cadenas o esos
 * dos números da resultados silenciosamente incorrectos, y ese es el defecto que se
 * repite en cada validación que lo intenta por su cuenta.
 *
 * Aquí el rango se descompone UNA sola vez en intervalos de un día ordinario:
 *
 *     08:00–16:30  →  [(480, 990)]
 *     22:00–02:00  →  [(1320, 1440), (0, 120)]
 *
 * Y a partir de ahí, tanto el solapamiento como la condición nocturna son la MISMA
 * operación: ¿se cortan dos conjuntos de intervalos? Una sola aritmética, probada una
 * vez, en lugar de dos razonamientos parecidos escritos en sitios distintos.
 *
 * NO DEPENDE DE NADA. Ni de Prisma, ni de NestJS, ni de la configuración. La franja
 * nocturna LLEGA COMO PARÁMETRO: la fijan `FRANJA_NOCTURNA_INICIO` y
 * `FRANJA_NOCTURNA_FIN` de M-06, y quien construye el objeto los pasa. Si este archivo
 * los leyera, el umbral volvería a ser una constante escondida.
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';

/** RN-07. Horas completas y medias horas, nada más. */
const PATRON_HORA_OPERATIVA = /^([01][0-9]|2[0-3]):(00|30)$/;

const MINUTOS_POR_DIA = 1440;
const MINUTOS_POR_HORA = 60;

/** Intervalo semiabierto `[desde, hasta)` en minutos desde la medianoche. */
interface Intervalo {
  desde: number;
  hasta: number;
}

/** Franja horaria que activa el condicionante nocturno. RN-43. */
export interface FranjaNocturna {
  inicio: string;
  fin: string;
}

export class RangoHorario {
  private readonly intervalos: Intervalo[];

  private constructor(
    readonly horaInicio: string,
    readonly horaFin: string,
  ) {
    this.intervalos = descomponer(aMinutos(horaInicio), aMinutos(horaFin));
  }

  /**
   * Construye el rango comprobando las reglas de forma.
   * @throws ValidacionError con un mensaje redactado para el funcionario.
   */
  static de(horaInicio: string, horaFin: string): RangoHorario {
    exigirFormato(horaInicio, 'de inicio');
    exigirFormato(horaFin, 'de fin');

    if (horaInicio === horaFin) {
      // No se puede decidir entre «duración cero» y «veinticuatro horas», y ninguna
      // de las dos es un operativo. Rechazar es la única respuesta honesta.
      throw new ValidacionError(
        `El horario ${institucional(horaInicio)} a ${institucional(horaFin)} no tiene duración. Indique una hora de fin distinta a la de inicio.`,
        { horaInicio, horaFin },
      );
    }

    return new RangoHorario(horaInicio, horaFin);
  }

  /**
   * La ENVOLVENTE de varias ventanas: el arco más corto que las cubre a todas (2026-09-08).
   *
   * Desde RN-66 el operativo ya no tiene horario propio: lo TOMA de las personas. Su ventana
   * es la más pequeña que contiene a todas, y se calcula sobre el mismo círculo de minutos que
   * el resto del archivo, así que respeta el cruce de medianoche sin un razonamiento aparte.
   *
   * EL ARCO MÍNIMO ES EL COMPLEMENTO DEL HUECO MÁS GRANDE. Se marcan en el círculo los minutos
   * que ocupa alguna persona, se busca el hueco libre más largo, y la envolvente es todo lo
   * demás. Con una sola persona el hueco es el resto del día y la envolvente es su propia
   * ventana; con dos turnos encadenados —06H00 a 14H00 y 14H00 a 22H00— el hueco es la
   * madrugada y la envolvente 06H00 a 22H00.
   *
   * NO decide si el operativo es nocturno: eso es «¿alguna persona lo es?» y se resuelve
   * persona a persona (D2), no sobre este arco, que podría cubrir una madrugada en la que
   * nadie trabaja.
   *
   * @throws ValidacionError si la lista está vacía o las ventanas cubren el día entero, que no
   * es un operativo.
   */
  static envolvente(rangos: RangoHorario[]): RangoHorario {
    if (rangos.length === 0) {
      throw new ValidacionError(
        'No hay horarios de los que tomar la ventana del operativo. Asigne al menos una persona con su horario.',
        {},
      );
    }

    const ocupados = fusionar(
      rangos
        .flatMap((rango) => rango.intervalos)
        .filter((intervalo) => intervalo.desde < intervalo.hasta),
    );

    if (
      ocupados.length === 1 &&
      ocupados[0].desde === 0 &&
      ocupados[0].hasta === MINUTOS_POR_DIA
    ) {
      throw new ValidacionError(
        'Los horarios de las personas cubren el día completo; eso no es un operativo.',
        {},
      );
    }

    const hueco = huecoMayor(ocupados);
    return RangoHorario.de(
      aHora(hueco.hasta % MINUTOS_POR_DIA),
      aHora(hueco.desde),
    );
  }

  /** La hora de fin es menor que la de inicio: el operativo termina al día siguiente. */
  get cruzaMedianoche(): boolean {
    return aMinutos(this.horaFin) < aMinutos(this.horaInicio);
  }

  /** Horas efectivas, contemplando el cruce de medianoche. */
  get duracionHoras(): number {
    const total = this.intervalos.reduce(
      (suma, intervalo) => suma + (intervalo.hasta - intervalo.desde),
      0,
    );
    return total / MINUTOS_POR_HORA;
  }

  /**
   * RN-28. Dos operativos de la misma persona no pueden cruzarse.
   *
   * Los intervalos son SEMIABIERTOS, y de ahí sale el caso 6 del plan: un operativo
   * de 08H00 a 12H00 y otro de 12H00 a 16H00 **no** se solapan. Terminar y empezar a
   * la misma hora es encadenar, no coincidir; tratarlo como solapamiento impediría la
   * jornada partida que el negocio sí practica.
   */
  seSolapaCon(otro: RangoHorario): boolean {
    return this.intervalos.some((propio) =>
      otro.intervalos.some((ajeno) => seCortan(propio, ajeno)),
    );
  }

  /**
   * RN-43. Si el horario toca la franja nocturna, aunque sea en parte.
   *
   * Basta tocarla: un operativo de 19H00 a 21H00 entra en la franja durante una hora
   * y esa hora ocurre de noche. Exigir que estuviera contenido dejaría fuera
   * precisamente los turnos que empiezan de tarde y terminan de noche.
   */
  esNocturno(franja: FranjaNocturna): boolean {
    exigirFormatoDeFranja(franja);

    const intervalosNocturnos = descomponer(
      aMinutos(franja.inicio),
      aMinutos(franja.fin),
    );

    return this.intervalos.some((propio) =>
      intervalosNocturnos.some((nocturno) => seCortan(propio, nocturno)),
    );
  }

  /** Igualdad por valor, que es lo propio de un objeto de valor. */
  equivaleA(otro: RangoHorario): boolean {
    return this.horaInicio === otro.horaInicio && this.horaFin === otro.horaFin;
  }

  /**
   * Si `otro` cae ENTERO dentro de este rango (2026-09-08). Lo usa el horario por persona:
   * la ventana propia de un asignado debe estar contenida en la del operativo. Trabaja sobre
   * los intervalos ya descompuestos, así que respeta el cruce de medianoche.
   */
  contiene(otro: RangoHorario): boolean {
    return otro.intervalos.every((sub) =>
      this.intervalos.some(
        (propio) => sub.desde >= propio.desde && sub.hasta <= propio.hasta,
      ),
    );
  }

  /**
   * Si ESTE rango cae ENTERO dentro de la ventana dada (2026-09-16). Lo usa la cobertura
   * por turnos de Instrucción: al asignar a alguien con turno diurno o nocturno, el horario
   * del operativo debe estar contenido en la ventana de ese turno.
   *
   * Es el espejo de `esNocturno` —misma aritmética de intervalos y mismo cruce de
   * medianoche del turno nocturno (17H30 a 02H00)— pero exige CONTENCIÓN total en vez de
   * mera intersección. La ventana llega de parámetros con su minuto libre, así que no se le
   * pide la granularidad de media hora que sí cumple el horario del operativo.
   */
  estaDentroDe(ventana: FranjaNocturna): boolean {
    exigirFormatoDeVentana(ventana);

    const intervalosVentana = descomponer(
      aMinutos(ventana.inicio),
      aMinutos(ventana.fin),
    );

    return this.intervalos.every((propio) =>
      intervalosVentana.some(
        (tramo) => propio.desde >= tramo.desde && propio.hasta <= tramo.hasta,
      ),
    );
  }

  /** Representación institucional: `18H00 A 23H30`. */
  toString(): string {
    return `${institucional(this.horaInicio)} A ${institucional(this.horaFin)}`;
  }
}

/**
 * Horas entre dos `HH:MM` de cualquier minuto, contemplando el cruce de medianoche (2026-10-14).
 *
 * Es para los TRAMOS de transporte, que no cumplen la granularidad de media hora del operativo
 * (un «dejar» dura un parámetro en minutos), y por eso no pasa por `RangoHorario.de`. Usa la
 * MISMA descomposición que el resto del archivo: no es una segunda aritmética. Inicio igual a fin
 * es duración cero (un tramo nunca dura el día entero).
 */
export function duracionEnHoras(horaInicio: string, horaFin: string): number {
  const inicio = aMinutos(horaInicio);
  const fin = aMinutos(horaFin);
  if (inicio === fin) return 0;
  const total = descomponer(inicio, fin).reduce(
    (suma, intervalo) => suma + (intervalo.hasta - intervalo.desde),
    0,
  );
  return total / MINUTOS_POR_HORA;
}

// ─────────────────────────── Aritmética interna ───────────────────────────

/**
 * Convierte el rango en los intervalos que ocupa dentro de un día ordinario.
 * Un rango que cruza la medianoche ocupa dos: el final del día y el principio.
 */
function descomponer(inicio: number, fin: number): Intervalo[] {
  if (inicio < fin) return [{ desde: inicio, hasta: fin }];

  return [
    { desde: inicio, hasta: MINUTOS_POR_DIA },
    { desde: 0, hasta: fin },
  ];
}

/** Intersección de intervalos semiabiertos. */
function seCortan(uno: Intervalo, otro: Intervalo): boolean {
  return uno.desde < otro.hasta && otro.desde < uno.hasta;
}

/**
 * Fusiona intervalos que se solapan o se tocan en una lista ordenada y sin huecos internos.
 * Base de `RangoHorario.envolvente`: sobre los minutos ya ocupados es donde se busca el hueco.
 */
function fusionar(intervalos: Intervalo[]): Intervalo[] {
  if (intervalos.length === 0) return [];

  const orden = [...intervalos].sort(
    (uno, otro) => uno.desde - otro.desde || uno.hasta - otro.hasta,
  );
  const fusion: Intervalo[] = [{ ...orden[0] }];

  for (const actual of orden.slice(1)) {
    const ultimo = fusion[fusion.length - 1];
    if (actual.desde <= ultimo.hasta) {
      ultimo.hasta = Math.max(ultimo.hasta, actual.hasta);
    } else {
      fusion.push({ ...actual });
    }
  }
  return fusion;
}

/**
 * El hueco libre más largo entre los minutos ocupados, mirando el día como un círculo: el
 * hueco tras el último intervalo da la vuelta hasta el primero. Su complemento es la
 * envolvente. `ocupados` llega fusionado y ordenado.
 */
function huecoMayor(ocupados: Intervalo[]): Intervalo {
  let mayor: Intervalo = { desde: 0, hasta: 0 };
  let maxLongitud = -1;

  for (let i = 0; i < ocupados.length; i++) {
    const finDelHueco =
      i + 1 < ocupados.length
        ? ocupados[i + 1].desde
        : ocupados[0].desde + MINUTOS_POR_DIA;
    const longitud = finDelHueco - ocupados[i].hasta;
    if (longitud > maxLongitud) {
      maxLongitud = longitud;
      mayor = { desde: ocupados[i].hasta, hasta: finDelHueco };
    }
  }
  return mayor;
}

/** Minutos desde la medianoche a `HH:MM`. El minuto 1440 (fin de día) se escribe `00:00`. */
function aHora(minutos: number): string {
  const t = minutos % MINUTOS_POR_DIA;
  const horas = Math.floor(t / MINUTOS_POR_HORA);
  const restantes = t % MINUTOS_POR_HORA;
  return `${String(horas).padStart(2, '0')}:${String(restantes).padStart(2, '0')}`;
}

function aMinutos(hora: string): number {
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * MINUTOS_POR_HORA + minutos;
}

function institucional(hora: string): string {
  return hora.replace(':', 'H');
}

function exigirFormato(hora: string, cual: string): void {
  if (!PATRON_HORA_OPERATIVA.test(hora)) {
    throw new ValidacionError(
      `La hora ${cual} debe ser una hora en punto o y media, escrita como HH:MM. Recibido: «${hora}».`,
      { hora },
    );
  }
}

/**
 * La franja llega de los parámetros de política, que ya la validan al guardarse. Se
 * comprueba igualmente: si alguna vez llegara mal, el operativo dejaría de ser
 * nocturno en silencio y el condicionante de conductor no se aplicaría.
 */
function exigirFormatoDeFranja(franja: FranjaNocturna): void {
  const patronLibre = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

  if (!patronLibre.test(franja.inicio) || !patronLibre.test(franja.fin)) {
    throw new ValidacionError(
      'La franja nocturna configurada no tiene un horario válido. Revise los parámetros FRANJA_NOCTURNA_INICIO y FRANJA_NOCTURNA_FIN.',
      { franja },
    );
  }
}

/**
 * La ventana de un turno de la cobertura llega de parámetros, ya validados al guardarse.
 * Se comprueba igual: si llegara mal, la asignación de Instrucción fallaría en silencio.
 */
function exigirFormatoDeVentana(ventana: FranjaNocturna): void {
  const patronLibre = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

  if (!patronLibre.test(ventana.inicio) || !patronLibre.test(ventana.fin)) {
    throw new ValidacionError(
      'El horario de un turno de la cobertura no es válido. Revise los parámetros HORA_TURNO_DIURNO_INICIO/FIN y HORA_TURNO_NOCTURNO_INICIO/FIN.',
      { ventana },
    );
  }
}
