/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: indice-fatiga.policy.spec.ts
 * Responsabilidad: Verificar el índice de fatiga y su semáforo (advisory, no bloquea).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-24
 */

import {
  calcularFatiga,
  clasificarEquidad,
  type FactoresCarga,
  type UmbralesFatiga,
} from './indice-fatiga.policy';

// Los mismos valores que siembra la migración 20260924140000: ámbar 6, rojo 10, y pesos 1/2/3.
const UMBRALES: UmbralesFatiga = {
  umbralAmbar: 6,
  umbralRojo: 10,
  pesoHorasDia: 1,
  pesoCargaPeriodo: 1,
  pesoSalidasPesadas: 2,
  pesoPatrullaReciente: 3,
};

const SIN_CARGA: FactoresCarga = {
  horasDia: 0,
  salidasPesadas: 0,
  patrullaReciente: false,
};

describe('calcularFatiga · índice y semáforo', () => {
  it('sin carga: índice 0, VERDE y sin factores', () => {
    const resultado = calcularFatiga(SIN_CARGA, UMBRALES);

    expect(resultado.indice).toBe(0);
    expect(resultado.nivel).toBe('VERDE');
    expect(resultado.factores).toEqual([]);
  });

  it('pondera cada factor por su peso y los suma', () => {
    // 5·1 + 1·2 + 1·3 = 10
    const resultado = calcularFatiga(
      { horasDia: 5, salidasPesadas: 1, patrullaReciente: true },
      UMBRALES,
    );

    expect(resultado.indice).toBe(10);
  });

  it('por debajo del corte ámbar es VERDE', () => {
    // 4·1 = 4 < 6
    expect(calcularFatiga({ ...SIN_CARGA, horasDia: 4 }, UMBRALES).nivel).toBe(
      'VERDE',
    );
  });

  it('en el corte ámbar exacto es ÁMBAR (>=)', () => {
    // 6·1 = 6
    expect(calcularFatiga({ ...SIN_CARGA, horasDia: 6 }, UMBRALES).nivel).toBe(
      'AMBAR',
    );
  });

  it('entre ámbar y rojo es ÁMBAR', () => {
    // 4 + 1·2 = 6 … subo a 8 para caer en medio: 4 + 2·2 = 8
    expect(
      calcularFatiga(
        { horasDia: 4, salidasPesadas: 2, patrullaReciente: false },
        UMBRALES,
      ).nivel,
    ).toBe('AMBAR');
  });

  it('en el corte rojo exacto es ROJO (>=)', () => {
    // 10 justo
    expect(
      calcularFatiga(
        { horasDia: 5, salidasPesadas: 1, patrullaReciente: true },
        UMBRALES,
      ).nivel,
    ).toBe('ROJO');
  });

  it('por encima del corte rojo es ROJO', () => {
    // 12·1 = 12 > 10
    expect(calcularFatiga({ ...SIN_CARGA, horasDia: 12 }, UMBRALES).nivel).toBe(
      'ROJO',
    );
  });

  it('suma las horas del PERÍODO (otros días) por su peso', () => {
    // 2 h hoy + 5 h de otros días de la semana = 7 (con pesos 1).
    const resultado = calcularFatiga(
      {
        horasDia: 2,
        horasPeriodo: 5,
        salidasPesadas: 0,
        patrullaReciente: false,
      },
      UMBRALES,
    );

    expect(resultado.indice).toBe(7);
    expect(resultado.nivel).toBe('AMBAR'); // ≥ 6
  });

  it('las horas del período arrastran aunque hoy no tenga ninguna', () => {
    // 0 h hoy pero 9 h en la semana → 9 → media (el caso de "arrastre" del 25 al 26).
    const resultado = calcularFatiga(
      {
        horasDia: 0,
        horasPeriodo: 9,
        salidasPesadas: 0,
        patrullaReciente: false,
      },
      UMBRALES,
    );

    expect(resultado.indice).toBe(9);
    expect(resultado.nivel).toBe('AMBAR');
    expect(resultado.factores).toContain('9 h más en el período (otros días)');
  });

  it('la patrulla reciente solo suma cuando es verdadera', () => {
    const sin = calcularFatiga(
      { horasDia: 2, salidasPesadas: 0, patrullaReciente: false },
      UMBRALES,
    );
    const con = calcularFatiga(
      { horasDia: 2, salidasPesadas: 0, patrullaReciente: true },
      UMBRALES,
    );

    expect(sin.indice).toBe(2);
    expect(con.indice).toBe(5); // 2 + 3
  });

  it('redondea el índice a un decimal', () => {
    // peso fraccionario para forzar decimales: 0.5·3 = 1.5
    const resultado = calcularFatiga(
      { ...SIN_CARGA, horasDia: 3 },
      { ...UMBRALES, pesoHorasDia: 0.5 },
    );

    expect(resultado.indice).toBe(1.5);
  });
});

describe('calcularFatiga · factores en palabras (regla 6)', () => {
  it('lista solo los factores que suman, redactados', () => {
    const resultado = calcularFatiga(
      { horasDia: 4, salidasPesadas: 2, patrullaReciente: true },
      UMBRALES,
    );

    expect(resultado.factores).toEqual([
      '4 h ya asignadas hoy',
      '2 salidas pesadas en el período',
      'salió en patrulla recientemente',
    ]);
  });

  it('usa el singular con una sola salida pesada', () => {
    const resultado = calcularFatiga(
      { horasDia: 0, salidasPesadas: 1, patrullaReciente: false },
      UMBRALES,
    );

    expect(resultado.factores).toEqual(['1 salida pesada en el período']);
  });

  it('muestra las horas con decimal cuando lo tienen', () => {
    const resultado = calcularFatiga({ ...SIN_CARGA, horasDia: 6.5 }, UMBRALES);

    expect(resultado.factores[0]).toBe('6.5 h ya asignadas hoy');
  });
});

describe('clasificarEquidad · reparto frente a la cuota justa', () => {
  const MARGEN = 0.25; // banda [0.75, 1.25]·cuota, como siembra EQUIDAD_MARGEN.

  it('sin carga en el grupo (cuota 0): todos EQUILIBRADO, no hay parte que repartir', () => {
    const equidad = clasificarEquidad(0, 0, MARGEN);

    expect(equidad.nivel).toBe('EQUILIBRADO');
    expect(equidad.cuotaJusta).toBe(0);
    expect(equidad.desviacion).toBe(0);
  });

  it('muy por debajo de la cuota → DEBAJO, con desviación negativa', () => {
    const equidad = clasificarEquidad(2, 10, MARGEN);

    expect(equidad.nivel).toBe('DEBAJO');
    expect(equidad.desviacion).toBe(-8);
  });

  it('en su cuota → EQUILIBRADO, desviación 0', () => {
    const equidad = clasificarEquidad(10, 10, MARGEN);

    expect(equidad.nivel).toBe('EQUILIBRADO');
    expect(equidad.desviacion).toBe(0);
  });

  it('muy por encima de la cuota → ENCIMA, con desviación positiva', () => {
    const equidad = clasificarEquidad(20, 10, MARGEN);

    expect(equidad.nivel).toBe('ENCIMA');
    expect(equidad.desviacion).toBe(10);
  });

  it('en el borde exacto de la banda es EQUILIBRADO (usa > y <, no >= ni <=)', () => {
    // ratio 1.25 justo y ratio 0.75 justo: ninguno cruza la banda.
    expect(clasificarEquidad(12.5, 10, MARGEN).nivel).toBe('EQUILIBRADO');
    expect(clasificarEquidad(7.5, 10, MARGEN).nivel).toBe('EQUILIBRADO');
  });

  it('redondea la cuota y la desviación a un decimal', () => {
    // cuota 14/3 ≈ 4.6667 → 4.7; 8 − 4.6667 ≈ 3.3333 → 3.3.
    const equidad = clasificarEquidad(8, 14 / 3, MARGEN);

    expect(equidad.cuotaJusta).toBe(4.7);
    expect(equidad.desviacion).toBe(3.3);
    expect(equidad.nivel).toBe('ENCIMA');
  });
});
