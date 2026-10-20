/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: propuesta-turnos.policy.spec.ts
 * Responsabilidad: Verificar la propuesta del mes: ciclo, ausencias, mínimos, descanso y reparto.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import {
  diaDeSemana,
  interpretarMinimos,
  proponerMes,
  type CeldaMes,
  type ConductorDelMes,
  type ReglasRotacion,
  type TurnoMes,
} from './propuesta-turnos.policy';

const SIN_REGLAS: ReglasRotacion = {
  minimosDia: null,
  minimosNoche: null,
  maxDiasSinLibre: null,
  permiteNocheADia: null,
};

/** n días desde una fecha AAAA-MM-DD. */
function rango(desde: string, n: number): string[] {
  const [a, m, d] = desde.split('-').map(Number);
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(a, m - 1, d + i)).toISOString().slice(0, 10),
  );
}

const LETRA: Record<string, CeldaMes> = {
  D: 'DIA',
  N: 'NOCHE',
  E: 'ECU_NOCHE',
  L: 'LIBRE',
  A: 'ADMINISTRATIVO',
  X: 'AUSENCIA',
  _: null,
};
/** «DDNNLL__X» → celdas. */
const celdas = (texto: string): CeldaMes[] => [...texto].map((l) => LETRA[l]);

// Lunes 2026-11-02, siete días (L..D).
const SEMANA = rango('2026-11-02', 7);

const conductor = (
  conductorId: number,
  mes: string,
  historial = '',
  patron: string | null = null,
): ConductorDelMes => ({
  conductorId,
  patron,
  historial: celdas(historial),
  mes: celdas(mes),
});

/** Las propuestas de un conductor como texto de letras (`_` = sin propuesta). */
function lineaDe(
  resultado: ReturnType<typeof proponerMes>,
  conductorId: number,
  dias: readonly string[],
): string {
  const inversa: Record<TurnoMes, string> = {
    DIA: 'D',
    NOCHE: 'N',
    ECU_NOCHE: 'E',
    LIBRE: 'L',
    ADMINISTRATIVO: 'A',
  };
  return dias
    .map((fecha) => {
      const p = resultado.propuestas.find(
        (x) => x.conductorId === conductorId && x.fecha === fecha,
      );
      return p ? inversa[p.turno] : '_';
    })
    .join('');
}

describe('utilidades', () => {
  it('interpretarMinimos: siete enteros o null', () => {
    expect(interpretarMinimos('6,6,6,6,6,4,4')).toEqual([6, 6, 6, 6, 6, 4, 4]);
    expect(interpretarMinimos(' 1, 2,3,4,5,6,7 ')).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(interpretarMinimos('SIN_CONFIGURAR')).toBeNull();
    expect(interpretarMinimos('1,2,3')).toBeNull();
  });

  it('diaDeSemana: lunes 0 … domingo 6, sin huso', () => {
    expect(diaDeSemana('2026-11-02')).toBe(0);
    expect(diaDeSemana('2026-11-08')).toBe(6);
  });
});

describe('proponerMes · (a) el ciclo', () => {
  it('continúa el ciclo del HISTORIAL en su fase', () => {
    // Ciclo DDNNLL (6 días); 12 días de historial = dos vueltas. El mes arranca en la fase 0.
    const r = proponerMes({
      dias: SEMANA,
      conductores: [conductor(1, '_______', 'DDNNLLDDNNLL')],
      reglas: SIN_REGLAS,
      rehacerTodo: false,
    });
    expect(lineaDe(r, 1, SEMANA)).toBe('DDNNLLD');
  });

  it('sin historial suficiente usa el PATRÓN del conductor, alineado con lo conocido', () => {
    const sinNada = proponerMes({
      dias: SEMANA,
      conductores: [conductor(1, '_______', '', 'DNL')],
      reglas: SIN_REGLAS,
      rehacerTodo: false,
    });
    expect(lineaDe(sinNada, 1, SEMANA)).toBe('DNLDNLD');

    // La víspera fue N y antes D: el patrón DNL sigue con L.
    const alineado = proponerMes({
      dias: SEMANA,
      conductores: [conductor(1, '_______', 'DN', 'DNL')],
      reglas: SIN_REGLAS,
      rehacerTodo: false,
    });
    expect(lineaDe(alineado, 1, SEMANA)).toBe('LDNLDNL');
  });

  it('el HISTORIAL gana al patrón cuando hay ciclo claro', () => {
    const r = proponerMes({
      dias: SEMANA,
      conductores: [conductor(1, '_______', 'DLDLDLDL', 'NNL')],
      reglas: SIN_REGLAS,
      rehacerTodo: false,
    });
    expect(lineaDe(r, 1, SEMANA)).toBe('DLDLDLD');
  });

  it('sin ciclo ni patrón repite los ÚLTIMOS 14 DÍAS (sus huecos quedan huecos)', () => {
    const historial = 'DDDNLLA_DNNLLD'; // 14 días sin período ≤ 7 con dos vueltas
    const r = proponerMes({
      dias: rango('2026-11-02', 14),
      conductores: [conductor(1, '______________', historial)],
      reglas: SIN_REGLAS,
      rehacerTodo: false,
    });
    expect(lineaDe(r, 1, rango('2026-11-02', 14))).toBe('DDDNLLA_DNNLLD');
  });

  it('sin ciclo, sin patrón y sin historial no inventa nada', () => {
    const r = proponerMes({
      dias: SEMANA,
      conductores: [conductor(1, '_______')],
      reglas: SIN_REGLAS,
      rehacerTodo: false,
    });
    expect(r.propuestas).toEqual([]);
    expect(r.resumen.celdasALlenar).toBe(7);
  });
});

describe('proponerMes · (b)(f) ausencias y celdas llenas', () => {
  it('nunca escribe sobre una ausencia y solo llena las vacías', () => {
    const r = proponerMes({
      dias: SEMANA,
      conductores: [conductor(1, 'XX_L___', 'DLDLDLDL')],
      reglas: SIN_REGLAS,
      rehacerTodo: false,
    });
    // Días 1-2 ausencia; el día 4 ya tiene su LIBRE y no se propone.
    expect(lineaDe(r, 1, SEMANA)).toBe('__D_DLD');
    expect(r.resumen.celdasALlenar).toBe(4);
  });

  it('rehacerTodo reescribe los turnos guardados, nunca las ausencias', () => {
    const r = proponerMes({
      dias: SEMANA,
      conductores: [conductor(1, 'XNNNNNN', 'DLDLDLDL')],
      reglas: SIN_REGLAS,
      rehacerTodo: true,
    });
    expect(lineaDe(r, 1, SEMANA)).toBe('_LDLDLD');
    expect(r.resumen.celdasALlenar).toBe(6);
  });

  it('una propuesta igual a lo guardado no se repite', () => {
    const r = proponerMes({
      dias: SEMANA,
      conductores: [conductor(1, 'DLDLDLD', 'DLDLDLDL')],
      reglas: SIN_REGLAS,
      rehacerTodo: true,
    });
    expect(r.propuestas).toEqual([]);
  });
});

describe('proponerMes · (c) mínimos por día de la semana', () => {
  it('cubre el mínimo con los conductores sin ciclo, repartiendo', () => {
    const r = proponerMes({
      dias: SEMANA,
      conductores: [1, 2, 3].map((id) => conductor(id, '_______')),
      reglas: { ...SIN_REGLAS, minimosDia: [1, 1, 1, 1, 1, 1, 1] },
      rehacerTodo: false,
    });
    const porDia = SEMANA.map(
      (f) =>
        r.propuestas.filter((p) => p.fecha === f && p.turno === 'DIA').length,
    );
    expect(porDia).toEqual([1, 1, 1, 1, 1, 1, 1]);
    const cuenta = [1, 2, 3].map(
      (id) => r.propuestas.filter((p) => p.conductorId === id).length,
    );
    expect(Math.max(...cuenta) - Math.min(...cuenta)).toBeLessThanOrEqual(1);
    expect(r.resumen.diasBajoMinimo).toEqual([]);
  });

  it('el mínimo depende del día de la semana (L..D)', () => {
    const r = proponerMes({
      dias: SEMANA,
      conductores: [1, 2, 3].map((id) => conductor(id, '_______')),
      reglas: { ...SIN_REGLAS, minimosNoche: [0, 0, 0, 0, 0, 2, 2] },
      rehacerTodo: false,
    });
    expect(r.propuestas.map((p) => p.fecha)).toEqual([
      '2026-11-07',
      '2026-11-07',
      '2026-11-08',
      '2026-11-08',
    ]);
    expect(r.propuestas.every((p) => p.turno === 'NOCHE')).toBe(true);
  });

  it('si no alcanza, el día va a diasBajoMinimo con cuántos hay', () => {
    const r = proponerMes({
      dias: SEMANA.slice(0, 1),
      conductores: [conductor(1, 'X'), conductor(2, '_')],
      reglas: { ...SIN_REGLAS, minimosDia: [3, 3, 3, 3, 3, 3, 3] },
      rehacerTodo: false,
    });
    expect(r.resumen.diasBajoMinimo).toEqual([
      { fecha: '2026-11-02', turno: 'DIA', hay: 1, minimo: 3 },
    ]);
  });

  it('un LIBRE del ciclo se usa para cubrir, pero después de los que no tienen ciclo', () => {
    const r = proponerMes({
      dias: SEMANA.slice(0, 1),
      conductores: [conductor(1, '_', 'LDLDLDLD'), conductor(2, '_')],
      reglas: { ...SIN_REGLAS, minimosDia: [1, 1, 1, 1, 1, 1, 1] },
      rehacerTodo: false,
    });
    expect(r.propuestas).toEqual([
      { conductorId: 1, fecha: '2026-11-02', turno: 'LIBRE' },
      { conductorId: 2, fecha: '2026-11-02', turno: 'DIA' },
    ]);
  });
});

describe('proponerMes · (d) descanso', () => {
  it('con DAF_PERMITE_NOCHE_A_DIA = NO no propone DÍA tras NOCHE y avisa', () => {
    const base = {
      dias: SEMANA.slice(0, 2),
      conductores: [conductor(1, '__', 'DNDNDNDN')],
      rehacerTodo: false,
    };
    const no = proponerMes({
      ...base,
      reglas: { ...SIN_REGLAS, permiteNocheADia: false },
    });
    expect(lineaDe(no, 1, base.dias)).toBe('LN');
    expect(no.resumen.avisos[0]).toMatchObject({
      conductorId: 1,
      fecha: '2026-11-02',
    });
    expect(no.resumen.avisos[0].mensaje).toMatch(/DÍA tras NOCHE/);

    // SIN_CONFIGURAR o SI: no se evalúa.
    for (const permiteNocheADia of [null, true]) {
      const r = proponerMes({
        ...base,
        reglas: { ...SIN_REGLAS, permiteNocheADia },
      });
      expect(lineaDe(r, 1, base.dias)).toBe('DN');
    }
  });

  it('no propone NOCHE la víspera de un DÍA ya guardado (con NO)', () => {
    const r = proponerMes({
      dias: SEMANA.slice(0, 2),
      conductores: [conductor(1, '_D'), conductor(2, '__')],
      reglas: {
        ...SIN_REGLAS,
        permiteNocheADia: false,
        minimosNoche: [1, 0, 0, 0, 0, 0, 0],
      },
      rehacerTodo: false,
    });
    expect(r.propuestas).toEqual([
      { conductorId: 2, fecha: '2026-11-02', turno: 'NOCHE' },
    ]);
  });

  it('con DAF_MAX_DIAS_SIN_LIBRE = 3 corta la racha con un LIBRE; con 0 no se evalúa', () => {
    const dias = rango('2026-11-02', 5);
    const conMax = proponerMes({
      dias,
      conductores: [conductor(1, '_____', '', 'DD')],
      reglas: { ...SIN_REGLAS, maxDiasSinLibre: 3 },
      rehacerTodo: false,
    });
    expect(lineaDe(conMax, 1, dias)).toBe('DDDLD');

    const sinMax = proponerMes({
      dias,
      conductores: [conductor(1, '_____', '', 'DD')],
      reglas: SIN_REGLAS,
      rehacerTodo: false,
    });
    expect(lineaDe(sinMax, 1, dias)).toBe('DDDDD');
  });

  it('la racha cuenta los días anteriores al mes; una ausencia la corta', () => {
    const dias = rango('2026-11-02', 2);
    const r = proponerMes({
      dias,
      conductores: [conductor(1, '__', 'DDD', 'D'.repeat(2))],
      reglas: { ...SIN_REGLAS, maxDiasSinLibre: 3 },
      rehacerTodo: false,
    });
    expect(lineaDe(r, 1, dias)).toBe('LD');

    const conAusencia = proponerMes({
      dias,
      conductores: [conductor(1, '__', 'DDX', 'DD')],
      reglas: { ...SIN_REGLAS, maxDiasSinLibre: 3 },
      rehacerTodo: false,
    });
    expect(lineaDe(conAusencia, 1, dias)).toBe('DD');
  });
});

describe('proponerMes · (e) reparto de noches y fines de semana', () => {
  it('las noches para cubrir mínimos se reparten (diferencia ≤ 1, sin aviso)', () => {
    const r = proponerMes({
      dias: SEMANA,
      conductores: [1, 2, 3].map((id) => conductor(id, '_______')),
      reglas: { ...SIN_REGLAS, minimosNoche: [1, 1, 1, 1, 1, 1, 1] },
      rehacerTodo: false,
    });
    const noches = [1, 2, 3].map(
      (id) => r.propuestas.filter((p) => p.conductorId === id).length,
    );
    expect(noches.sort()).toEqual([2, 2, 3]);
    expect(r.resumen.avisos).toEqual([]);
  });

  it('avisa al que más noches lleva si la diferencia supera uno', () => {
    const r = proponerMes({
      dias: SEMANA,
      conductores: [conductor(1, 'NNNNLLL'), conductor(2, 'DDDDLLL')],
      reglas: SIN_REGLAS,
      rehacerTodo: false,
    });
    const avisoNoches = r.resumen.avisos.find((a) =>
      a.mensaje.includes('noches'),
    );
    expect(avisoNoches).toEqual({
      conductorId: 1,
      fecha: '2026-11-05',
      mensaje:
        'Lleva 4 noches en el mes y hay quien lleva 0: el reparto difiere en más de uno.',
    });
  });

  it('avisa del reparto de fines de semana trabajados', () => {
    const r = proponerMes({
      dias: SEMANA,
      conductores: [conductor(1, 'LLLLLDD'), conductor(2, 'DDDDDLL')],
      reglas: SIN_REGLAS,
      rehacerTodo: false,
    });
    expect(
      r.resumen.avisos.some(
        (a) => a.conductorId === 1 && a.mensaje.includes('fin de semana'),
      ),
    ).toBe(true);
  });
});

describe('proponerMes · determinismo y parámetros sin configurar', () => {
  it('misma entrada, misma salida, sin importar el orden de los conductores', () => {
    const conductores = [
      conductor(3, '_______'),
      conductor(1, '_______', 'DDNNLLDDNNLL'),
      conductor(2, '___X___', '', 'DNL'),
    ];
    const reglas: ReglasRotacion = {
      minimosDia: [2, 2, 2, 2, 2, 1, 1],
      minimosNoche: [1, 1, 1, 1, 1, 1, 1],
      maxDiasSinLibre: 5,
      permiteNocheADia: false,
    };
    const a = proponerMes({
      dias: SEMANA,
      conductores,
      reglas,
      rehacerTodo: false,
    });
    const b = proponerMes({
      dias: SEMANA,
      conductores: [...conductores].reverse(),
      reglas,
      rehacerTodo: false,
    });
    expect(a).toEqual(b);
    expect(a.resumen.parametrosSinConfigurar).toEqual([]);
  });

  it('lista las reglas sin configurar', () => {
    const r = proponerMes({
      dias: SEMANA,
      conductores: [],
      reglas: SIN_REGLAS,
      rehacerTodo: false,
    });
    expect(r.resumen.parametrosSinConfigurar).toEqual([
      'DAF_MIN_CONDUCTORES_DIA',
      'DAF_MIN_CONDUCTORES_NOCHE',
      'DAF_MAX_DIAS_SIN_LIBRE',
      'DAF_PERMITE_NOCHE_A_DIA',
    ]);
  });
});
