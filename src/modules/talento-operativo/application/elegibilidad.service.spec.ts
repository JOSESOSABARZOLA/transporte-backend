/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: elegibilidad.service.spec.ts
 * Responsabilidad: Verificar la resolución de umbrales, el contexto y el trabajo por lote.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { EstadoTurno, TipoContrato, type Funcionario } from '@prisma/client';

import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import { RecursoNoEncontradoError } from '../../../common/errors/errores-dominio';
import type { ParametroPoliticaService } from '../../configuracion/application/parametro-politica.service';
import type {
  AsignacionDelDia,
  ElegibilidadRepository,
} from '../infrastructure/elegibilidad.repository';
import { ElegibilidadService } from './elegibilidad.service';

const dia = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);
const MIERCOLES = dia('2026-08-05');

const PARAMETROS: Record<string, string> = {
  DIAS_DESCANSO_PATRULLA: '1',
  TOPE_SALIDAS_PESADAS: '3',
  JORNADA_MAXIMA_HORAS: '12',
  FRANJA_NOCTURNA_INICIO: '20:00',
  FRANJA_NOCTURNA_FIN: '05:00',
  PERIODO_COMPUTO_SALIDAS: 'MENSUAL',
  HORA_TURNO_DIURNO_INICIO: '08:00',
  HORA_TURNO_DIURNO_FIN: '16:30',
  HORA_TURNO_NOCTURNO_INICIO: '17:30',
  HORA_TURNO_NOCTURNO_FIN: '02:00',
  HORA_NOMBRAMIENTO_INICIO: '08:00',
  HORA_NOMBRAMIENTO_FIN: '16:00',
  // Índice de carga / fatiga (los mismos valores que siembra la migración 20260924140000).
  FATIGA_UMBRAL_AMBAR: '6',
  FATIGA_UMBRAL_ROJO: '10',
  PESO_HORAS_DIA: '1',
  PESO_SALIDAS_PESADAS: '2',
  PESO_PATRULLA_RECIENTE: '3',
  // Acumulación por período de equidad (migración 20260925120000).
  PERIODO_EQUIDAD: 'SEMANAL',
  PESO_CARGA_PERIODO: '1',
};

const funcionario = (
  id: number,
  parcial: Partial<Funcionario> = {},
): Funcionario =>
  ({
    id,
    cedula: `171003406${id}`,
    apellidos: 'BENAVIDES',
    nombres: 'FERNANDO',
    telefono: '98 514 4231',
    cargo: 'Inspector',
    area: 'GENERAL',
    tipoContrato: TipoContrato.OCASIONAL,
    direccion: 'DMIP_INSPECCIONES',
    activo: true,
    creadoEn: new Date(),
    actualizadoEn: new Date(),
    ...parcial,
  }) as unknown as Funcionario;

const armar = (
  opciones: {
    parametros?: Record<string, string>;
    personas?: Funcionario[];
    ausencias?: Map<number, { estado: string; hasta: Date }>;
    asignaciones?: AsignacionDelDia[];
    patrullas?: Map<number, Date>;
    salidas?: Map<number, number>;
    turnos?: Map<number, EstadoTurno>;
    /** Conductores conocidos (id → nombre) para el evaluador por lote. */
    nombresConductores?: Map<number, string>;
    /** RN-44 del conductor: patrullas que condujo, por tramos. */
    patrullasConductores?: {
      conductorId: number;
      fecha: Date;
      operativoId: number;
    }[];
    /** Semáforo de carga por lote (advisory): horas del día por conductor. */
    horasConductor?: Map<number, number>;
    /** Semáforo de carga por lote (advisory): salidas del período de los conductores. */
    salidasConductores?: {
      conductorId: number;
      operativoId: number;
      fecha: Date;
      esNocturno: boolean;
    }[];
    /** Horas acumuladas en el período de equidad por persona (arrastre de carga). */
    horasPeriodo?: Map<number, number>;
    /** Operativos asignados en el período de equidad por persona (conteo, junto a las horas). */
    operativosPeriodo?: Map<number, number>;
  } = {},
) => {
  const valores = { ...PARAMETROS, ...(opciones.parametros ?? {}) };

  const salidasPesadasEnPeriodo = jest
    .fn()
    .mockResolvedValue(opciones.salidas ?? new Map());

  // Las funciones simuladas que se pasan a expect() se conservan aparte del objeto:
  // tomarlas como `repositorio.metodo` las desligaría de él.
  const buscarFuncionarios = jest
    .fn()
    .mockResolvedValue(opciones.personas ?? [funcionario(1)]);
  const ausenciasEnFecha = jest
    .fn()
    .mockResolvedValue(opciones.ausencias ?? new Map());
  const asignacionesDelDia = jest
    .fn()
    .mockResolvedValue(opciones.asignaciones ?? []);
  const ultimasPatrullas = jest
    .fn()
    .mockResolvedValue(opciones.patrullas ?? new Map());
  const turnosEnFecha = jest
    .fn()
    .mockResolvedValue(opciones.turnos ?? new Map());

  const repositorio = {
    buscarFuncionarios,
    ausenciasEnFecha,
    asignacionesDelDia,
    ultimasPatrullas,
    salidasPesadasEnPeriodo,
    turnosEnFecha,
    nombresDeConductores: jest
      .fn()
      .mockResolvedValue(
        opciones.nombresConductores ?? new Map([[1, 'VIVANCO JORGE']]),
      ),
    patrullasDeConductores: jest
      .fn()
      .mockResolvedValue(opciones.patrullasConductores ?? []),
    horasConducidasDelDiaDeVarios: jest
      .fn()
      .mockResolvedValue(opciones.horasConductor ?? new Map()),
    salidasDeConductoresEnPeriodo: jest
      .fn()
      .mockResolvedValue(opciones.salidasConductores ?? []),
    horasAsignadasEnPeriodo: jest
      .fn()
      .mockResolvedValue(opciones.horasPeriodo ?? new Map()),
    operativosAsignadosEnPeriodo: jest
      .fn()
      .mockResolvedValue(opciones.operativosPeriodo ?? new Map()),
  } as unknown as ElegibilidadRepository;

  const parametros = {
    obtenerEntero: jest
      .fn()
      .mockImplementation((clave: string) =>
        Promise.resolve(Number(valores[clave])),
      ),
    obtenerDecimal: jest
      .fn()
      .mockImplementation((clave: string) =>
        Promise.resolve(Number(valores[clave])),
      ),
    obtenerTexto: jest
      .fn()
      .mockImplementation((clave: string) => Promise.resolve(valores[clave])),
  } as unknown as ParametroPoliticaService;

  return {
    servicio: new ElegibilidadService(repositorio, parametros),
    buscarFuncionarios,
    ausenciasEnFecha,
    asignacionesDelDia,
    ultimasPatrullas,
    salidasPesadasEnPeriodo,
    turnosEnFecha,
  };
};

const CONTEXTO = {
  fecha: MIERCOLES,
  horaInicio: '08:00',
  horaFin: '16:00',
  esPatrulla: false,
};

describe('ElegibilidadService · veredicto', () => {
  it('devuelve elegible cuando no hay antecedentes', async () => {
    const { servicio } = armar();

    expect(await servicio.verificar(1, CONTEXTO)).toEqual({ elegible: true });
  });

  it('un identificador que no está en el maestro produce 404, no «no elegible»', async () => {
    // Confundir un dato equivocado con una regla incumplida ocultaría el error real.
    const { servicio } = armar({ personas: [] });

    await expect(servicio.verificar(99, CONTEXTO)).rejects.toBeInstanceOf(
      RecursoNoEncontradoError,
    );
  });

  it('DERIVA `esNocturno` de la franja configurada, no lo recibe de quien pregunta', async () => {
    const { servicio } = armar({
      personas: [funcionario(1, { tipoContrato: TipoContrato.NOMBRAMIENTO })],
    });

    // 21H00 a 23H00 cae dentro de 20H00–05H00: nocturno.
    const nocturno = await servicio.verificar(1, {
      ...CONTEXTO,
      horaInicio: '21:00',
      horaFin: '23:00',
    });
    expect(nocturno.codigo).toBe(CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO);

    // El mismo nombramiento en horario diurno sí puede.
    expect((await servicio.verificar(1, CONTEXTO)).elegible).toBe(true);
  });

  it('el nombramiento fuera de su ventana se bloquea aunque la franja diga que no es nocturno', async () => {
    const { servicio } = armar({
      personas: [funcionario(1, { tipoContrato: TipoContrato.NOMBRAMIENTO })],
      parametros: { FRANJA_NOCTURNA_INICIO: '23:00' },
    });

    // 21H00 a 22H30 ya NO es nocturno (la franja arranca a las 23H00), pero cae FUERA de la
    // jornada del nombramiento (08H00–16H00): la ventana estricta lo bloquea igual (2026-09-22).
    const veredicto = await servicio.verificar(1, {
      ...CONTEXTO,
      horaInicio: '21:00',
      horaFin: '22:30',
    });

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO);
  });

  it('DERIVA el fin de semana de la fecha', async () => {
    const { servicio } = armar({
      personas: [funcionario(1, { tipoContrato: TipoContrato.NOMBRAMIENTO })],
    });

    const veredicto = await servicio.verificar(1, {
      ...CONTEXTO,
      fecha: dia('2026-08-08'),
    });

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO);
    expect(veredicto.motivo).toContain('fin de semana');
  });

  it('caso 10 del plan · el umbral sale del parámetro en cada verificación', async () => {
    // Cuatro horas ya asignadas más las ocho del nuevo operativo son doce: justo el
    // umbral vigente, y por encima del de ocho.
    const asignaciones: AsignacionDelDia[] = [
      {
        funcionarioId: 1,
        operativoId: 10,
        identificador: 'OCF-001',
        horaInicio: '00:00',
        horaFin: '04:00',
        horas: 4,
      },
    ];

    const conDoce = armar({ asignaciones });
    expect((await conDoce.servicio.verificar(1, CONTEXTO)).elegible).toBe(true);

    const conOcho = armar({
      asignaciones,
      parametros: { JORNADA_MAXIMA_HORAS: '8' },
    });
    expect((await conOcho.servicio.verificar(1, CONTEXTO)).codigo).toBe(
      CODIGOS_ERROR.JORNADA_MAXIMA_SUPERADA,
    );
  });

  it('rechaza un horario que no cumple la granularidad antes de consultar nada', async () => {
    const { servicio } = armar();

    await expect(
      servicio.verificar(1, { ...CONTEXTO, horaInicio: '08:15' }),
    ).rejects.toThrow();
  });

  it('el turno DESCANSO de la cobertura excluye a la persona ese día', async () => {
    const { servicio } = armar({
      personas: [funcionario(1, { area: 'INSTRUCCION' })],
      turnos: new Map([[1, EstadoTurno.DESCANSO]]),
    });

    const veredicto = await servicio.verificar(1, CONTEXTO);

    expect(veredicto.elegible).toBe(false);
    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PERSONA_EN_DESCANSO);
    expect(veredicto.motivo).toContain('descanso');
  });

  it('sin turno en la cobertura, la persona sigue siendo elegible', async () => {
    // Quien no es de Instrucción no tiene cobertura: el mapa llega vacío.
    const { servicio } = armar({ turnos: new Map() });

    expect((await servicio.verificar(1, CONTEXTO)).elegible).toBe(true);
  });

  it('la ausencia manda sobre el descanso: su mensaje trae la fecha de retorno', async () => {
    const { servicio } = armar({
      personas: [funcionario(1, { area: 'INSTRUCCION' })],
      ausencias: new Map([
        [1, { estado: 'VACACIONES', hasta: dia('2026-08-20') }],
      ]),
      turnos: new Map([[1, EstadoTurno.DESCANSO]]),
    });

    const veredicto = await servicio.verificar(1, CONTEXTO);

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.PERSONA_NO_DISPONIBLE);
  });

  it('turno DIURNO: un operativo dentro de la ventana (08:00–16:30) es elegible', async () => {
    const { servicio } = armar({
      personas: [funcionario(1, { area: 'INSTRUCCION' })],
      turnos: new Map([[1, EstadoTurno.DIURNO]]),
    });

    // CONTEXTO es 08:00–16:00, dentro de la ventana diurna.
    expect((await servicio.verificar(1, CONTEXTO)).elegible).toBe(true);
  });

  it('turno DIURNO: un operativo fuera de la ventana se rechaza', async () => {
    const { servicio } = armar({
      personas: [funcionario(1, { area: 'INSTRUCCION' })],
      turnos: new Map([[1, EstadoTurno.DIURNO]]),
    });

    const veredicto = await servicio.verificar(1, {
      ...CONTEXTO,
      horaInicio: '17:00',
      horaFin: '19:00',
    });

    expect(veredicto.elegible).toBe(false);
    expect(veredicto.codigo).toBe(CODIGOS_ERROR.TURNO_FUERA_DE_RANGO);
    expect(veredicto.motivo).toContain('diurno');
  });

  it('turno NOCTURNO: un operativo que cruza la medianoche dentro de 17:30–02:00 es elegible', async () => {
    const { servicio } = armar({
      personas: [
        funcionario(1, {
          tipoContrato: TipoContrato.OCASIONAL,
          area: 'INSTRUCCION',
        }),
      ],
      turnos: new Map([[1, EstadoTurno.NOCTURNO]]),
    });

    const veredicto = await servicio.verificar(1, {
      ...CONTEXTO,
      horaInicio: '22:00',
      horaFin: '01:00',
    });

    expect(veredicto.elegible).toBe(true);
  });

  it('turno NOCTURNO: un operativo diurno queda fuera de la ventana', async () => {
    const { servicio } = armar({
      personas: [funcionario(1, { area: 'INSTRUCCION' })],
      turnos: new Map([[1, EstadoTurno.NOCTURNO]]),
    });

    // 08:00–16:00 no cae en 17:30–02:00.
    const veredicto = await servicio.verificar(1, CONTEXTO);

    expect(veredicto.codigo).toBe(CODIGOS_ERROR.TURNO_FUERA_DE_RANGO);
    expect(veredicto.motivo).toContain('nocturno');
  });
});

describe('ElegibilidadService · trabajo por lote', () => {
  it('consulta los antecedentes UNA vez para todo el grupo', async () => {
    const {
      servicio,
      buscarFuncionarios,
      ausenciasEnFecha,
      asignacionesDelDia,
      ultimasPatrullas,
    } = armar({
      personas: [funcionario(1), funcionario(2), funcionario(3)],
    });

    await servicio.verificarVarios([1, 2, 3], CONTEXTO);

    expect(buscarFuncionarios).toHaveBeenCalledTimes(1);
    expect(ausenciasEnFecha).toHaveBeenCalledTimes(1);
    expect(asignacionesDelDia).toHaveBeenCalledTimes(1);
    expect(ultimasPatrullas).toHaveBeenCalledTimes(1);
  });

  it('devuelve un veredicto por persona, en el mismo orden', async () => {
    const { servicio } = armar({
      personas: [
        funcionario(1),
        funcionario(2, { tipoContrato: TipoContrato.NOMBRAMIENTO }),
      ],
      ausencias: new Map([
        [1, { estado: 'VACACIONES', hasta: dia('2026-08-15') }],
      ]),
    });

    const veredictos = await servicio.verificarVarios([1, 2], CONTEXTO);

    expect(veredictos.map((v) => v.funcionarioId)).toEqual([1, 2]);
    expect(veredictos[0].veredicto.codigo).toBe(
      CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
    );
    expect(veredictos[1].veredicto.elegible).toBe(true);
  });

  /**
   * `filtrarElegibles` se retiró el 2026-08-11 al resolver PV-37. Devolvía un conjunto
   * de identificadores y **descartaba el motivo**, que es justo lo que la pantalla
   * necesitaba para explicar por qué falta alguien. Su único consumidor pasó a
   * `verificarVarios`, y un método sin consumidores es código muerto.
   */
  it('el veredicto por lote conserva el motivo de cada rechazo', async () => {
    const { servicio } = armar({
      personas: [funcionario(1), funcionario(2)],
      ausencias: new Map([
        [2, { estado: 'PERMISO', hasta: dia('2026-08-06') }],
      ]),
    });

    const veredictos = await servicio.verificarVarios([1, 2], CONTEXTO);

    expect(veredictos[0].veredicto.elegible).toBe(true);
    expect(veredictos[1].veredicto.elegible).toBe(false);
    expect(veredictos[1].veredicto.motivo).toBeTruthy();
  });

  it('con la lista vacía no consulta nada', async () => {
    const { servicio, buscarFuncionarios } = armar();

    expect(await servicio.verificarVarios([], CONTEXTO)).toEqual([]);
    expect(buscarFuncionarios).not.toHaveBeenCalled();
  });
});

describe('ElegibilidadService · período de cómputo (RN-37)', () => {
  /** Las dos fechas con las que se consultó el período, en `AAAA-MM-DD`. */
  const periodoUsado = (mock: jest.Mock): string[] => {
    const [, desde, hasta] = mock.mock.calls[0] as [number[], Date, Date];
    return [desde, hasta].map((fecha) => fecha.toISOString().slice(0, 10));
  };

  it('MENSUAL toma el mes de calendario', async () => {
    const { servicio, salidasPesadasEnPeriodo } = armar();

    await servicio.verificar(1, CONTEXTO);

    expect(periodoUsado(salidasPesadasEnPeriodo)).toEqual([
      '2026-08-01',
      '2026-08-31',
    ]);
  });

  it('SEMANAL toma de lunes a domingo', async () => {
    const { servicio, salidasPesadasEnPeriodo } = armar({
      parametros: { PERIODO_COMPUTO_SALIDAS: 'SEMANAL' },
    });

    // El 5 de agosto de 2026 es miércoles.
    await servicio.verificar(1, CONTEXTO);

    expect(periodoUsado(salidasPesadasEnPeriodo)).toEqual([
      '2026-08-03',
      '2026-08-09',
    ]);
  });

  it('QUINCENAL parte el mes en dos', async () => {
    const primera = armar({
      parametros: { PERIODO_COMPUTO_SALIDAS: 'QUINCENAL' },
    });
    await primera.servicio.verificar(1, CONTEXTO);
    expect(periodoUsado(primera.salidasPesadasEnPeriodo)).toEqual([
      '2026-08-01',
      '2026-08-15',
    ]);

    const segunda = armar({
      parametros: { PERIODO_COMPUTO_SALIDAS: 'QUINCENAL' },
    });
    await segunda.servicio.verificar(1, {
      ...CONTEXTO,
      fecha: dia('2026-08-20'),
    });
    expect(periodoUsado(segunda.salidasPesadasEnPeriodo)).toEqual([
      '2026-08-16',
      '2026-08-31',
    ]);
  });
});

describe('ElegibilidadService · índice de carga y fatiga (calcularCargas)', () => {
  it('sin antecedentes, el índice es 0 y el nivel VERDE', async () => {
    const { servicio } = armar();

    const cargas = await servicio.calcularCargas([1], MIERCOLES);

    expect(cargas.get(1)).toMatchObject({
      indiceCarga: 0,
      nivelFatiga: 'VERDE',
    });
  });

  it('trae el conteo de operativos asignados en el período (junto a las horas)', async () => {
    // El conteo acompaña al índice: 4 operativos en la semana. No cambia el índice (son horas),
    // solo se expone para mostrarlo en el reparto.
    const { servicio } = armar({ operativosPeriodo: new Map([[1, 4]]) });

    const cargas = await servicio.calcularCargas([1], MIERCOLES);

    expect(cargas.get(1)?.operativos).toBe(4);
  });

  it('sin operativos en el período, el conteo es 0', async () => {
    const { servicio } = armar();

    const cargas = await servicio.calcularCargas([1], MIERCOLES);

    expect(cargas.get(1)?.operativos).toBe(0);
  });

  it('pondera las salidas pesadas del período', async () => {
    // 3 salidas · peso 2 = 6 → cae en el corte ámbar.
    const { servicio } = armar({ salidas: new Map([[1, 3]]) });

    const cargas = await servicio.calcularCargas([1], MIERCOLES);

    expect(cargas.get(1)?.indiceCarga).toBe(6);
    expect(cargas.get(1)?.nivelFatiga).toBe('AMBAR');
  });

  it('suma las horas ya asignadas en el día', async () => {
    const { servicio } = armar({
      asignaciones: [
        {
          funcionarioId: 1,
          operativoId: 10,
          identificador: 'OCF-001',
          horaInicio: '08:00',
          horaFin: '13:00',
          horas: 5,
        },
      ],
    });

    const cargas = await servicio.calcularCargas([1], MIERCOLES);

    expect(cargas.get(1)?.indiceCarga).toBe(5); // 5 h · peso 1
  });

  it('una patrulla reciente (dentro del descanso) suma; una antigua no', async () => {
    const reciente = armar({ patrullas: new Map([[1, dia('2026-08-04')]]) });
    const antigua = armar({ patrullas: new Map([[1, dia('2026-08-01')]]) });

    // Ayer respecto del miércoles 5: 1 día ≤ DIAS_DESCANSO_PATRULLA (1) → reciente, +3.
    expect(
      (await reciente.servicio.calcularCargas([1], MIERCOLES)).get(1)
        ?.indiceCarga,
    ).toBe(3);
    // Cuatro días atrás: fuera de la ventana → no suma.
    expect(
      (await antigua.servicio.calcularCargas([1], MIERCOLES)).get(1)
        ?.indiceCarga,
    ).toBe(0);
  });

  it('acumula las horas del PERÍODO (otros días) al índice — el "arrastre"', async () => {
    // Ese día no tiene operativo (horasDia 0), pero la semana suma 9 h → 9 → media. Es el caso
    // del 25 (9 h) que se refleja el 26.
    const { servicio } = armar({ horasPeriodo: new Map([[1, 9]]) });

    const cargas = await servicio.calcularCargas([1], MIERCOLES);

    expect(cargas.get(1)?.indiceCarga).toBe(9);
    expect(cargas.get(1)?.nivelFatiga).toBe('AMBAR');
  });

  it('NO cuenta dos veces las horas de hoy en el período', async () => {
    // Hoy: 8,5 h. El total del período es 8,5 (solo hoy) → horasPeriodo = 0. Índice = 8,5, no 17.
    const { servicio } = armar({
      asignaciones: [
        {
          funcionarioId: 1,
          operativoId: 10,
          identificador: 'OCF-001',
          horaInicio: '08:00',
          horaFin: '16:30',
          horas: 8.5,
        },
      ],
      horasPeriodo: new Map([[1, 8.5]]),
    });

    const cargas = await servicio.calcularCargas([1], MIERCOLES);

    expect(cargas.get(1)?.indiceCarga).toBe(8.5);
  });

  it('reúne los antecedentes UNA vez para todo el grupo (sin N+1)', async () => {
    const { servicio, buscarFuncionarios, salidasPesadasEnPeriodo } = armar({
      personas: [funcionario(1), funcionario(2), funcionario(3)],
    });

    await servicio.calcularCargas([1, 2, 3], MIERCOLES);

    expect(buscarFuncionarios).toHaveBeenCalledTimes(1);
    expect(salidasPesadasEnPeriodo).toHaveBeenCalledTimes(1);
  });

  it('con la lista vacía no consulta nada', async () => {
    const { servicio, buscarFuncionarios } = armar();

    expect((await servicio.calcularCargas([], MIERCOLES)).size).toBe(0);
    expect(buscarFuncionarios).not.toHaveBeenCalled();
  });
});

describe('ElegibilidadService · evaluador de conducción por tramos (POL-02)', () => {
  const PATRULLA = { esPatrulla: true, esNocturno: false, operativoIds: [100] };

  it('un conductor sin antecedentes puede tomar la patrulla', async () => {
    const { servicio } = armar();

    const evaluar = await servicio.evaluadorDeConduccion([1], MIERCOLES);

    expect(evaluar(1, PATRULLA)).toEqual([]);
  });

  it('RN-44 · quien condujo en patrulla el día anterior no repite', async () => {
    const { servicio } = armar({
      patrullasConductores: [
        { conductorId: 1, fecha: dia('2026-08-04'), operativoId: 7 },
      ],
    });

    const evaluar = await servicio.evaluadorDeConduccion([1], MIERCOLES);

    expect(evaluar(1, PATRULLA).map((v) => v.codigo)).toEqual([
      CODIGOS_ERROR.CONDUCTOR_PATRULLA_CONSECUTIVA,
    ]);
  });

  it('RN-25 · cuenta solo las salidas pesadas del período', async () => {
    const { servicio } = armar({
      salidasConductores: [1, 2, 3].map((operativoId) => ({
        conductorId: 1,
        operativoId,
        fecha: MIERCOLES,
        esNocturno: true,
      })),
    });

    const evaluar = await servicio.evaluadorDeConduccion([1], MIERCOLES);

    expect(
      evaluar(1, {
        esPatrulla: false,
        esNocturno: true,
        operativoIds: [100],
      }).map((v) => v.codigo),
    ).toEqual([CODIGOS_ERROR.TOPE_SALIDAS_PESADAS]);
    // Un bloque diurno de miércoles no es pesado: el tope no aplica.
    expect(
      evaluar(1, { esPatrulla: false, esNocturno: false, operativoIds: [100] }),
    ).toEqual([]);
  });

  it('un conductor que no está en la lista no recibe restricciones', async () => {
    const { servicio } = armar();

    const evaluar = await servicio.evaluadorDeConduccion([1], MIERCOLES);

    expect(evaluar(99, PATRULLA)).toEqual([]);
  });
});

describe('ElegibilidadService · carga del conductor (advisory)', () => {
  it('sin carga, el índice es 0 y VERDE', async () => {
    const { servicio } = armar();

    const cargas = await servicio.calcularCargasConductores([1], MIERCOLES);

    expect(cargas.get(1)).toMatchObject({
      indiceCarga: 0,
      nivelFatiga: 'VERDE',
    });
  });

  it('suma las horas ya conducidas ese día', async () => {
    const { servicio } = armar({ horasConductor: new Map([[1, 7]]) });

    const cargas = await servicio.calcularCargasConductores([1], MIERCOLES);

    expect(cargas.get(1)?.indiceCarga).toBe(7); // 7 h · peso 1
    expect(cargas.get(1)?.nivelFatiga).toBe('AMBAR'); // ≥ 6
  });

  it('cuenta las salidas pesadas del período (nocturnas o de fin de semana)', async () => {
    const { servicio } = armar({
      salidasConductores: [
        { conductorId: 1, operativoId: 1, fecha: MIERCOLES, esNocturno: true },
        { conductorId: 1, operativoId: 2, fecha: MIERCOLES, esNocturno: true },
        // Una diurna en día laborable NO es pesada: no suma.
        { conductorId: 1, operativoId: 9, fecha: MIERCOLES, esNocturno: false },
      ],
    });

    const cargas = await servicio.calcularCargasConductores([1], MIERCOLES);

    expect(cargas.get(1)?.indiceCarga).toBe(4); // 2 pesadas · peso 2
  });

  it('con la lista vacía no calcula nada', async () => {
    const { servicio } = armar();

    expect((await servicio.calcularCargasConductores([], MIERCOLES)).size).toBe(
      0,
    );
  });
});
