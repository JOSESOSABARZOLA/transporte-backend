/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Objetos de valor del dominio
 * Archivo: rango-horario.spec.ts
 * Responsabilidad: Los ocho casos obligatorios del plan, y todo lo que los rodea.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * La guía §17 declara esta prueba OBLIGATORIA y el plan añade que el módulo «no se da
 * por terminado sin que sus ocho pruebas pasen». Un fallo aquí no rompe el sistema:
 * asigna a una persona dieciséis horas seguidas.
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';
import {
  duracionEnHoras,
  RangoHorario,
  type FranjaNocturna,
} from './rango-horario';

/** La franja llega de los parámetros de política, no de una constante del dominio. */
const FRANJA: FranjaNocturna = { inicio: '20:00', fin: '05:00' };

describe('RangoHorario · los ocho casos obligatorios', () => {
  it('caso 1 · rango normal 08:00–16:30: válido, 8,5 horas, no nocturno', () => {
    const rango = RangoHorario.de('08:00', '16:30');

    expect(rango.duracionHoras).toBe(8.5);
    expect(rango.cruzaMedianoche).toBe(false);
    expect(rango.esNocturno(FRANJA)).toBe(false);
  });

  it('caso 2 · cruce de medianoche 22:00–02:00: válido, 4 horas, nocturno', () => {
    const rango = RangoHorario.de('22:00', '02:00');

    expect(rango.duracionHoras).toBe(4);
    expect(rango.cruzaMedianoche).toBe(true);
    expect(rango.esNocturno(FRANJA)).toBe(true);
  });

  it('caso 3 · solapamiento parcial 08:00–12:00 con 11:00–15:00: detectado', () => {
    const uno = RangoHorario.de('08:00', '12:00');
    const otro = RangoHorario.de('11:00', '15:00');

    expect(uno.seSolapaCon(otro)).toBe(true);
    expect(otro.seSolapaCon(uno)).toBe(true);
  });

  it('caso 4 · solapamiento con cruce 22:00–02:00 con 01:00–05:00: DETECTADO', () => {
    const nocturno = RangoHorario.de('22:00', '02:00');
    const madrugada = RangoHorario.de('01:00', '05:00');

    expect(nocturno.seSolapaCon(madrugada)).toBe(true);
    expect(madrugada.seSolapaCon(nocturno)).toBe(true);
  });

  it('caso 5 · contención 08:00–18:00 con 10:00–12:00: detectado', () => {
    const jornada = RangoHorario.de('08:00', '18:00');
    const dentro = RangoHorario.de('10:00', '12:00');

    expect(jornada.seSolapaCon(dentro)).toBe(true);
    expect(dentro.seSolapaCon(jornada)).toBe(true);
  });

  it('caso 6 · adyacencia 08:00–12:00 con 12:00–16:00: NO se solapan', () => {
    const manana = RangoHorario.de('08:00', '12:00');
    const tarde = RangoHorario.de('12:00', '16:00');

    expect(manana.seSolapaCon(tarde)).toBe(false);
    expect(tarde.seSolapaCon(manana)).toBe(false);
  });

  it('caso 7 · franja nocturna tocada parcialmente 19:00–21:00: es nocturno', () => {
    expect(RangoHorario.de('19:00', '21:00').esNocturno(FRANJA)).toBe(true);
  });

  it('caso 8 · franja nocturna contenida 21:00–23:00: es nocturno', () => {
    expect(RangoHorario.de('21:00', '23:00').esNocturno(FRANJA)).toBe(true);
  });
});

describe('RangoHorario · granularidad de treinta minutos (RN-07)', () => {
  it('caso 9 del plan · rechaza 08:15', () => {
    expect(() => RangoHorario.de('08:15', '12:00')).toThrow(ValidacionError);
  });

  it('admite las horas en punto y las medias', () => {
    expect(() => RangoHorario.de('08:00', '12:30')).not.toThrow();
    expect(() => RangoHorario.de('00:30', '23:30')).not.toThrow();
  });

  it('rechaza una hora que no existe', () => {
    expect(() => RangoHorario.de('24:00', '02:00')).toThrow(ValidacionError);
  });

  it('rechaza un texto que no es una hora, diciendo cuál recibió', () => {
    try {
      RangoHorario.de('08:00', '8 de la noche');
      fail('debió rechazarlo');
    } catch (error) {
      expect((error as ValidacionError).message).toContain('8 de la noche');
      expect((error as ValidacionError).message).toContain('de fin');
    }
  });

  it('rechaza el rango sin duración', () => {
    expect(() => RangoHorario.de('08:00', '08:00')).toThrow(ValidacionError);
  });
});

describe('RangoHorario · duración', () => {
  it('cuenta las medias horas', () => {
    expect(RangoHorario.de('07:30', '08:00').duracionHoras).toBe(0.5);
  });

  it('cuenta bien la jornada que termina de madrugada', () => {
    // 18H00 a 23H30 es el horario del ejemplo de las órdenes de servicio.
    expect(RangoHorario.de('18:00', '23:30').duracionHoras).toBe(5.5);
    expect(RangoHorario.de('20:00', '05:00').duracionHoras).toBe(9);
    expect(RangoHorario.de('23:30', '00:00').duracionHoras).toBe(0.5);
  });

  it('nunca da una duración negativa ni superior a un día', () => {
    const horas = ['00:00', '06:30', '12:00', '18:30', '23:30'];

    for (const inicio of horas) {
      for (const fin of horas) {
        if (inicio === fin) continue;
        const duracion = RangoHorario.de(inicio, fin).duracionHoras;
        expect(duracion).toBeGreaterThan(0);
        expect(duracion).toBeLessThanOrEqual(24);
      }
    }
  });
});

describe('RangoHorario · solapamiento, casos que no están en el plan', () => {
  it('un rango se solapa consigo mismo', () => {
    const rango = RangoHorario.de('08:00', '12:00');
    expect(rango.seSolapaCon(RangoHorario.de('08:00', '12:00'))).toBe(true);
  });

  it('dos rangos que cruzan la medianoche se solapan entre sí', () => {
    const uno = RangoHorario.de('22:00', '03:00');
    const otro = RangoHorario.de('23:00', '02:00');
    expect(uno.seSolapaCon(otro)).toBe(true);
  });

  it('adyacencia sobre la medianoche: 22:00–00:00 y 00:00–06:00 no se solapan', () => {
    const noche = RangoHorario.de('22:00', '00:00');
    const madrugada = RangoHorario.de('00:00', '06:00');
    expect(noche.seSolapaCon(madrugada)).toBe(false);
  });

  it('un rango diurno y otro nocturno que no se tocan', () => {
    const diurno = RangoHorario.de('08:00', '16:00');
    const nocturno = RangoHorario.de('22:00', '02:00');
    expect(diurno.seSolapaCon(nocturno)).toBe(false);
  });

  it('el solapamiento es simétrico en todas las combinaciones', () => {
    const rangos = [
      RangoHorario.de('08:00', '12:00'),
      RangoHorario.de('11:30', '15:00'),
      RangoHorario.de('22:00', '02:00'),
      RangoHorario.de('01:00', '05:00'),
      RangoHorario.de('12:00', '18:00'),
    ];

    for (const uno of rangos) {
      for (const otro of rangos) {
        expect(uno.seSolapaCon(otro)).toBe(otro.seSolapaCon(uno));
      }
    }
  });
});

describe('RangoHorario · condición nocturna (RN-43)', () => {
  it('el límite exacto no cuenta: 18:00–20:00 no es nocturno', () => {
    // Termina justo cuando empieza la franja. El intervalo es semiabierto, igual que
    // en el solapamiento: encadenar no es coincidir.
    expect(RangoHorario.de('18:00', '20:00').esNocturno(FRANJA)).toBe(false);
  });

  it('media hora dentro de la franja ya cuenta', () => {
    expect(RangoHorario.de('19:30', '20:30').esNocturno(FRANJA)).toBe(true);
  });

  it('la madrugada dentro de la franja cuenta', () => {
    expect(RangoHorario.de('02:00', '06:00').esNocturno(FRANJA)).toBe(true);
    expect(RangoHorario.de('05:00', '09:00').esNocturno(FRANJA)).toBe(false);
  });

  it('la franja es un parámetro: si el negocio la mueve, el resultado cambia', () => {
    const rango = RangoHorario.de('18:30', '19:30');

    expect(rango.esNocturno({ inicio: '20:00', fin: '05:00' })).toBe(false);
    expect(rango.esNocturno({ inicio: '18:00', fin: '06:00' })).toBe(true);
  });

  it('avisa si la franja configurada no es una hora válida', () => {
    expect(() =>
      RangoHorario.de('20:00', '23:00').esNocturno({
        inicio: '8pm',
        fin: '05:00',
      }),
    ).toThrow(ValidacionError);
  });
});

describe('RangoHorario · comportamiento de objeto de valor', () => {
  it('compara por valor, no por identidad', () => {
    const uno = RangoHorario.de('08:00', '12:00');
    const otro = RangoHorario.de('08:00', '12:00');

    expect(uno).not.toBe(otro);
    expect(uno.equivaleA(otro)).toBe(true);
  });

  it('se representa como lo escribe el cuadro', () => {
    expect(RangoHorario.de('18:00', '23:30').toString()).toBe('18H00 A 23H30');
  });
});

describe('RangoHorario · contención (horario por persona, 2026-09-08)', () => {
  it('una ventana interior está contenida, y sus bordes también', () => {
    const operativo = RangoHorario.de('07:00', '22:00');

    expect(operativo.contiene(RangoHorario.de('09:00', '18:00'))).toBe(true);
    expect(operativo.contiene(RangoHorario.de('07:00', '22:00'))).toBe(true);
    expect(operativo.contiene(RangoHorario.de('07:00', '16:00'))).toBe(true);
  });

  it('una ventana que se sale por cualquier extremo no está contenida', () => {
    const operativo = RangoHorario.de('09:00', '18:00');

    expect(operativo.contiene(RangoHorario.de('07:00', '18:00'))).toBe(false);
    expect(operativo.contiene(RangoHorario.de('09:00', '20:00'))).toBe(false);
  });

  it('respeta el cruce de medianoche del operativo', () => {
    const operativo = RangoHorario.de('22:00', '06:00');

    expect(operativo.contiene(RangoHorario.de('23:00', '02:00'))).toBe(true);
    expect(operativo.contiene(RangoHorario.de('20:00', '02:00'))).toBe(false);
  });
});

describe('RangoHorario · dentro de la ventana de un turno (cobertura, 2026-09-16)', () => {
  const DIURNO: FranjaNocturna = { inicio: '08:00', fin: '16:30' };
  const NOCTURNO: FranjaNocturna = { inicio: '17:30', fin: '02:00' };

  it('un operativo dentro de la ventana diurna cae dentro; los bordes también', () => {
    expect(RangoHorario.de('08:00', '16:30').estaDentroDe(DIURNO)).toBe(true);
    expect(RangoHorario.de('09:00', '12:00').estaDentroDe(DIURNO)).toBe(true);
  });

  it('un operativo que se sale de la ventana diurna no cae dentro', () => {
    expect(RangoHorario.de('17:00', '19:00').estaDentroDe(DIURNO)).toBe(false);
    expect(RangoHorario.de('08:00', '17:00').estaDentroDe(DIURNO)).toBe(false);
  });

  it('la ventana nocturna cruza la medianoche y contempla la madrugada', () => {
    expect(RangoHorario.de('18:00', '23:00').estaDentroDe(NOCTURNO)).toBe(true);
    expect(RangoHorario.de('22:00', '01:00').estaDentroDe(NOCTURNO)).toBe(true);
    expect(RangoHorario.de('17:30', '02:00').estaDentroDe(NOCTURNO)).toBe(true);
    // Un operativo diurno no cabe en la ventana nocturna.
    expect(RangoHorario.de('08:00', '16:00').estaDentroDe(NOCTURNO)).toBe(
      false,
    );
  });

  it('la ventana llega con minuto libre (no exige media hora) y avisa si es inválida', () => {
    expect(
      RangoHorario.de('18:00', '19:00').estaDentroDe({
        inicio: '17:45',
        fin: '02:15',
      }),
    ).toBe(true);
    expect(() =>
      RangoHorario.de('18:00', '19:00').estaDentroDe({
        inicio: '8pm',
        fin: '02:00',
      }),
    ).toThrow(ValidacionError);
  });
});

describe('RangoHorario · envolvente de varias personas (RN-66, 2026-09-08)', () => {
  it('una sola persona: la envolvente es su propia ventana', () => {
    const uno = RangoHorario.envolvente([RangoHorario.de('08:00', '16:00')]);
    expect(uno.equivaleA(RangoHorario.de('08:00', '16:00'))).toBe(true);

    // Y también si esa única ventana cruza la medianoche.
    const cruza = RangoHorario.envolvente([RangoHorario.de('22:00', '02:00')]);
    expect(cruza.equivaleA(RangoHorario.de('22:00', '02:00'))).toBe(true);
  });

  it('dos turnos encadenados: 06:00–14:00 y 14:00–22:00 → 06:00–22:00', () => {
    const envolvente = RangoHorario.envolvente([
      RangoHorario.de('06:00', '14:00'),
      RangoHorario.de('14:00', '22:00'),
    ]);
    expect(envolvente.equivaleA(RangoHorario.de('06:00', '22:00'))).toBe(true);
  });

  it('ventanas solapadas: 08:00–16:00 y 14:00–22:00 → 08:00–22:00', () => {
    const envolvente = RangoHorario.envolvente([
      RangoHorario.de('08:00', '16:00'),
      RangoHorario.de('14:00', '22:00'),
    ]);
    expect(envolvente.equivaleA(RangoHorario.de('08:00', '22:00'))).toBe(true);
  });

  it('el orden de las personas no altera la envolvente', () => {
    const directo = RangoHorario.envolvente([
      RangoHorario.de('06:00', '14:00'),
      RangoHorario.de('14:00', '22:00'),
    ]);
    const inverso = RangoHorario.envolvente([
      RangoHorario.de('14:00', '22:00'),
      RangoHorario.de('06:00', '14:00'),
    ]);
    expect(directo.equivaleA(inverso)).toBe(true);
  });

  it('con cruce de medianoche: 20:00–23:00 y 22:00–02:00 → 20:00–02:00', () => {
    const envolvente = RangoHorario.envolvente([
      RangoHorario.de('20:00', '23:00'),
      RangoHorario.de('22:00', '02:00'),
    ]);
    expect(envolvente.equivaleA(RangoHorario.de('20:00', '02:00'))).toBe(true);
    expect(envolvente.cruzaMedianoche).toBe(true);
  });

  it('elige el arco corto: 22:00–23:00 y 01:00–02:00 cruzan, no cubren el día', () => {
    // El hueco mayor es el día entero (02:00 a 22:00), así que la envolvente es la noche.
    const envolvente = RangoHorario.envolvente([
      RangoHorario.de('22:00', '23:00'),
      RangoHorario.de('01:00', '02:00'),
    ]);
    expect(envolvente.equivaleA(RangoHorario.de('22:00', '02:00'))).toBe(true);
  });

  it('ventanas diurnas disjuntas: 08:00–10:00 y 16:00–18:00 → 08:00–18:00', () => {
    // No forman un operativo continuo, pero la envolvente los cubre a ambos por el arco
    // corto (el hueco mayor es la noche, no el mediodía).
    const envolvente = RangoHorario.envolvente([
      RangoHorario.de('08:00', '10:00'),
      RangoHorario.de('16:00', '18:00'),
    ]);
    expect(envolvente.equivaleA(RangoHorario.de('08:00', '18:00'))).toBe(true);
  });

  it('la envolvente puede cubrir una madrugada donde NADIE trabaja', () => {
    // 20:00–22:00 y 06:00–08:00: el hueco mayor es el día (08:00 a 20:00), así que la
    // envolvente cruza la noche (20:00–08:00) AUNQUE ninguna persona sea nocturna. Por eso
    // «es nocturno» se decide persona a persona (D2), no sobre este arco.
    const envolvente = RangoHorario.envolvente([
      RangoHorario.de('20:00', '22:00'),
      RangoHorario.de('06:00', '08:00'),
    ]);
    expect(envolvente.equivaleA(RangoHorario.de('20:00', '08:00'))).toBe(true);
  });

  it('termina a medianoche: 20:00–00:00 se representa con fin 00:00', () => {
    const envolvente = RangoHorario.envolvente([
      RangoHorario.de('20:00', '00:00'),
    ]);
    expect(envolvente.equivaleA(RangoHorario.de('20:00', '00:00'))).toBe(true);
    expect(envolvente.duracionHoras).toBe(4);
  });

  it('rechaza una lista vacía: no hay de dónde tomar la ventana', () => {
    expect(() => RangoHorario.envolvente([])).toThrow(ValidacionError);
  });

  it('rechaza cubrir el día completo: eso no es un operativo', () => {
    // Tres turnos que, juntos, no dejan hueco: 00:00–08:00, 08:00–16:00, 16:00–00:00.
    expect(() =>
      RangoHorario.envolvente([
        RangoHorario.de('00:00', '08:00'),
        RangoHorario.de('08:00', '16:00'),
        RangoHorario.de('16:00', '00:00'),
      ]),
    ).toThrow(ValidacionError);
  });
});

// La división del horario en tramos se retiró el 2026-09-14: el formulario 8 ya no segmenta,
// cada operativo de la persona lleva la misma hora general. `RangoHorario.dividir` se eliminó
// con estas pruebas; la composición de los N operativos se verifica en `operativos.service.spec`.

describe('duracionEnHoras · tramos de cualquier minuto (2026-10-14)', () => {
  it('mide un tramo corto sin la granularidad de media hora', () => {
    expect(duracionEnHoras('07:30', '07:50')).toBeCloseTo(20 / 60);
  });

  it('contempla el cruce de medianoche', () => {
    expect(duracionEnHoras('23:40', '00:10')).toBeCloseTo(0.5);
  });

  it('inicio igual a fin es duración cero, no el día entero', () => {
    expect(duracionEnHoras('08:00', '08:00')).toBe(0);
  });
});
