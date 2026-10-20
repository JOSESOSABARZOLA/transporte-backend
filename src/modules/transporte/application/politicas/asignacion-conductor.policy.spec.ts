/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · asignación por tramos
 * Archivo: asignacion-conductor.policy.spec.ts
 * Responsabilidad: Verificar la política pura de asignación, las cadenas, los traslados y los tramos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import {
  evaluar,
  finDeAyerEnHoy,
  type BloqueEvaluado,
  type ConductorEvaluado,
  type ContextoEvaluacion,
  type ParametrosAsignacion,
  type TramoEvaluado,
  type VehiculoEvaluado,
} from './asignacion-conductor.policy';
import { agruparCadenas } from './cadenas';
import { franjaDe, minutoDeJornada, seSolapan } from './linea-de-tiempo';
import { planificarTramos } from './plan-tramos';
import { claveTraslado, minutosTraslado, type Lugar } from './traslados';

const INICIO = '05:00';
const NORTE: Lugar = { zonalId: 1, sector: 'NORTE' };
const NORTE_2: Lugar = { zonalId: 2, sector: 'NORTE' };
const SUR: Lugar = { zonalId: 4, sector: 'SUR' };

const PARAMETROS: ParametrosAsignacion = {
  maxJornadaHoras: 14,
  jornadaAvisoHoras: 12,
  descansoMinHoras: 9,
  traslado: { mismaZona: 15, mismoSector: 30, otroSector: 60 },
  tablaTraslados: new Map(),
  costoAviso: 30,
  costoActivarLibre: 120,
  costoArranqueLejos: 20,
};

const CONTEXTO: ContextoEvaluacion = {
  esFinDeSemana: false,
  ventanaNombramiento: franjaDe('08:00', '16:30', INICIO),
  ventanaTurno: null,
};

const conductor = (
  cambios: Partial<ConductorEvaluado> = {},
): ConductorEvaluado => ({
  id: 1,
  nombre: 'PÉREZ JUAN',
  tipoContrato: 'OCASIONAL',
  turno: null,
  activado: false,
  ausente: false,
  ultimoFinAyer: null,
  ...cambios,
});

const tramo = (
  inicio: string,
  fin: string,
  lugar: Lugar = NORTE,
  etiqueta = 'OP',
): TramoEvaluado => ({
  franja: franjaDe(inicio, fin, INICIO),
  origen: lugar,
  destino: lugar,
  etiqueta,
});

const bloque = (tramos: TramoEvaluado[], personas = 1): BloqueEvaluado => ({
  tramos,
  personas,
});

describe('línea de tiempo 05H00→05H00', () => {
  it('una hora antes de las 05H00 pertenece a la noche (día siguiente)', () => {
    expect(minutoDeJornada('02:00', INICIO)).toBe(26 * 60);
    expect(minutoDeJornada('06:30', INICIO)).toBe(6 * 60 + 30);
  });

  it('tocarse en el borde no es solaparse', () => {
    expect(
      seSolapan(
        franjaDe('06:00', '08:00', INICIO),
        franjaDe('08:00', '09:00', INICIO),
      ),
    ).toBe(false);
  });
});

describe('asignacion-conductor.policy', () => {
  it('DURO: solapamiento con un tramo del día', () => {
    const r = evaluar(
      conductor(),
      null,
      bloque([tramo('07:00', '09:00')]),
      [tramo('06:30', '08:00', NORTE, 'ID-1')],
      CONTEXTO,
      PARAMETROS,
    );
    expect(r.estado).toBe('DURO');
    expect(r.duros.map((m) => m.codigo)).toContain('SOLAPAMIENTO');
  });

  it('DURO: no llega por el traslado (termina 18H00 en Eloy Alfaro, empieza 18H00 en el norte)', () => {
    const r = evaluar(
      conductor(),
      null,
      bloque([tramo('18:00', '20:00', NORTE)]),
      [tramo('16:00', '18:00', SUR, 'ID-SUR')],
      CONTEXTO,
      PARAMETROS,
    );
    expect(r.duros.map((m) => m.codigo)).toContain('NO_LLEGA');
  });

  it('con hueco suficiente para el traslado, sí llega', () => {
    const r = evaluar(
      conductor(),
      null,
      bloque([tramo('19:00', '21:00', NORTE)]),
      [tramo('16:00', '18:00', SUR)],
      CONTEXTO,
      PARAMETROS,
    );
    expect(r.duros).toHaveLength(0);
    expect(r.costo).toBeGreaterThanOrEqual(60);
  });

  it('DURO: el nombramiento no pasa de las 16H30', () => {
    const nombramiento = conductor({ tipoContrato: 'NOMBRAMIENTO' });
    const dentro = evaluar(
      nombramiento,
      null,
      bloque([tramo('14:00', '16:30')]),
      [],
      CONTEXTO,
      PARAMETROS,
    );
    const fuera = evaluar(
      nombramiento,
      null,
      bloque([tramo('15:00', '17:00')]),
      [],
      CONTEXTO,
      PARAMETROS,
    );
    expect(dentro.duros).toHaveLength(0);
    expect(fuera.duros.map((m) => m.codigo)).toContain(
      'NOMBRAMIENTO_FUERA_DE_HORARIO',
    );
  });

  it('DURO: nombramiento en fin de semana', () => {
    const r = evaluar(
      conductor({ tipoContrato: 'NOMBRAMIENTO' }),
      null,
      bloque([tramo('09:00', '10:00')]),
      [],
      { ...CONTEXTO, esFinDeSemana: true },
      PARAMETROS,
    );
    expect(r.duros.map((m) => m.codigo)).toContain(
      'NOMBRAMIENTO_FUERA_DE_HORARIO',
    );
  });

  it('AVISO: descanso insuficiente tras la noche (terminó a la 01H00, entra a las 06H00)', () => {
    const ayer = finDeAyerEnHoy(minutoDeJornada('01:00', INICIO));
    const r = evaluar(
      conductor({ ultimoFinAyer: ayer }),
      null,
      bloque([tramo('06:00', '08:00')]),
      [],
      CONTEXTO,
      PARAMETROS,
    );
    expect(r.avisos.map((m) => m.codigo)).toContain('DESCANSO_INSUFICIENTE');
    // A las 10H00 ya descansó 9 h: sin aviso.
    const bien = evaluar(
      conductor({ ultimoFinAyer: ayer }),
      null,
      bloque([tramo('10:00', '12:00')]),
      [],
      CONTEXTO,
      PARAMETROS,
    );
    expect(bien.avisos.map((m) => m.codigo)).not.toContain(
      'DESCANSO_INSUFICIENTE',
    );
  });

  it('DURO: jornada máxima (14 h) y AVISO por encima de 12 h', () => {
    const larga = evaluar(
      conductor(),
      null,
      bloque([tramo('18:00', '19:00')]),
      [tramo('06:00', '07:00')],
      CONTEXTO,
      PARAMETROS,
    );
    expect(larga.avisos.map((m) => m.codigo)).toContain('JORNADA_LARGA');
    const excesiva = evaluar(
      conductor(),
      null,
      bloque([tramo('21:00', '22:00')]),
      [tramo('06:00', '07:00')],
      CONTEXTO,
      PARAMETROS,
    );
    expect(excesiva.duros.map((m) => m.codigo)).toContain('JORNADA_MAXIMA');
  });

  it('DURO: más personas que asientos; DURO: vehículo en taller', () => {
    const vehiculo: VehiculoEvaluado = {
      id: 1,
      asientos: 4,
      enTaller: false,
      amaneceEn: null,
    };
    const lleno = evaluar(
      conductor(),
      vehiculo,
      bloque([tramo('09:00', '10:00')], 5),
      [],
      CONTEXTO,
      PARAMETROS,
    );
    expect(lleno.duros.map((m) => m.codigo)).toContain('ASIENTOS');
    const taller = evaluar(
      conductor(),
      { ...vehiculo, enTaller: true },
      bloque([tramo('09:00', '10:00')], 2),
      [],
      CONTEXTO,
      PARAMETROS,
    );
    expect(taller.duros.map((m) => m.codigo)).toContain('VEHICULO_EN_TALLER');
  });

  it('DURO: libre sin activar; con activación, AVISO de horas extra y costo de activar', () => {
    const sin = evaluar(
      conductor({ turno: 'LIBRE' }),
      null,
      bloque([tramo('09:00', '10:00')]),
      [],
      CONTEXTO,
      PARAMETROS,
    );
    expect(sin.duros.map((m) => m.codigo)).toContain('LIBRE_NO_ACTIVADO');
    const con = evaluar(
      conductor({ turno: 'LIBRE', activado: true }),
      null,
      bloque([tramo('09:00', '10:00')]),
      [],
      CONTEXTO,
      PARAMETROS,
    );
    expect(con.estado).toBe('AVISO');
    expect(con.costo).toBeGreaterThanOrEqual(PARAMETROS.costoActivarLibre);
  });

  it('AVISO: fuera de su turno', () => {
    const r = evaluar(
      conductor({ turno: 'DIA' }),
      null,
      bloque([tramo('17:00', '19:00')]),
      [],
      { ...CONTEXTO, ventanaTurno: franjaDe('06:00', '18:00', INICIO) },
      PARAMETROS,
    );
    expect(r.avisos.map((m) => m.codigo)).toContain('FUERA_DE_TURNO');
  });

  it('AVISO: el vehículo amanece lejos del primer punto', () => {
    const vehiculo: VehiculoEvaluado = {
      id: 1,
      asientos: null,
      enTaller: false,
      amaneceEn: SUR,
    };
    const r = evaluar(
      conductor(),
      vehiculo,
      bloque([tramo('07:00', '08:00', NORTE)]),
      [],
      CONTEXTO,
      PARAMETROS,
    );
    expect(r.avisos.map((m) => m.codigo)).toContain('ARRANQUE_LEJOS');
  });

  it('PMO: dejar y retirar ocupan solo su franja y permiten encadenar otro operativo entre medio', () => {
    // Operativo PMO 08H00–14H00 con dejar (08:00–08:30) y retirar (13:30–14:00) ya asignados.
    const delDia = [
      tramo('08:00', '08:30', NORTE, 'PMO (dejar)'),
      tramo('13:30', '14:00', NORTE, 'PMO (retirar)'),
    ];
    const r = evaluar(
      conductor(),
      null,
      bloque([tramo('09:30', '12:30', NORTE_2)]),
      delDia,
      CONTEXTO,
      PARAMETROS,
    );
    expect(r.duros).toHaveLength(0);
  });
});

describe('cadenas por funcionario', () => {
  it('ID-33, ID-34 e ID-35 del mismo funcionario seguidos forman un solo bloque', () => {
    const bloques = agruparCadenas(
      [
        { id: 33, horaInicio: '08:00', horaFin: '10:00', funcionarioIds: [7] },
        { id: 34, horaInicio: '10:00', horaFin: '12:00', funcionarioIds: [7] },
        { id: 35, horaInicio: '12:00', horaFin: '14:00', funcionarioIds: [7] },
        { id: 40, horaInicio: '10:00', horaFin: '11:00', funcionarioIds: [9] },
      ],
      INICIO,
    );
    expect(
      bloques.find((b) => b.operativoIds.includes(33))?.operativoIds,
    ).toEqual([33, 34, 35]);
    expect(
      bloques.find((b) => b.operativoIds.includes(40))?.operativoIds,
    ).toEqual([40]);
  });

  it('un hueco entre operativos del mismo funcionario corta la cadena', () => {
    const bloques = agruparCadenas(
      [
        { id: 1, horaInicio: '08:00', horaFin: '10:00', funcionarioIds: [7] },
        { id: 2, horaInicio: '10:30', horaFin: '12:00', funcionarioIds: [7] },
      ],
      INICIO,
    );
    expect(bloques).toHaveLength(2);
  });
});

describe('traslados', () => {
  const p = PARAMETROS.traslado;
  it('tabla explícita > misma zona > mismo sector > otro sector', () => {
    const tabla = new Map([[claveTraslado(1, 4), 45]]);
    expect(minutosTraslado(NORTE, SUR, tabla, p)).toBe(45);
    expect(minutosTraslado(NORTE, NORTE, new Map(), p)).toBe(15);
    expect(minutosTraslado(NORTE, NORTE_2, new Map(), p)).toBe(30);
    expect(minutosTraslado(NORTE, SUR, new Map(), p)).toBe(60);
  });

  it('sin lugar conocido no hay traslado que medir', () => {
    expect(minutosTraslado(null, SUR, new Map(), p)).toBe(0);
    expect(
      minutosTraslado({ zonalId: null, sector: null }, SUR, new Map(), p),
    ).toBe(0);
  });
});

/** DAF_DURACION_DEJAR_MIN y DAF_DURACION_RETIRAR_MIN de la semilla (2026-10-14). */
const D30 = { dejar: 30, retirar: 30 };

describe('plan de tramos por tipo de transporte', () => {
  const op = { horaInicio: '08:00', horaFin: '14:00', zonalId: 3 };
  it('D7 · dejar y retirar pueden durar distinto (un parámetro por tipo de tramo)', () => {
    expect(
      planificarTramos(
        { ...op, tipoTransporte: 'INICIO_Y_FIN' },
        { dejar: 20, retirar: 40 },
      ).map((t) => [t.tipo, t.horaInicio, t.horaFin]),
    ).toEqual([
      ['DEJAR', '08:00', '08:20'],
      ['RETIRAR', '13:20', '14:00'],
    ]);
  });
  it('D7 · el operativo corto se degrada a COMPLETO cuando dejar + retirar no caben', () => {
    expect(
      planificarTramos(
        {
          horaInicio: '08:00',
          horaFin: '09:00',
          zonalId: 3,
          tipoTransporte: 'INICIO_Y_FIN',
        },
        { dejar: 20, retirar: 40 },
      ).map((t) => t.tipo),
    ).toEqual(['COMPLETO']);
  });
  it('COMPLETO: un tramo de inicio a fin', () => {
    expect(
      planificarTramos({ ...op, tipoTransporte: 'COMPLETO' }, D30),
    ).toEqual([
      expect.objectContaining({
        tipo: 'COMPLETO',
        horaInicio: '08:00',
        horaFin: '14:00',
      }),
    ]);
  });
  it('SOLO_INICIO, SOLO_FIN e INICIO_Y_FIN generan tramos cortos', () => {
    expect(
      planificarTramos({ ...op, tipoTransporte: 'SOLO_INICIO' }, D30)[0],
    ).toMatchObject({ tipo: 'DEJAR', horaInicio: '08:00', horaFin: '08:30' });
    expect(
      planificarTramos({ ...op, tipoTransporte: 'SOLO_FIN' }, D30)[0],
    ).toMatchObject({ tipo: 'RETIRAR', horaInicio: '13:30', horaFin: '14:00' });
    expect(
      planificarTramos({ ...op, tipoTransporte: 'INICIO_Y_FIN' }, D30).map(
        (t) => t.tipo,
      ),
    ).toEqual(['DEJAR', 'RETIRAR']);
  });
  it('INICIO_Y_FIN en un operativo muy corto es un solo tramo completo', () => {
    expect(
      planificarTramos(
        {
          horaInicio: '08:00',
          horaFin: '08:45',
          zonalId: 3,
          tipoTransporte: 'INICIO_Y_FIN',
        },
        D30,
      ).map((t) => t.tipo),
    ).toEqual(['COMPLETO']);
  });
  it('PROPIOS_MEDIOS no genera tramos; el cruce de medianoche se marca', () => {
    expect(
      planificarTramos({ ...op, tipoTransporte: 'PROPIOS_MEDIOS' }, D30),
    ).toEqual([]);
    expect(
      planificarTramos(
        {
          horaInicio: '23:00',
          horaFin: '01:00',
          zonalId: 3,
          tipoTransporte: 'COMPLETO',
        },
        D30,
      )[0].cruzaMedianoche,
    ).toBe(true);
  });
});

describe('PMO en INICIO_Y_FIN (versión consolidada, 2026-10-07)', () => {
  const pmo = {
    horaInicio: '08:00',
    horaFin: '16:00',
    tipoTransporte: 'INICIO_Y_FIN' as const,
    zonalId: 1,
  };

  it('ocupa SOLO el dejar y el retirar, con la duración del parámetro DAF_DURACION_TRAMO_MIN', () => {
    expect(
      planificarTramos(pmo, D30).map((t) => [t.tipo, t.horaInicio, t.horaFin]),
    ).toEqual([
      ['DEJAR', '08:00', '08:30'],
      ['RETIRAR', '15:30', '16:00'],
    ]);
    expect(
      planificarTramos(pmo, { dejar: 45, retirar: 45 }).map((t) => [
        t.horaInicio,
        t.horaFin,
      ]),
    ).toEqual([
      ['08:00', '08:45'],
      ['15:15', '16:00'],
    ]);
  });

  it('entre el dejar y el retirar el conductor queda libre y puede ENCADENAR otro operativo', () => {
    const delPmo = planificarTramos(pmo, D30).map((t) =>
      tramo(t.horaInicio, t.horaFin, NORTE, `PMO (${t.tipo})`),
    );
    const otro = evaluar(
      conductor(),
      null,
      bloque([tramo('10:00', '13:00', NORTE)]),
      delPmo,
      CONTEXTO,
      PARAMETROS,
    );
    expect(otro.duros.map((m) => m.codigo)).not.toContain('SOLAPAMIENTO');

    // El mismo operativo en COMPLETO sí lo ocuparía todo el día.
    const completo = planificarTramos(
      { ...pmo, tipoTransporte: 'COMPLETO' },
      30,
    ).map((t) => tramo(t.horaInicio, t.horaFin));
    const choca = evaluar(
      conductor(),
      null,
      bloque([tramo('10:00', '13:00', NORTE)]),
      completo,
      CONTEXTO,
      PARAMETROS,
    );
    expect(choca.duros.map((m) => m.codigo)).toContain('SOLAPAMIENTO');
  });
});
