/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · optimizador «Cubrir al máximo»
 * Archivo: optimizador-transporte.spec.ts
 * Responsabilidad: Verificar que el optimizador cubre al máximo sin violar la política de asignación.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import type {
  ConductorEvaluado,
  ParametrosAsignacion,
  TramoEvaluado,
  VehiculoEvaluado,
} from './asignacion-conductor.policy';
import { franjaDe } from './linea-de-tiempo';
import {
  optimizar,
  type BloqueOptimizable,
  type ConductorOptimizable,
  type EntradaOptimizador,
  type TramoFijo,
} from './optimizador-transporte';
import type { Lugar } from './traslados';

const INICIO = '05:00';
const NORTE: Lugar = { zonalId: 1, sector: 'NORTE' };

const PARAMETROS: ParametrosAsignacion & { compartirVentanaMin: number } = {
  maxJornadaHoras: 14,
  jornadaAvisoHoras: 12,
  descansoMinHoras: 9,
  traslado: { mismaZona: 15, mismoSector: 30, otroSector: 60 },
  tablaTraslados: new Map(),
  costoAviso: 30,
  costoActivarLibre: 120,
  costoArranqueLejos: 20,
  compartirVentanaMin: 30,
};

const tramo = (
  inicio: string,
  fin: string,
  lugar: Lugar = NORTE,
): TramoEvaluado => ({
  franja: franjaDe(inicio, fin, INICIO),
  origen: lugar,
  destino: lugar,
  etiqueta: `${inicio}-${fin}`,
});

let siguienteTramo = 100;
const bloque = (
  clave: string,
  operativoId: number,
  inicio: string,
  fin: string,
  cambios: Partial<BloqueOptimizable> = {},
): BloqueOptimizable => ({
  clave,
  tramoIds: [(siguienteTramo += 1)],
  tramos: [tramo(inicio, fin)],
  tipos: ['COMPLETO'],
  operativoIds: [operativoId],
  personas: 1,
  esMacrooperativo: false,
  esTareaTaller: false,
  vehiculoFijoId: null,
  ...cambios,
});

const conductor = (
  id: number,
  cambios: Partial<ConductorEvaluado> = {},
  extra: Partial<ConductorOptimizable> = {},
): ConductorOptimizable => ({
  conductor: {
    id,
    nombre: `CONDUCTOR ${id}`,
    tipoContrato: 'OCASIONAL',
    turno: null,
    activado: false,
    ausente: false,
    ultimoFinAyer: null,
    ...cambios,
  },
  ventanaTurno: null,
  vehiculoLlevadoId: null,
  vehiculoHabitualId: null,
  ...extra,
});

const vehiculo = (
  id: number,
  cambios: Partial<VehiculoEvaluado> = {},
): VehiculoEvaluado => ({
  id,
  asientos: 4,
  enTaller: false,
  amaneceEn: null,
  ...cambios,
});

const entrada = (cambios: Partial<EntradaOptimizador>): EntradaOptimizador => ({
  bloques: [],
  conductores: [],
  vehiculos: [vehiculo(10), vehiculo(11), vehiculo(12)],
  fijos: [],
  contexto: {
    esFinDeSemana: false,
    ventanaNombramiento: franjaDe('08:00', '16:30', INICIO),
  },
  parametros: PARAMETROS,
  opciones: { activarLibres: false, compartirCarro: false },
  operativosYaCubiertos: 0,
  ...cambios,
});

describe('optimizador · cubrir al máximo', () => {
  it('dos bloques simultáneos con dos conductores: los dos cubiertos y con placas distintas', () => {
    const p = optimizar(
      entrada({
        bloques: [
          bloque('a', 1, '09:00', '11:00'),
          bloque('b', 2, '09:00', '11:00'),
        ],
        conductores: [conductor(1), conductor(2)],
      }),
    );

    expect(p.cubiertos).toBe(2);
    expect(p.total).toBe(2);
    expect(new Set(p.asignaciones.map((a) => a.conductorId)).size).toBe(2);
    expect(new Set(p.asignaciones.map((a) => a.vehiculoId)).size).toBe(2);
    expect(p.sinRecurso).toHaveLength(0);
  });

  it('ordenar por dificultad cubre lo que el orden por hora deja sin recurso', () => {
    // X lo puede hacer cualquiera; Y termina después del nombramiento: solo el ocasional (1).
    const p = optimizar(
      entrada({
        bloques: [
          bloque('x', 1, '15:00', '16:00'),
          bloque('y', 2, '15:30', '18:00'),
        ],
        conductores: [
          conductor(1),
          conductor(2, { tipoContrato: 'NOMBRAMIENTO' }),
        ],
      }),
    );

    expect(p.cubiertos).toBe(2);
    expect(p.asignaciones.find((a) => a.clave === 'y')?.conductorId).toBe(1);
    expect(p.asignaciones.find((a) => a.clave === 'x')?.conductorId).toBe(2);
  });

  it('sin permiso para activar libres, el bloque queda sin recurso y explica por qué', () => {
    const p = optimizar(
      entrada({
        bloques: [bloque('a', 1, '09:00', '11:00')],
        conductores: [conductor(1, { turno: 'LIBRE' })],
      }),
    );

    expect(p.cubiertos).toBe(0);
    expect(p.activaciones).toHaveLength(0);
    expect(p.sinRecurso).toHaveLength(1);
    expect(p.sinRecurso[0].operativoIds).toEqual([1]);
    expect(p.sinRecurso[0].motivo.length).toBeGreaterThan(0);
  });

  it('con «activar libres» propone activarlo, solo si así cubre más', () => {
    const p = optimizar(
      entrada({
        bloques: [
          bloque('a', 1, '09:00', '11:00'),
          bloque('b', 2, '13:00', '14:00'),
        ],
        conductores: [conductor(1), conductor(2, { turno: 'LIBRE' })],
        opciones: { activarLibres: true, compartirCarro: false },
      }),
    );

    // El conductor 1 cubre los dos sin solaparse: no hace falta el libre.
    expect(p.cubiertos).toBe(2);
    expect(p.activaciones).toHaveLength(0);

    const conLibre = optimizar(
      entrada({
        bloques: [
          bloque('a', 1, '09:00', '11:00'),
          bloque('b', 2, '09:00', '11:00'),
        ],
        conductores: [conductor(1), conductor(2, { turno: 'LIBRE' })],
        opciones: { activarLibres: true, compartirCarro: false },
      }),
    );
    expect(conLibre.cubiertos).toBe(2);
    expect(conLibre.activaciones.map((a) => a.conductorId)).toEqual([2]);
  });

  it('prefiere el vehículo que el conductor se llevó a casa (se le repite al día siguiente)', () => {
    const p = optimizar(
      entrada({
        bloques: [bloque('a', 1, '09:00', '11:00')],
        conductores: [
          conductor(1, {}, { vehiculoLlevadoId: 12, vehiculoHabitualId: 11 }),
        ],
      }),
    );

    expect(p.asignaciones[0].vehiculoId).toBe(12);
  });

  it('no usa una placa en taller ni una en la que no caben las personas', () => {
    const p = optimizar(
      entrada({
        bloques: [bloque('a', 1, '09:00', '11:00', { personas: 6 })],
        conductores: [conductor(1)],
        vehiculos: [
          vehiculo(10, { enTaller: true, asientos: 10 }),
          vehiculo(11, { asientos: 4 }),
          vehiculo(12, { asientos: 8 }),
        ],
      }),
    );

    expect(p.asignaciones[0].vehiculoId).toBe(12);
  });

  it('lo asignado a mano es fijo: su placa no se reutiliza en la misma franja', () => {
    const fijo: TramoFijo = {
      tramoId: 1,
      conductorId: 2,
      vehiculoId: 10,
      tramo: tramo('09:00', '11:00'),
      tipo: 'COMPLETO',
      personas: 1,
      esMacrooperativo: false,
    };
    const p = optimizar(
      entrada({
        bloques: [bloque('a', 1, '09:30', '10:30')],
        conductores: [conductor(1), conductor(2)],
        vehiculos: [vehiculo(10), vehiculo(11)],
        fijos: [fijo],
        operativosYaCubiertos: 1,
      }),
    );

    expect(p.asignaciones[0].conductorId).toBe(1);
    expect(p.asignaciones[0].vehiculoId).toBe(11);
    expect(p.cubiertos).toBe(2);
    expect(p.total).toBe(2);
  });

  it('la TAREA de taller usa su vehículo aunque esté en taller', () => {
    const p = optimizar(
      entrada({
        bloques: [
          bloque('t', 0, '08:00', '09:00', {
            operativoIds: [],
            personas: 0,
            esTareaTaller: true,
            vehiculoFijoId: 10,
            tipos: ['TAREA'],
          }),
        ],
        conductores: [conductor(1)],
        vehiculos: [vehiculo(10, { enTaller: true })],
      }),
    );

    expect(p.asignaciones).toHaveLength(1);
    expect(p.asignaciones[0].vehiculoId).toBe(10);
  });
});

describe('optimizador · compartir carro', () => {
  const base = (
    compartirCarro: boolean,
    cambios: Partial<BloqueOptimizable> = {},
  ) =>
    optimizar(
      entrada({
        bloques: [
          bloque('a', 1, '09:00', '11:00'),
          bloque('b', 2, '09:15', '11:00', cambios),
        ],
        conductores: [conductor(1)],
        opciones: { activarLibres: false, compartirCarro },
      }),
    );

  it('un solo conductor, dos operativos compatibles: el segundo comparte carro', () => {
    const p = base(true);

    expect(p.cubiertos).toBe(2);
    expect(p.compartidos).toHaveLength(1);
    expect(p.sinRecurso).toHaveLength(0);
  });

  it('sin la opción, el segundo queda sin recurso', () => {
    const p = base(false);

    expect(p.cubiertos).toBe(1);
    expect(p.compartidos).toHaveLength(0);
    expect(p.sinRecurso).toHaveLength(1);
  });

  it('un macrooperativo no comparte', () => {
    expect(base(true, { esMacrooperativo: true }).compartidos).toHaveLength(0);
  });

  it('fuera de la ventana de ±30 minutos no comparte', () => {
    const p = optimizar(
      entrada({
        bloques: [
          bloque('a', 1, '09:00', '11:00'),
          bloque('b', 2, '10:00', '11:00'),
        ],
        conductores: [conductor(1)],
        opciones: { activarLibres: false, compartirCarro: true },
      }),
    );
    expect(p.compartidos).toHaveLength(0);
  });

  it('si no caben las personas no comparte', () => {
    expect(base(true, { personas: 4 }).compartidos).toHaveLength(0);
  });
});

describe('optimizador · macrooperativo prioritario (2026-10-07)', () => {
  it('cuando compite por el único conductor, el macrooperativo se cubre primero', () => {
    // Mismo horario, un solo conductor y sin compartir: solo uno puede cubrirse. Aunque el normal
    // empiece antes, el que pide vehículo exclusivo gana el conductor.
    const p = optimizar(
      entrada({
        bloques: [
          bloque('normal', 1, '09:00', '11:00'),
          bloque('macro', 2, '09:15', '11:00', { esMacrooperativo: true }),
        ],
        conductores: [conductor(1)],
      }),
    );

    expect(p.cubiertos).toBe(1);
    expect(p.asignaciones.map((a) => a.clave)).toEqual(['macro']);
    expect(p.sinRecurso.map((s) => s.clave)).toEqual(['normal']);
  });

  it('sin competencia, el orden no cambia lo que se cubre', () => {
    const p = optimizar(
      entrada({
        bloques: [
          bloque('normal', 1, '09:00', '11:00'),
          bloque('macro', 2, '09:00', '11:00', { esMacrooperativo: true }),
        ],
        conductores: [conductor(1), conductor(2)],
      }),
    );

    expect(p.cubiertos).toBe(2);
  });
});

/**
 * Prioridades entre candidatos viables (2026-10-14): continuidad territorial, aprovechar un hueco,
 * mismo vehículo y asientos ajustados, en ese orden estricto.
 */
describe('optimizador · prioridades entre candidatos (2026-10-14)', () => {
  const SUR: Lugar = { zonalId: 2, sector: 'SUR' };
  const fijo = (
    tramoId: number,
    conductorId: number,
    vehiculoId: number,
    inicio: string,
    fin: string,
    lugar: Lugar = NORTE,
  ): TramoFijo => ({
    tramoId,
    conductorId,
    vehiculoId,
    tramo: tramo(inicio, fin, lugar),
    tipo: 'DEJAR',
    personas: 1,
    esMacrooperativo: false,
  });

  it('1 · continuidad territorial: gana quien termina su tramo anterior en la misma zonal', () => {
    const p = optimizar(
      entrada({
        bloques: [bloque('x', 1, '10:00', '11:00')],
        conductores: [conductor(1), conductor(2)],
        // El 1 viene del SUR (60 min) y el 2 de la misma zonal NORTE (15 min).
        fijos: [
          fijo(901, 1, 10, '07:00', '07:30', SUR),
          fijo(902, 2, 11, '07:00', '07:30', NORTE),
        ],
      }),
    );

    expect(p.asignaciones[0].conductorId).toBe(2);
  });

  it('1 · un conductor sin origen conocido no gana por estar «a 0 minutos»', () => {
    const p = optimizar(
      entrada({
        bloques: [bloque('x', 1, '10:00', '11:00')],
        // El 1 no tiene tramos ni vehículo que amanezca en algún sitio; el 2 viene de otro sector.
        conductores: [conductor(1), conductor(2)],
        fijos: [fijo(902, 2, 11, '07:00', '07:30', SUR)],
      }),
    );

    expect(p.asignaciones[0].conductorId).toBe(2);
  });

  it('2 · aprovechar un hueco: gana quien ya tiene un dejar y un retirar alrededor', () => {
    const p = optimizar(
      entrada({
        bloques: [bloque('x', 1, '10:00', '12:00')],
        conductores: [conductor(1), conductor(2)],
        // Los dos vienen de la misma zonal; el 1 además vuelve a las 15H30 (el bloque cae en su
        // hueco y no alarga su jornada), el 2 terminó y se le alargaría.
        fijos: [
          fijo(901, 1, 10, '08:00', '08:30'),
          fijo(903, 1, 10, '15:30', '16:00'),
          fijo(902, 2, 11, '08:00', '08:30'),
        ],
      }),
    );

    expect(p.asignaciones[0].conductorId).toBe(1);
  });

  it('3 · mismo vehículo: a igual continuidad y hueco, gana quien conserva el que se llevó a casa', () => {
    const amanece = { amaneceEn: NORTE };
    const p = optimizar(
      entrada({
        bloques: [bloque('x', 1, '10:00', '11:00')],
        vehiculos: [vehiculo(10, amanece), vehiculo(11, amanece)],
        conductores: [
          conductor(1, {}, { vehiculoHabitualId: 10 }),
          conductor(2, {}, { vehiculoLlevadoId: 11 }),
        ],
      }),
    );

    expect(p.asignaciones[0]).toMatchObject({ conductorId: 2, vehiculoId: 11 });
  });

  it('4 · asientos: a igualdad de lo demás, el vehículo más ajustado a las personas', () => {
    const p = optimizar(
      entrada({
        bloques: [bloque('x', 1, '10:00', '11:00', { personas: 3 })],
        vehiculos: [
          vehiculo(10, { asientos: 12, amaneceEn: NORTE }),
          vehiculo(11, { asientos: 4, amaneceEn: NORTE }),
        ],
        conductores: [
          conductor(1, {}, { vehiculoHabitualId: 10 }),
          conductor(2, {}, { vehiculoHabitualId: 11 }),
        ],
      }),
    );

    expect(p.asignaciones[0]).toMatchObject({ conductorId: 2, vehiculoId: 11 });
  });

  it('RN-44/RN-25 · la restricción que llega en el bloque descarta al conductor', () => {
    const p = optimizar(
      entrada({
        bloques: [
          bloque('x', 1, '10:00', '11:00', {
            restricciones: new Map([
              [
                1,
                [
                  {
                    codigo: 'PATRULLA_DIA_ANTERIOR' as const,
                    mensaje: 'CONDUCTOR 1 condujo en patrulla el día anterior.',
                  },
                ],
              ],
            ]),
          }),
        ],
        conductores: [conductor(1)],
      }),
    );

    expect(p.asignaciones).toHaveLength(0);
    expect(p.sinRecurso[0].motivo).toContain('condujo en patrulla');
  });
});

describe('optimizador · cambio de placa si la de hoy está en el taller (G6, 2026-10-15)', () => {
  const fijoCon = (vehiculoId: number): TramoFijo => ({
    tramoId: 1,
    conductorId: 1,
    vehiculoId,
    tramo: tramo('06:00', '07:00'),
    tipo: 'COMPLETO',
    personas: 1,
    esMacrooperativo: false,
  });

  it('si el vehículo que ya usa hoy está en el taller, se le da otro', () => {
    const p = optimizar(
      entrada({
        bloques: [bloque('a', 1, '09:00', '11:00')],
        conductores: [conductor(1)],
        vehiculos: [vehiculo(10, { enTaller: true }), vehiculo(11)],
        fijos: [fijoCon(10)],
        operativosYaCubiertos: 1,
      }),
    );

    expect(p.asignaciones).toHaveLength(1);
    expect(p.asignaciones[0]).toMatchObject({ conductorId: 1, vehiculoId: 11 });
  });

  it('el nuevo vehículo pasa a ser el «de hoy»: los bloques siguientes lo repiten', () => {
    const p = optimizar(
      entrada({
        bloques: [
          bloque('a', 1, '09:00', '10:00'),
          bloque('b', 2, '11:00', '12:00'),
        ],
        conductores: [conductor(1)],
        vehiculos: [
          vehiculo(10, { enTaller: true }),
          vehiculo(11),
          vehiculo(12),
        ],
        fijos: [fijoCon(10)],
        operativosYaCubiertos: 1,
      }),
    );

    expect(p.asignaciones.map((a) => a.vehiculoId)).toEqual([11, 11]);
  });

  it('por otra razón (no caben las personas) no se le cambia la placa a mitad de jornada', () => {
    const p = optimizar(
      entrada({
        bloques: [bloque('a', 1, '09:00', '11:00', { personas: 6 })],
        conductores: [conductor(1)],
        vehiculos: [
          vehiculo(10, { asientos: 4 }),
          vehiculo(12, { asientos: 8 }),
        ],
        fijos: [fijoCon(10)],
        operativosYaCubiertos: 1,
      }),
    );

    expect(p.asignaciones).toHaveLength(0);
  });
});

describe('optimizador · pedido de compartir unidad (2026-10-19, prioridad suave)', () => {
  // El anfitrión (operativo 1) ya está asignado al conductor 1 con la placa 10. Hay un conductor
  // libre (2) que podría llevar al operativo 2 por su cuenta.
  const fijo: TramoFijo = {
    tramoId: 900,
    operativoId: 1,
    conductorId: 1,
    vehiculoId: 10,
    tramo: tramo('09:00', '09:30'),
    tipo: 'DEJAR',
    personas: 1,
    esMacrooperativo: false,
  };
  const pedido = (cambios: Partial<BloqueOptimizable> = {}) =>
    bloque('b', 2, '09:00', '09:30', { tipos: ['DEJAR'], ...cambios });

  it('sin pedido, el otro conductor lo lleva por su cuenta (no cambia nada)', () => {
    const p = optimizar(
      entrada({
        bloques: [pedido()],
        conductores: [conductor(1), conductor(2)],
        fijos: [fijo],
        opciones: { activarLibres: false, compartirCarro: true },
      }),
    );
    expect(p.compartidos).toHaveLength(0);
    expect(p.asignaciones.map((a) => a.conductorId)).toEqual([2]);
  });

  it('con pedido, primero intenta viajar en la unidad que pidió', () => {
    const p = optimizar(
      entrada({
        bloques: [pedido({ compartirConOperativoId: 1 })],
        conductores: [conductor(1), conductor(2)],
        fijos: [fijo],
        opciones: { activarLibres: false, compartirCarro: true },
      }),
    );
    expect(p.compartidos).toEqual([
      { tramoId: expect.any(Number) as number, compartidoConTramoId: 900 },
    ]);
    expect(p.asignaciones).toHaveLength(0);
    expect(p.cubiertos).toBe(1);
  });

  it('si la regla no lo deja (no cabe), se asigna como siempre', () => {
    const p = optimizar(
      entrada({
        bloques: [pedido({ compartirConOperativoId: 1, personas: 4 })],
        conductores: [conductor(1), conductor(2)],
        fijos: [fijo],
        opciones: { activarLibres: false, compartirCarro: true },
      }),
    );
    expect(p.compartidos).toHaveLength(0);
    expect(p.asignaciones.map((a) => a.conductorId)).toEqual([2]);
  });

  it('sin «compartir carro» el pedido no se aplica', () => {
    const p = optimizar(
      entrada({
        bloques: [pedido({ compartirConOperativoId: 1 })],
        conductores: [conductor(1), conductor(2)],
        fijos: [fijo],
        opciones: { activarLibres: false, compartirCarro: false },
      }),
    );
    expect(p.compartidos).toHaveLength(0);
    expect(p.asignaciones.map((a) => a.conductorId)).toEqual([2]);
  });
});

describe('optimizador · el «completo» deja y retira en su punto (caso 21-OCT, 2026-10-21)', () => {
  // 66 «completo» 08:00–16:30; 67 «solo dejar»; 68 «solo retirar» (pide ir con 66); 69 «dejar y
  // retirar» (pide ir con 66). Una persona cada uno, punto 327. Un solo conductor (53) con 4 asientos.
  const PUNTO = 327;
  const caso = (
    cambios: {
      asientos?: number;
      compartirCarro?: boolean;
      punto?: number;
    } = {},
  ) =>
    entrada({
      bloques: [
        bloque('c66', 66, '08:00', '16:30', {
          tramoIds: [46],
          puntoIds: [PUNTO],
        }),
        bloque('c67', 67, '08:00', '08:30', {
          tramoIds: [47],
          tipos: ['DEJAR'],
          puntoIds: [cambios.punto ?? PUNTO],
        }),
        bloque('c68', 68, '16:00', '16:30', {
          tramoIds: [48],
          tipos: ['RETIRAR'],
          puntoIds: [PUNTO],
          compartirConOperativoId: 66,
        }),
        bloque('c69', 69, '08:00', '08:30', {
          tramoIds: [49, 50],
          tramos: [tramo('08:00', '08:30'), tramo('16:00', '16:30')],
          tipos: ['DEJAR', 'RETIRAR'],
          puntoIds: [PUNTO, PUNTO],
          compartirConOperativoId: 66,
        }),
      ],
      conductores: [conductor(53, {}, { vehiculoHabitualId: 60 })],
      vehiculos: [vehiculo(60, { asientos: cambios.asientos ?? 4 })],
      opciones: {
        activarLibres: false,
        compartirCarro: cambios.compartirCarro ?? true,
      },
    });

  it('con un conductor cubre los 4: el «completo» asignado y los demás en su unidad', () => {
    const p = optimizar(caso());

    expect(p.cubiertos).toBe(4);
    expect(p.sinRecurso).toEqual([]);
    expect(p.asignaciones).toEqual([
      expect.objectContaining({
        tramoIds: [46],
        conductorId: 53,
        vehiculoId: 60,
      }),
    ]);
    expect([...p.compartidos].sort((a, b) => a.tramoId - b.tramoId)).toEqual([
      { tramoId: 47, compartidoConTramoId: 46 },
      { tramoId: 48, compartidoConTramoId: 46 },
      { tramoId: 49, compartidoConTramoId: 46 },
      { tramoId: 50, compartidoConTramoId: 46 },
    ]);
  });

  it('cuenta los asientos POR MOMENTO: con 3 asientos cubre los 4 (3 a las 08:00, 3 a las 16:00)', () => {
    const p = optimizar(caso({ asientos: 3 }));

    expect(p.cubiertos).toBe(4);
    expect(p.sinRecurso).toEqual([]);
    expect(p.compartidos).toHaveLength(4);
  });

  it('con 2 asientos, el que no cabe en su momento queda sin recurso', () => {
    const p = optimizar(caso({ asientos: 2 }));

    // A las 08:00 caben el «completo» y un dejar; a las 16:00, el «completo» y un retiro.
    expect(p.cubiertos).toBe(3);
    expect(p.sinRecurso).toHaveLength(1);
  });

  it('sin «compartir carro» todo sigue como antes: solo el «completo»', () => {
    const p = optimizar(caso({ compartirCarro: false }));

    expect(p.cubiertos).toBe(1);
    expect(p.compartidos).toEqual([]);
  });

  it('un dejar de otro punto no se contiene: queda sin recurso con su motivo', () => {
    const p = optimizar(caso({ punto: 328 }));

    expect(p.sinRecurso.map((s) => s.clave)).toEqual(['c67']);
    expect(p.compartidos.map((c) => c.tramoId)).not.toContain(47);
  });
});
