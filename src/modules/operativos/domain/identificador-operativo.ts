/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Objetos de valor del dominio
 * Archivo: identificador-operativo.ts
 * Responsabilidad: Componer y leer el código institucional de un operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * RN-09 a RN-12. El identificador se genera, nunca se digita: nació de un problema
 * concreto que el Product Owner describió así —«al escribirlo a mano me equivoco en el
 * año y en el secuencial»—.
 *
 * FORMATO: `ICNECU-001-31-JUL-2026`
 *          prefijo · secuencial de tres cifras · día · mes · año
 *
 * La forma sale de los mockups aprobados de FASE5 §5.3 y §9.6, no de una suposición.
 * El prefijo lo aporta el formulario y puede depender del área del personal —el
 * formulario 8 usa `IG` o `IT`—, de ahí que llegue como dato y no se deduzca aquí.
 *
 * QUÉ NO HACE ESTE OBJETO. No decide el secuencial. RN-12 exige que se reinicie cada
 * día y que dos registros simultáneos no colisionen, y eso solo puede garantizarlo la
 * base dentro de una transacción (VAL-32). Aquí se compone lo que se recibe; el
 * repositorio de M-14 es quien lo obtiene.
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';

/**
 * Meses en la abreviatura castellana de tres letras que usan los mockups.
 *
 * No se derivan con `Intl`: en español devuelve «ene.» con punto y «sept» con cuatro
 * letras, que rompería el formato aprobado. La tabla explícita es la única forma de
 * que el código impreso en una orden de servicio sea siempre el mismo.
 */
const MESES = [
  'ENE',
  'FEB',
  'MAR',
  'ABR',
  'MAY',
  'JUN',
  'JUL',
  'AGO',
  'SEP',
  'OCT',
  'NOV',
  'DIC',
];

/** `fpre_prefijo` admite doce caracteres. Solo letras: son siglas institucionales. */
const PATRON_PREFIJO = /^[A-Z]{1,12}$/;

const SECUENCIAL_MINIMO = 1;
const SECUENCIAL_MAXIMO = 999;
const CIFRAS_SECUENCIAL = 3;

const PATRON_COMPLETO = /^([A-Z]{1,12})-(\d{3})-(\d{2})-([A-Z]{3})-(\d{4})$/;

export class IdentificadorOperativo {
  /**
   * La fecha se guarda como COPIA y no se expone.
   *
   * `readonly` impide reasignar la referencia, no mutar el objeto: con la fecha
   * pública, `identificador.fecha.setFullYear(1999)` cambiaba un objeto de valor desde
   * fuera, y con él el código impreso en una orden de servicio ya emitida. Se accede
   * por `fechaOperativa`, que devuelve otra copia.
   */
  private readonly fecha: Date;

  private constructor(
    readonly prefijo: string,
    readonly secuencial: number,
    fecha: Date,
  ) {
    this.fecha = new Date(fecha.getTime());
  }

  /**
   * Compone el identificador de un operativo.
   *
   * @param prefijo sigla del formulario, y del área cuando el formulario la distingue
   * @param secuencial número del operativo dentro de la jornada, que reinicia cada día
   * @param fecha jornada del operativo, **no** el momento del registro
   */
  static componer(
    prefijo: string,
    secuencial: number,
    fecha: Date,
  ): IdentificadorOperativo {
    if (!PATRON_PREFIJO.test(prefijo)) {
      throw new ValidacionError(
        `El prefijo «${prefijo}» no es una sigla válida: se escribe en mayúsculas, de una a doce letras.`,
        { prefijo },
      );
    }

    if (
      !Number.isInteger(secuencial) ||
      secuencial < SECUENCIAL_MINIMO ||
      secuencial > SECUENCIAL_MAXIMO
    ) {
      throw new ValidacionError(
        `El secuencial del operativo va de ${SECUENCIAL_MINIMO} a ${SECUENCIAL_MAXIMO}. Recibido: ${secuencial}.`,
        { secuencial },
      );
    }

    if (Number.isNaN(fecha.getTime())) {
      throw new ValidacionError(
        'La fecha del operativo no es una fecha válida.',
        {},
      );
    }

    return new IdentificadorOperativo(prefijo, secuencial, fecha);
  }

  /**
   * Lee un identificador ya compuesto.
   *
   * Hace falta para las órdenes de servicio y la matriz, que reciben el código como
   * texto y necesitan volver a su fecha sin consultar la base.
   */
  static desde(texto: string): IdentificadorOperativo {
    const partes = PATRON_COMPLETO.exec(texto);

    if (!partes) {
      throw new ValidacionError(
        `«${texto}» no tiene la forma de un identificador de operativo, que es PREFIJO-000-DD-MES-AAAA.`,
        { texto },
      );
    }

    const [, prefijo, secuencial, dia, mes, anio] = partes;
    const indiceMes = MESES.indexOf(mes);

    if (indiceMes === -1) {
      throw new ValidacionError(
        `«${mes}» no es un mes reconocido. Los meses se escriben ${MESES.join(', ')}.`,
        { texto },
      );
    }

    const fecha = new Date(Number(anio), indiceMes, Number(dia));

    // Una fecha imposible —el 31 de febrero— se desborda al mes siguiente en lugar de
    // fallar. Se comprueba que la fecha compuesta sea la que se pidió.
    if (fecha.getDate() !== Number(dia) || fecha.getMonth() !== indiceMes) {
      throw new ValidacionError(
        `El identificador «${texto}» contiene una fecha que no existe.`,
        { texto },
      );
    }

    return new IdentificadorOperativo(prefijo, Number(secuencial), fecha);
  }

  /** Día de la jornada, sin la hora. */
  get fechaOperativa(): Date {
    return new Date(
      this.fecha.getFullYear(),
      this.fecha.getMonth(),
      this.fecha.getDate(),
    );
  }

  equivaleA(otro: IdentificadorOperativo): boolean {
    return this.toString() === otro.toString();
  }

  toString(): string {
    const secuencial = String(this.secuencial).padStart(CIFRAS_SECUENCIAL, '0');
    const dia = String(this.fecha.getDate()).padStart(2, '0');
    const mes = MESES[this.fecha.getMonth()];
    const anio = this.fecha.getFullYear();

    return `${this.prefijo}-${secuencial}-${dia}-${mes}-${anio}`;
  }
}
