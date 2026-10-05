/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: orden-servicio.service.spec.ts
 * Responsabilidad: Verificar la emisión, la reemisión y la consulta propia.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { AccionAuditoria, RolDepartamental } from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  AutorizacionError,
  RecursoNoEncontradoError,
  ReglaNegocioError,
} from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type { ParametroPoliticaService } from '../../configuracion/application/parametro-politica.service';
import type { FirmaDigitalClient } from '../infrastructure/firma-digital.client';
import type { DatoAislado } from '../domain/dato-aislado';
import type {
  DatosOrden,
  OperativoParaOrden,
  OrdenServicioRepository,
  VigenteAnterior,
} from '../infrastructure/orden-servicio.repository';
import * as exportador from './exportador-orden-memorando';
import { OrdenServicioService } from './orden-servicio.service';

const CLIENTE = { marca: 'transaccion' };
const JORNADA = new Date(Date.UTC(2026, 6, 31));
/** El emisor por defecto: un Director en sesión (F21), con nombre y roles como los arma la guarda. */
const DIRECTOR = {
  usuarioId: 5,
  nombre: 'CARRERA LUIS',
  roles: [RolDepartamental.DIRECTOR],
};

/**
 * Datos generales del Director COMPLETOS: con ellos (y la config del día) la plantilla por defecto
 * —que usa {{direccionResponsable}}, {{numeroMemorando}}, {{fechaMemorando}} y {{designado}}— no deja
 * faltantes de origen «plantilla», así que el borrador puede numerar. Incluyen el FIRMANTE (nombre,
 * cargo y dependencia), que desde el 2026-10-02 vive en los datos generales de la plantilla.
 */
const DATOS_GENERALES_LLENOS = {
  direccionResponsable: 'Dirección Metropolitana de Inspección',
  numeroMemorando: 'M-1',
  fechaMemorando: '2026-06-17',
  designado: 'Mgs. CARRERA LUIS (Director)',
  firmante: 'Mgs. CARRERA LUIS',
  firmanteCargo: 'Director Metropolitano',
  firmanteDependencia: 'Dirección Metropolitana de Inspección',
};

const persona = (funcionarioId: number, apellidos: string) => ({
  funcionarioId,
  esResponsable: false,
  funcionario: {
    id: funcionarioId,
    apellidos,
    nombres: 'NOMBRE',
    cargo: null,
    // La dependencia del destinatario se DERIVA de la dirección (2026-10-02): toda ficha la tiene.
    direccion: RolDepartamental.DMIP_OPERATIVOS,
  },
});

const operativo = (parcial: Record<string, unknown> = {}): OperativoParaOrden =>
  ({
    id: 500,
    identificador: 'ICNECU-001-31-JUL-2026',
    horaInicio: '18:00',
    horaFin: '23:30',
    activo: true,
    cuadro: { id: 9, fecha: JORNADA },
    personal: [persona(101, 'BENAVIDES')],
    conductor: {
      id: 70,
      nombreCompleto: 'VIVANCO JORGE',
      telefono: '0978631797',
    },
    vehiculo: { id: 80, placa: 'PMA7892' },
    ...parcial,
  }) as unknown as OperativoParaOrden;

const armar = (
  opciones: {
    operativoActual?: OperativoParaOrden | null;
    emisionesPrevias?: number;
    anuladas?: number;
    funcionarioDeUsuario?: number | null;
    /** La orden vigente anterior (si la hay) que la reemisión copia. */
    anterior?: VigenteAnterior | null;
    /** El siguiente secuencial que entrega el contador atómico. */
    siguienteSecuencial?: number;
    /** El cargo/dependencia del firmante que están configurados (vacío = sin configurar → faltante). */
    firmanteCargo?: string;
    firmanteDependencia?: string;
    /** Parámetros de config del documento (D13): vacío = sin configurar. */
    ciudad?: string;
    siglasUnidad?: string;
    /** Config del memorando POR CUADRO (D13, 2026-10-02): NUT y elaborado por (del día). */
    configCuadro?: {
      nut: string | null;
      elaboradoPor: string | null;
    };
    /**
     * Datos generales del Director en la plantilla (2026-10-02): dirección, memorando, fecha y
     * designado. `null` = aún sin guardar → el servicio usa los de omisión (solo dirección llena).
     */
    datosGenerales?: {
      direccionResponsable?: string;
      numeroMemorando?: string;
      fechaMemorando?: string;
      designado?: string;
      firmante?: string;
      firmanteCargo?: string;
      firmanteDependencia?: string;
    } | null;
    /** Borradores de la jornada que devuelve el repositorio al guardar la config del cuadro. */
    borradores?: unknown[];
  } = {},
) => {
  const {
    operativoActual = operativo(),
    emisionesPrevias = 0,
    anuladas = 0,
    funcionarioDeUsuario = 101,
    anterior = null,
    siguienteSecuencial = 5572,
    firmanteCargo = '',
    firmanteDependencia = '',
    ciudad = '',
    siglasUnidad = '',
    configCuadro = { nut: null, elaboradoPor: null },
    datosGenerales = null,
    borradores = [],
  } = opciones;

  /** Lo que el servicio pidió guardar, con tipo, para poder afirmar sobre ello. */
  const emitidas: DatosOrden[] = [];

  const crear = jest.fn().mockImplementation((datos: DatosOrden) => {
    emitidas.push(datos);
    // Como la fila real: lleva la fecha de emisión (con ella se elige el contador del año).
    return Promise.resolve({
      id: emitidas.length,
      emitidaEn: new Date('2026-07-31T12:00:00Z'),
      ...datos,
    });
  });

  const anularVigentes = jest.fn().mockResolvedValue(anuladas);
  const contarEmisiones = jest.fn().mockResolvedValue(emisionesPrevias);
  const listarDeOperativo = jest.fn().mockResolvedValue([]);
  const listarDeFuncionario = jest.fn().mockResolvedValue([]);
  const vigenteAnterior = jest.fn().mockResolvedValue(anterior);
  const siguienteSecuencialMock = jest
    .fn()
    .mockResolvedValue(siguienteSecuencial);
  const asignarNumero = jest.fn().mockResolvedValue(undefined);
  const paraCompletar = jest.fn().mockResolvedValue(null);
  const buscarPorCodigo = jest.fn().mockResolvedValue(null);
  const actualizarEditables = jest.fn().mockResolvedValue(undefined);
  const actualizarFirmante = jest.fn().mockResolvedValue(undefined);
  const obtenerConfigCuadro = jest.fn().mockResolvedValue(configCuadro);
  const upsertConfigCuadro = jest.fn().mockResolvedValue(undefined);
  const borradoresSinNumeroDeCuadro = jest.fn().mockResolvedValue(borradores);
  // Plantilla por Director (2026-10-05): los borradores de ESE Director al guardar su plantilla.
  const borradoresDeDirector = jest.fn().mockResolvedValue(borradores);
  const registrar = jest.fn().mockResolvedValue(undefined);
  const log = jest.fn();
  // Ficha del Director en sesión para la sugerencia del firmante (2026-10-05).
  const fichaFirmante = jest.fn().mockResolvedValue({
    nombres: 'LUIS ALBERTO',
    apellidos: 'CARRERA POZO',
    cargo: 'Funcionario Directivo 9',
    direccion: RolDepartamental.DIRECTOR,
  });
  // El firmante vive ahora en los DATOS GENERALES de la plantilla (2026-10-02): se arma el bloque a
  // partir de las opciones del test. El nombre por defecto es el del Director en sesión y el
  // cargo/dependencia salen de `firmanteCargo`/`firmanteDependencia`, salvo que `datosGenerales` ya
  // los traiga. `datosGenerales: null` = aún sin guardar (solo la dirección por defecto).
  const datosGeneralesMock = {
    direccionResponsable:
      datosGenerales?.direccionResponsable ??
      'Dirección Metropolitana de Inspección',
    numeroMemorando: datosGenerales?.numeroMemorando ?? '',
    fechaMemorando: datosGenerales?.fechaMemorando ?? '',
    designado: datosGenerales?.designado ?? '',
    firmante: datosGenerales?.firmante ?? 'CARRERA LUIS',
    firmanteCargo: datosGenerales?.firmanteCargo ?? firmanteCargo,
    firmanteDependencia:
      datosGenerales?.firmanteDependencia ?? firmanteDependencia,
  };
  // PLANTILLA POR DIRECTOR (2026-10-05). La del Director en sesión (id 77, versión 1) trae los
  // apartados de omisión (null) y los datos generales armados arriba. Cada orden se resuelve con SU
  // versión del historial: aquí cualquier versión pedida devuelve esos mismos datos, y la BASE también
  // (para no repetir el par plantilla/versión en cada fixture); las pruebas de propiedad y de
  // resolución por versión fijan datos distintos con `versionesDePlantilla`.
  const plantillaDeDirector = jest.fn().mockResolvedValue({
    id: 77,
    directorId: DIRECTOR.usuarioId,
    version: 1,
    apartados: null,
    datosGenerales: datosGeneralesMock,
  });
  const plantillaBase = jest.fn().mockResolvedValue({
    id: 6,
    directorId: null,
    version: 1,
    apartados: null,
    datosGenerales: datosGeneralesMock,
  });
  const crearPlantillaDirector = jest.fn();
  const guardarNuevaVersion = jest.fn().mockResolvedValue(2);
  const versionesDePlantilla = jest.fn(
    (pares: { plantillaId: number; version: number }[]) =>
      Promise.resolve(
        pares.map((par) => ({
          ...par,
          apartados: null,
          datosGenerales: datosGeneralesMock,
        })),
      ),
  );
  const usuarioParaPlantilla = jest.fn().mockResolvedValue({
    nombre: 'CARRERA LUIS',
    funcionario: null,
  });
  const nombresDeUsuarios = jest
    .fn()
    .mockResolvedValue(new Map([[DIRECTOR.usuarioId, 'CARRERA LUIS']]));
  const actualizarVersionPlantilla = jest.fn().mockResolvedValue(undefined);
  const valoresParametro: Record<string, string> = {
    ORDEN_CIUDAD: ciudad,
    ORDEN_SIGLAS_UNIDAD: siglasUnidad,
  };
  const obtenerTextoOpcional = jest.fn((clave: string) =>
    Promise.resolve(valoresParametro[clave] ?? ''),
  );

  const servicio = new OrdenServicioService(
    {
      buscarOperativo: jest.fn().mockResolvedValue(operativoActual),
      listarDeOperativo,
      listarDeFuncionario,
      buscarPorCodigo,
      contarEmisiones,
      funcionarioDeUsuario: jest.fn().mockResolvedValue(funcionarioDeUsuario),
      operativosDeFuncionarioEnFecha: jest.fn().mockResolvedValue([]),
      fichaFirmante,
      anularVigentes,
      vigenteAnterior,
      siguienteSecuencial: siguienteSecuencialMock,
      asignarNumero,
      paraCompletar,
      actualizarEditables,
      actualizarFirmante,
      obtenerConfigCuadro,
      upsertConfigCuadro,
      borradoresSinNumeroDeCuadro,
      borradoresDeDirector,
      plantillaDeDirector,
      plantillaBase,
      crearPlantillaDirector,
      guardarNuevaVersion,
      versionesDePlantilla,
      usuarioParaPlantilla,
      nombresDeUsuarios,
      actualizarVersionPlantilla,
      crear,
      ejecutarEnTransaccion: jest
        .fn()
        .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
          operacion(CLIENTE),
        ),
    } as unknown as OrdenServicioRepository,
    { registrar } as unknown as AuditoriaService,
    { log } as unknown as LoggerService,
    // La firma no se ejercita aquí (estas pruebas no componen el memorando); stub que no firma.
    {
      firmar: jest.fn((pdf: Buffer) => Promise.resolve(pdf)),
    } as unknown as FirmaDigitalClient,
    {
      obtenerTextoOpcional,
    } as unknown as ParametroPoliticaService,
  );

  return {
    servicio,
    emitidas,
    crear,
    anularVigentes,
    vigenteAnterior,
    siguienteSecuencial: siguienteSecuencialMock,
    asignarNumero,
    paraCompletar,
    buscarPorCodigo,
    actualizarEditables,
    actualizarFirmante,
    obtenerConfigCuadro,
    upsertConfigCuadro,
    borradoresSinNumeroDeCuadro,
    borradoresDeDirector,
    plantillaDeDirector,
    plantillaBase,
    crearPlantillaDirector,
    guardarNuevaVersion,
    versionesDePlantilla,
    usuarioParaPlantilla,
    nombresDeUsuarios,
    actualizarVersionPlantilla,
    listarDeOperativo,
    listarDeFuncionario,
    registrar,
    log,
    fichaFirmante,
  };
};

const capturar = async (promesa: Promise<unknown>): Promise<unknown> =>
  promesa.catch((error: unknown) => error);

describe('OrdenServicioService · emisión', () => {
  it('caso 1 del plan · tres funcionarios producen TRES órdenes', async () => {
    const { servicio, emitidas } = armar({
      operativoActual: operativo({
        personal: [
          persona(101, 'BENAVIDES'),
          persona(102, 'SEGOVIA'),
          persona(103, 'TACO'),
        ],
      }),
    });

    await servicio.emitir(500, DIRECTOR);

    expect(emitidas).toHaveLength(3);
    expect(emitidas.map((orden) => orden.funcionarioId)).toEqual([
      101, 102, 103,
    ]);
  });

  it('caso 1 · NINGUNA menciona a las otras dos', async () => {
    const { servicio, emitidas } = armar({
      operativoActual: operativo({
        personal: [
          persona(101, 'BENAVIDES'),
          persona(102, 'SEGOVIA'),
          persona(103, 'TACO'),
        ],
      }),
    });

    await servicio.emitir(500, DIRECTOR);

    const deBenavides = JSON.stringify(emitidas[0].datoAislado);
    expect(deBenavides).toContain('BENAVIDES');
    expect(deBenavides).not.toContain('SEGOVIA');
    expect(deBenavides).not.toContain('TACO');
  });

  it('caso 2 · el contenido guardado tiene exactamente los cuatro campos', async () => {
    const { servicio, emitidas } = armar();

    await servicio.emitir(500, DIRECTOR);

    const dato = emitidas[0].datoAislado as unknown as DatoAislado;
    expect(Object.keys(dato).sort()).toEqual([
      'conductor',
      'funcionario',
      'horario',
      'placa',
    ]);
    expect(dato.horario).toBe('18H00 A 23H30');
    expect(dato.conductor?.nombre).toBe('VIVANCO JORGE');
    expect(dato.placa).toBe('PMA7892');
  });

  it('el identificador del operativo NO viaja dentro del dato aislado', async () => {
    const { servicio, emitidas } = armar();

    await servicio.emitir(500, DIRECTOR);

    // Está en el código de la orden, que identifica al documento; no en su contenido.
    expect(JSON.stringify(emitidas[0].datoAislado)).not.toContain('ICNECU');
    expect(emitidas[0].codigo).toContain('ICNECU-001-31-JUL-2026');
  });

  it('caso 3 · un operativo sin personal no se puede emitir', async () => {
    const { servicio, crear } = armar({
      operativoActual: operativo({ personal: [] }),
    });

    const fallo = await capturar(servicio.emitir(500, DIRECTOR));

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).message).toContain(
      'no tiene personal asignado',
    );
    expect((fallo as ReglaNegocioError).message).toContain('ICNECU-001');
    expect(crear).not.toHaveBeenCalled();
  });

  it('un operativo inexistente produce 404', async () => {
    const { servicio } = armar({ operativoActual: null });

    await expect(servicio.emitir(500, DIRECTOR)).rejects.toBeInstanceOf(
      RecursoNoEncontradoError,
    );
  });

  it('sin conductor asignado, la orden se emite igual y lo dice', async () => {
    const { servicio, emitidas } = armar({
      operativoActual: operativo({ conductor: null, vehiculo: null }),
    });

    await servicio.emitir(500, DIRECTOR);

    const dato = emitidas[0].datoAislado as unknown as DatoAislado;
    expect(dato.conductor).toBeNull();
    expect(dato.placa).toBeNull();
  });

  it('audita la emisión dentro de la transacción', async () => {
    const { servicio, registrar } = armar();

    await servicio.emitir(500, DIRECTOR);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_orden_servicio',
        accion: AccionAuditoria.EMITIR,
        operativoId: 500,
        usuario: 5,
      }),
      CLIENTE,
    );
  });

  it('el evento no lleva los nombres de las personas', async () => {
    const { servicio, log } = armar();

    await servicio.emitir(500, DIRECTOR);

    expect(log).toHaveBeenCalledWith(
      'Órdenes de servicio emitidas',
      expect.objectContaining({ ordenes: 1 }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('BENAVIDES');
  });
});

describe('INV-25 · la reemisión (caso 7 del plan)', () => {
  it('anula la anterior antes de escribir la nueva', async () => {
    const { servicio, anularVigentes, crear } = armar({
      emisionesPrevias: 1,
      anuladas: 1,
    });

    await servicio.emitir(500, DIRECTOR);

    expect(anularVigentes).toHaveBeenCalledWith(500, 101, CLIENTE);
    expect(crear).toHaveBeenCalled();
  });

  it('el código de la nueva emisión se distingue del de la primera', async () => {
    const primera = armar({ emisionesPrevias: 0 });
    await primera.servicio.emitir(500, DIRECTOR);

    const segunda = armar({ emisionesPrevias: 1, anuladas: 1 });
    await segunda.servicio.emitir(500, DIRECTOR);

    expect(primera.emitidas[0].codigo).toMatch(/-1$/);
    expect(segunda.emitidas[0].codigo).toMatch(/-2$/);
    expect(primera.emitidas[0].codigo).not.toBe(segunda.emitidas[0].codigo);
  });

  it('la reemisión deja traza del cambio de vigencia', async () => {
    const { servicio, registrar } = armar({
      emisionesPrevias: 1,
      anuladas: 1,
    });

    await servicio.emitir(500, DIRECTOR);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        cambios: [
          { campo: 'oser_vigente', valorAnterior: 'true', valorNuevo: 'false' },
        ],
      }),
      CLIENTE,
    );
  });

  it('la primera emisión no registra cambio de vigencia: no había nada que anular', async () => {
    const { servicio, registrar } = armar();

    await servicio.emitir(500, DIRECTOR);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ cambios: undefined }),
      CLIENTE,
    );
  });
});

describe('F21 · solo la Dirección emite', () => {
  it('un emisor sin rol DIRECTOR recibe 403 y no se escribe nada', async () => {
    const { servicio, crear, anularVigentes } = armar();

    const fallo = await capturar(
      servicio.emitir(500, {
        usuarioId: 9,
        nombre: 'OTRO',
        roles: [RolDepartamental.DMIP_OPERATIVOS],
      }),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect((fallo as AutorizacionError).statusCode).toBe(403);
    expect(crear).not.toHaveBeenCalled();
    expect(anularVigentes).not.toHaveBeenCalled();
  });

  it('un emisor con DIRECTOR entre varios roles sí emite', async () => {
    const { servicio, crear } = armar();

    await servicio.emitir(500, {
      usuarioId: 5,
      nombre: 'CARRERA LUIS',
      roles: [RolDepartamental.DAF, RolDepartamental.DIRECTOR],
    });

    expect(crear).toHaveBeenCalled();
  });
});

describe('F · el firmante se congela en la orden (desde la plantilla)', () => {
  it('guarda una copia con el firmante de los datos generales de la plantilla', async () => {
    const { servicio, emitidas } = armar({
      datosGenerales: {
        firmante: 'Mgs. CARRERA LUIS',
        firmanteCargo: 'DIRECTOR METROPOLITANO DE INSPECCIÓN',
        firmanteDependencia: 'AMC',
      },
    });

    await servicio.emitir(500, DIRECTOR);

    expect(emitidas[0].firmante).toEqual(
      expect.objectContaining({
        nombre: 'Mgs. CARRERA LUIS',
        cargo: 'DIRECTOR METROPOLITANO DE INSPECCIÓN',
        dependencia: 'AMC',
        usuarioId: 5,
      }),
    );
  });
});

describe('G · numeración AMC-OS', () => {
  it('una primera emisión nace en BORRADOR y NO consume número (no hay editables)', async () => {
    const { servicio, emitidas, asignarNumero, siguienteSecuencial } = armar({
      firmanteCargo: 'CARGO',
      firmanteDependencia: 'DEP',
    });

    await servicio.emitir(500, DIRECTOR);

    expect(emitidas[0].numeroSecuencial).toBeNull();
    expect(emitidas[0].numeroAnio).toBeNull();
    expect(siguienteSecuencial).not.toHaveBeenCalled();
    expect(asignarNumero).not.toHaveBeenCalled();
  });

  it('la reemisión CONSERVA el número de la vigente anterior y no consume otro', async () => {
    const { servicio, emitidas, siguienteSecuencial, asignarNumero } = armar({
      emisionesPrevias: 1,
      anuladas: 1,
      firmanteCargo: 'CARGO',
      firmanteDependencia: 'DEP',
      anterior: {
        editables: {
          numeroMemorando: 'M-1',
          paraCargo: 'C',
          paraDependencia: 'D',
          nut: 'N',
        },
        firmante: { nombre: 'X', cargo: 'CARGO', dependencia: 'DEP' },
        numeroSecuencial: 5572,
        numeroAnio: 2026,
      },
      siguienteSecuencial: 9999,
    });

    await servicio.emitir(500, DIRECTOR);

    expect(emitidas[0].numeroSecuencial).toBe(5572);
    expect(emitidas[0].numeroAnio).toBe(2026);
    expect(siguienteSecuencial).not.toHaveBeenCalled();
    expect(asignarNumero).not.toHaveBeenCalled();
  });

  /** La forma que devuelve `paraCompletar` (orden + persona + jornada + número), para los faltantes. */
  const ordenParaCompletar = (parcial: Record<string, unknown> = {}) => ({
    id: 42,
    vigente: true,
    firmante: { nombre: 'X', cargo: 'CARGO', dependencia: 'DEP' },
    // Generada por el Director en sesión, con su plantilla v1 (2026-10-05).
    directorId: DIRECTOR.usuarioId,
    plantillaId: 77,
    plantillaVersion: 1,
    numeroSecuencial: null,
    numeroAnio: null,
    emitidaEn: new Date('2026-10-02T12:00:00Z'),
    funcionario: {
      nombres: 'NOMBRE',
      apellidos: 'BENAVIDES',
      cargo: null,
      // La dependencia se deriva de la dirección: con ella configurada, deja de faltar.
      direccion: RolDepartamental.DMIP_OPERATIVOS,
    },
    operativo: { cuadro: { fecha: JORNADA } },
    ...parcial,
  });

  it('al COMPLETAR los requeridos de un borrador vigente, se le asigna el número', async () => {
    const { servicio, paraCompletar, siguienteSecuencial, asignarNumero } =
      armar({
        firmanteCargo: 'CARGO',
        firmanteDependencia: 'DEP',
        // Datos generales del Director (plantilla) completos y el NUT del día configurado.
        datosGenerales: DATOS_GENERALES_LLENOS,
        configCuadro: { nut: 'N', elaboradoPor: null },
        siguienteSecuencial: 5572,
      });
    paraCompletar.mockResolvedValue(ordenParaCompletar());

    // Lo único que queda por completar en el editor por-orden es el cargo del destinatario.
    await servicio.guardarEditables(
      'OS-ABC-101-1',
      { paraCargo: 'C' },
      DIRECTOR.usuarioId,
    );

    expect(siguienteSecuencial).toHaveBeenCalledWith(2026, CLIENTE);
    expect(asignarNumero).toHaveBeenCalledWith(42, 2026, 5572, CLIENTE);
  });

  it('completar un borrador AÚN incompleto no asigna número', async () => {
    const { servicio, paraCompletar, siguienteSecuencial, asignarNumero } =
      armar({
        firmanteCargo: 'CARGO',
        firmanteDependencia: 'DEP',
        datosGenerales: DATOS_GENERALES_LLENOS,
        // Falta el NUT en la config del cuadro: la orden sigue en borrador.
        configCuadro: { nut: null, elaboradoPor: null },
      });
    paraCompletar.mockResolvedValue(ordenParaCompletar());

    await servicio.guardarEditables(
      'OS-ABC-101-1',
      { paraCargo: 'C' },
      DIRECTOR.usuarioId,
    );

    expect(siguienteSecuencial).not.toHaveBeenCalled();
    expect(asignarNumero).not.toHaveBeenCalled();
  });

  it('una orden que YA tiene número no se renumera al editar', async () => {
    const { servicio, paraCompletar, siguienteSecuencial, asignarNumero } =
      armar({
        firmanteCargo: 'CARGO',
        firmanteDependencia: 'DEP',
        datosGenerales: DATOS_GENERALES_LLENOS,
        configCuadro: { nut: 'N', elaboradoPor: null },
      });
    paraCompletar.mockResolvedValue(
      ordenParaCompletar({ numeroSecuencial: 5572, numeroAnio: 2026 }),
    );

    await servicio.guardarEditables(
      'OS-ABC-101-1',
      { paraCargo: 'C' },
      DIRECTOR.usuarioId,
    );

    expect(siguienteSecuencial).not.toHaveBeenCalled();
    expect(asignarNumero).not.toHaveBeenCalled();
  });

  it('guardar editables sobre una orden inexistente da 404', async () => {
    const { servicio } = armar();

    const fallo = await capturar(
      servicio.guardarEditables(
        'OS-NO-EXISTE',
        { numeroMemorando: 'M-1' },
        DIRECTOR.usuarioId,
      ),
    );

    expect(fallo).toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('«Completar datos» (E21) MEZCLA el cargo sobre lo guardado y, con el resto listo, numera', async () => {
    const {
      servicio,
      buscarPorCodigo,
      paraCompletar,
      actualizarEditables,
      asignarNumero,
    } = armar({
      firmanteCargo: 'CARGO',
      firmanteDependencia: 'DEP',
      datosGenerales: DATOS_GENERALES_LLENOS,
      configCuadro: { nut: 'N', elaboradoPor: null },
      siguienteSecuencial: 5572,
    });
    // La orden ya tenía algún editable; completar el cargo NO debe borrarlo.
    buscarPorCodigo.mockResolvedValue({
      directorId: DIRECTOR.usuarioId,
      editables: { numeroMemorando: 'previo' },
    });
    paraCompletar.mockResolvedValue(ordenParaCompletar());

    await servicio.completarDatosPersona(
      'OS-ABC-101-1',
      'Agente de control',
      DIRECTOR.usuarioId,
    );

    expect(actualizarEditables).toHaveBeenCalledWith(
      'OS-ABC-101-1',
      { numeroMemorando: 'previo', paraCargo: 'Agente de control' },
      CLIENTE,
    );
    // Con el cargo del destinatario y la config del día completos, el borrador pasa a Vigente.
    expect(asignarNumero).toHaveBeenCalledWith(42, 2026, 5572, CLIENTE);
  });

  it('«Completar datos» sobre una orden inexistente da 404', async () => {
    const { servicio } = armar();

    const fallo = await capturar(
      servicio.completarDatosPersona(
        'OS-NO-EXISTE',
        'Agente',
        DIRECTOR.usuarioId,
      ),
    );

    expect(fallo).toBeInstanceOf(RecursoNoEncontradoError);
  });
});

describe('D13 · config del memorando por cuadro', () => {
  /** Un borrador de la jornada tal como lo devuelve `borradoresSinNumeroDeCuadro`. */
  const borradorDeCuadro = (parcial: Record<string, unknown> = {}) => ({
    id: 7,
    codigo: 'OS-ICNECU-001-101-1',
    firmante: { nombre: 'X', cargo: 'CARGO', dependencia: 'DEP' },
    // El cargo ya está completado en el editor por-orden; lo del día llega con la config.
    editables: { paraCargo: 'C' },
    numeroSecuencial: null,
    numeroAnio: null,
    emitidaEn: new Date('2026-10-02T12:00:00Z'),
    funcionario: {
      nombres: 'NOMBRE',
      apellidos: 'BENAVIDES',
      cargo: null,
      direccion: RolDepartamental.DMIP_OPERATIVOS,
    },
    ...parcial,
  });

  it('guarda la config y persiste vacío como NULL («sin configurar»)', async () => {
    const { servicio, upsertConfigCuadro } = armar();

    const guardada = await servicio.guardarConfigCuadro(JORNADA, {
      nut: '  N-1  ',
      elaboradoPor: '   ',
    });

    // Se recorta el texto y el campo en blanco queda NULL. El número de memorando ya NO va aquí.
    expect(guardada).toEqual({ nut: 'N-1', elaboradoPor: null });
    expect(upsertConfigCuadro).toHaveBeenCalledWith(
      JORNADA,
      { nut: 'N-1', elaboradoPor: null },
      CLIENTE,
    );
  });

  it('al guardar, PROMUEVE los borradores de la jornada que quedan completos', async () => {
    const { servicio, siguienteSecuencial, asignarNumero, registrar } = armar({
      firmanteCargo: 'CARGO',
      firmanteDependencia: 'DEP',
      datosGenerales: DATOS_GENERALES_LLENOS,
      siguienteSecuencial: 5572,
      borradores: [borradorDeCuadro()],
    });

    await servicio.guardarConfigCuadro(JORNADA, {
      nut: 'N',
      elaboradoPor: null,
    });

    // Con la config del día completa, el borrador ya no tiene faltantes y recibe su número.
    expect(siguienteSecuencial).toHaveBeenCalledWith(2026, CLIENTE);
    expect(asignarNumero).toHaveBeenCalledWith(7, 2026, 5572, CLIENTE);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_orden_servicio',
        entidadId: 7,
        accion: AccionAuditoria.EMITIR,
      }),
      CLIENTE,
    );
  });

  it('un borrador que sigue incompleto tras guardar la config NO se numera', async () => {
    const { servicio, siguienteSecuencial, asignarNumero } = armar({
      firmanteCargo: 'CARGO',
      firmanteDependencia: 'DEP',
      datosGenerales: DATOS_GENERALES_LLENOS,
      borradores: [borradorDeCuadro()],
    });

    // Se guarda la config SIN el NUT: el borrador sigue teniéndolo como faltante.
    await servicio.guardarConfigCuadro(JORNADA, {
      nut: null,
      elaboradoPor: null,
    });

    expect(siguienteSecuencial).not.toHaveBeenCalled();
    expect(asignarNumero).not.toHaveBeenCalled();
  });

  it('lee la config de una jornada (NULL donde no se ha configurado)', async () => {
    const { servicio } = armar({
      configCuadro: { nut: 'N-9', elaboradoPor: null },
    });

    await expect(servicio.obtenerConfigCuadro(JORNADA)).resolves.toEqual({
      nut: 'N-9',
      elaboradoPor: null,
    });
  });
});

describe('F · el firmante de la plantilla promueve los borradores al guardarla', () => {
  /** Un borrador de cualquier jornada tal como lo devuelve `borradoresDeDirector` (lleva su fecha). */
  const borradorGlobal = (firmante: unknown) => ({
    id: 7,
    codigo: 'OS-ICNECU-001-101-1',
    firmante,
    // El cargo del destinatario ya está completo; lo único pendiente era el firmante.
    editables: { paraCargo: 'Agente de control' },
    numeroSecuencial: null,
    numeroAnio: null,
    emitidaEn: new Date('2026-07-31T12:00:00Z'),
    funcionario: {
      nombres: 'NOMBRE',
      apellidos: 'BENAVIDES',
      cargo: 'Agente de control',
      direccion: RolDepartamental.DMIP_OPERATIVOS,
    },
    operativo: { cuadro: { fecha: JORNADA } },
  });

  it('re-sella el firmante incompleto de un borrador y lo promueve a Vigente con su número', async () => {
    const { servicio, actualizarFirmante, asignarNumero, siguienteSecuencial } =
      armar({
        configCuadro: { nut: 'N-1', elaboradoPor: 'DMI' },
        siguienteSecuencial: 5572,
        borradores: [
          borradorGlobal({ nombre: '', cargo: '', dependencia: '' }),
        ],
      });

    await servicio.guardarPlantilla(
      [],
      DATOS_GENERALES_LLENOS,
      DIRECTOR.usuarioId,
    );

    // Se re-sella la copia del firmante incompleta con lo guardado en la plantilla…
    expect(actualizarFirmante).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        nombre: 'Mgs. CARRERA LUIS',
        cargo: 'Director Metropolitano',
        dependencia: 'Dirección Metropolitana de Inspección',
      }),
      CLIENTE,
    );
    // …y, sin más faltantes, el borrador recibe su número AMC-OS.
    expect(siguienteSecuencial).toHaveBeenCalledWith(2026, CLIENTE);
    expect(asignarNumero).toHaveBeenCalledWith(7, 2026, 5572, CLIENTE);
  });

  it('no re-sella una firma ya válida (F20)', async () => {
    const { servicio, actualizarFirmante } = armar({
      configCuadro: { nut: 'N-1', elaboradoPor: 'DMI' },
      borradores: [
        borradorGlobal({ nombre: 'X', cargo: 'C', dependencia: 'D' }),
      ],
    });

    await servicio.guardarPlantilla(
      [],
      DATOS_GENERALES_LLENOS,
      DIRECTOR.usuarioId,
    );

    expect(actualizarFirmante).not.toHaveBeenCalled();
  });
});

describe('RN-49 · la consulta propia', () => {
  it('caso 6 del plan · filtra por el funcionario del usuario autenticado', async () => {
    const { servicio, listarDeFuncionario } = armar({
      funcionarioDeUsuario: 101,
    });

    await servicio.consultarPropias(7);

    // El 7 es el usuario; el 101 es su funcionario. No hay parámetro que lo altere.
    expect(listarDeFuncionario).toHaveBeenCalledWith(101, undefined);
  });

  it('un usuario sin ficha de personal recibe una explicación, no una lista vacía', async () => {
    const { servicio, listarDeFuncionario } = armar({
      funcionarioDeUsuario: null,
    });

    const fallo = await capturar(servicio.consultarPropias(5));

    expect(fallo).toBeInstanceOf(RecursoNoEncontradoError);
    expect((fallo as RecursoNoEncontradoError).message).toContain(
      'ficha de personal',
    );
    expect(listarDeFuncionario).not.toHaveBeenCalled();
  });

  it('acepta acotar desde una fecha', async () => {
    const { servicio, listarDeFuncionario } = armar();

    await servicio.consultarPropias(7, JORNADA);

    expect(listarDeFuncionario).toHaveBeenCalledWith(101, JORNADA);
  });
});

describe('OrdenServicioService · previsualizar la plantilla', () => {
  it('genera un PDF de muestra con los apartados en edición (para la vista previa del editor)', async () => {
    const { servicio } = armar();

    const pdf = await servicio.previsualizarPlantilla(
      [
        {
          id: 'a',
          titulo: 'PRIMERO',
          tipo: 'texto',
          contenido: 'Para {{nombre}}.',
        },
        { id: 'b', titulo: 'CUARTO', tipo: 'operativos', contenido: '' },
      ],
      undefined,
      DIRECTOR.usuarioId,
    );

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('acepta los datos generales EN BORRADOR del body, firmante incluido, y genera la vista previa genérica (D17)', async () => {
    const { servicio, plantillaDeDirector } = armar();

    const pdf = await servicio.previsualizarPlantilla(
      [
        {
          id: 'a',
          titulo: 'SEGUNDO',
          tipo: 'texto',
          contenido:
            '**{{direccionResponsable}}** asignó al **{{designado}}**.',
        },
      ],
      {
        direccionResponsable: 'Dirección Metropolitana de Inspección',
        numeroMemorando: 'MEM-PRUEBA-1',
        fechaMemorando: '2026-06-17',
        designado: 'Mgs. Ana Simbaña (Funcionario Directivo 9)',
        firmante: 'Mgs. Ana Simbaña',
        firmanteCargo: 'Funcionario Directivo 9',
        firmanteDependencia: 'Dirección Metropolitana de Inspección',
      },
      DIRECTOR.usuarioId,
    );

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // Con el borrador del body no hace falta leer la plantilla guardada.
    expect(plantillaDeDirector).not.toHaveBeenCalled();
  });

  it('sin borrador en el body usa los datos generales de la plantilla DEL DIRECTOR EN SESIÓN', async () => {
    const { servicio, plantillaDeDirector } = armar();

    await servicio.previsualizarPlantilla(
      [{ id: 'a', titulo: 'PRIMERO', tipo: 'texto', contenido: 'Texto.' }],
      undefined,
      DIRECTOR.usuarioId,
    );

    expect(plantillaDeDirector).toHaveBeenCalledWith(DIRECTOR.usuarioId);
  });
});

describe('Plantilla por Director (2026-10-05)', () => {
  it('cada Director obtiene SOLO su plantilla: se busca por su id', async () => {
    const { servicio, plantillaDeDirector } = armar();
    plantillaDeDirector.mockImplementation((id: number) =>
      Promise.resolve({
        id: id === 14 ? 1 : 2,
        directorId: id,
        version: 1,
        apartados: null,
        datosGenerales: { firmante: id === 14 ? 'LIDER' : 'MARIA GABRIELA' },
      }),
    );

    const deLider = await servicio.plantillaDelDirector(14);
    const deMaria = await servicio.plantillaDelDirector(20);

    expect(deLider.directorId).toBe(14);
    expect(deLider.datosGenerales.firmante).toBe('LIDER');
    expect(deMaria.directorId).toBe(20);
    expect(deMaria.datosGenerales.firmante).toBe('MARIA GABRIELA');
    expect(plantillaDeDirector).toHaveBeenNthCalledWith(1, 14);
    expect(plantillaDeDirector).toHaveBeenNthCalledWith(2, 20);
  });

  it('un Director SIN plantilla la recibe creada desde la BASE, con el firmante prellenado y el memorando vacío', async () => {
    const {
      servicio,
      plantillaDeDirector,
      crearPlantillaDirector,
      usuarioParaPlantilla,
      registrar,
    } = armar();
    plantillaDeDirector.mockResolvedValueOnce(null);
    usuarioParaPlantilla.mockResolvedValueOnce({
      nombre: 'Sosa María Gabriela',
      funcionario: {
        cargo: 'Funcionario Directivo 9',
        direccion: RolDepartamental.DMIT_INSTRUCTOR,
      },
    });
    crearPlantillaDirector.mockImplementation(
      (datos: { directorId: number; datosGenerales: unknown }) =>
        Promise.resolve({
          id: 30,
          directorId: datos.directorId,
          version: 1,
          apartados: null,
          datosGenerales: datos.datosGenerales,
        }),
    );

    const plantilla = await servicio.plantillaDelDirector(30);

    expect(crearPlantillaDirector).toHaveBeenCalledWith(
      expect.objectContaining({ directorId: 30, usuarioId: 30 }),
      CLIENTE,
    );
    expect(plantilla.version).toBe(1);
    expect(plantilla.datosGenerales.firmante).toBe('Sosa María Gabriela');
    expect(plantilla.datosGenerales.firmanteCargo).toBe(
      'Funcionario Directivo 9',
    );
    expect(plantilla.datosGenerales.firmanteDependencia).not.toBe('');
    expect(plantilla.datosGenerales.direccionResponsable).toBe(
      'Dirección Metropolitana de Inspección',
    );
    expect(plantilla.datosGenerales.designado).toBe(
      'Sosa María Gabriela (Funcionario Directivo 9)',
    );
    expect(plantilla.datosGenerales.numeroMemorando).toBe('');
    expect(plantilla.datosGenerales.fechaMemorando).toBe('');
    // La creación se audita dentro de la misma transacción.
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_plantilla_orden',
        accion: AccionAuditoria.CREAR,
        usuario: 30,
      }),
      CLIENTE,
    );
  });

  it('una plantilla guardada SIN los campos nuevos no falla: lo ausente queda vacío (faltante), sin respaldos', async () => {
    const { servicio, plantillaDeDirector } = armar();
    plantillaDeDirector.mockResolvedValueOnce({
      id: 77,
      directorId: DIRECTOR.usuarioId,
      version: 1,
      apartados: null,
      datosGenerales: { numeroMemorando: 'MEMO-1' },
    });

    const { datosGenerales } = await servicio.plantillaDelDirector(
      DIRECTOR.usuarioId,
    );

    expect(datosGenerales).toEqual({
      direccionResponsable: '',
      numeroMemorando: 'MEMO-1',
      fechaMemorando: '',
      designado: '',
      firmante: '',
      firmanteCargo: '',
      firmanteDependencia: '',
    });
  });

  it('guardar incrementa la versión, la audita y regenera SOLO los borradores de ESE Director', async () => {
    const {
      servicio,
      guardarNuevaVersion,
      borradoresDeDirector,
      registrar,
      crear,
      anularVigentes,
    } = armar();

    const apartados = [
      {
        id: 'a1',
        titulo: 'APARTADO PRIMERO',
        tipo: 'texto',
        contenido: 'Nuevo texto.',
      },
    ] as unknown as Parameters<typeof servicio.guardarPlantilla>[0];

    const devuelto = await servicio.guardarPlantilla(
      apartados,
      DATOS_GENERALES_LLENOS,
      DIRECTOR.usuarioId,
    );

    // Nueva versión de SU plantilla (id 77), con apartados + datos generales, dentro de la transacción.
    expect(guardarNuevaVersion).toHaveBeenCalledWith(
      77,
      apartados,
      DATOS_GENERALES_LLENOS,
      DIRECTOR.usuarioId,
      CLIENTE,
    );
    expect(devuelto.version).toBe(2);
    expect(devuelto.directorId).toBe(DIRECTOR.usuarioId);
    expect(devuelto.datosGenerales).toEqual(DATOS_GENERALES_LLENOS);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_plantilla_orden',
        entidadId: 77,
        accion: AccionAuditoria.ACTUALIZAR,
        usuario: DIRECTOR.usuarioId,
      }),
      CLIENTE,
    );
    // Solo los borradores del Director que guarda; nada se reemite ni se anula.
    expect(borradoresDeDirector).toHaveBeenCalledWith(
      DIRECTOR.usuarioId,
      CLIENTE,
    );
    expect(crear).not.toHaveBeenCalled();
    expect(anularVigentes).not.toHaveBeenCalled();
  });

  it('con datos generales completos, una orden nueva nace Vigente y numera', async () => {
    const { servicio, asignarNumero, emitidas } = armar({
      datosGenerales: DATOS_GENERALES_LLENOS,
      configCuadro: { nut: 'N', elaboradoPor: null },
      operativoActual: operativo({
        personal: [
          {
            ...persona(101, 'BENAVIDES'),
            funcionario: {
              ...persona(101, 'BENAVIDES').funcionario,
              cargo: 'Agente de control metropolitano',
            },
          },
        ],
      }),
      siguienteSecuencial: 5572,
    });

    await servicio.emitir(500, DIRECTOR);

    expect(asignarNumero).toHaveBeenCalledWith(1, 2026, 5572, CLIENTE);
    // La orden guarda quién la generó y con qué plantilla y versión.
    expect(emitidas[0]).toEqual(
      expect.objectContaining({
        directorId: DIRECTOR.usuarioId,
        plantillaId: 77,
        plantillaVersion: 1,
      }),
    );
  });

  it('con datos generales VACÍOS, la orden nueva queda en BORRADOR y no consume número', async () => {
    const { servicio, emitidas, asignarNumero } = armar({
      datosGenerales: {
        direccionResponsable: '',
        firmante: '',
      },
      configCuadro: { nut: 'N', elaboradoPor: null },
      operativoActual: operativo({
        personal: [
          {
            ...persona(101, 'BENAVIDES'),
            funcionario: {
              ...persona(101, 'BENAVIDES').funcionario,
              cargo: 'Agente de control metropolitano',
            },
          },
        ],
      }),
    });

    await servicio.emitir(500, DIRECTOR);

    expect(emitidas[0].numeroSecuencial).toBeNull();
    expect(asignarNumero).not.toHaveBeenCalled();
  });
});

describe('Propiedad de la orden (2026-10-05)', () => {
  const ordenDe = (directorId: number) => ({
    id: 9,
    codigo: 'OS-ABC-101-1',
    vigente: true,
    firmante: { nombre: 'LIDER', cargo: 'C', dependencia: 'D' },
    directorId,
    plantillaId: 1,
    plantillaVersion: 1,
    editables: null,
    numeroSecuencial: null,
    numeroAnio: null,
    emitidaEn: new Date('2026-07-31T12:00:00Z'),
    funcionarioId: 101,
    funcionario: {
      nombres: 'NOMBRE',
      apellidos: 'BENAVIDES',
      cargo: null,
      direccion: RolDepartamental.DMIP_OPERATIVOS,
      telefono: null,
    },
    operativo: { cuadro: { fecha: JORNADA } },
  });

  it('otro Director NO puede completar los datos de la orden (403) y no se escribe nada', async () => {
    const { servicio, paraCompletar, actualizarEditables } = armar();
    paraCompletar.mockResolvedValueOnce(ordenDe(14));

    const fallo = await capturar(
      servicio.guardarEditables('OS-ABC-101-1', { paraCargo: 'C' }, 20),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect((fallo as AutorizacionError).message).toContain('solo lectura');
    expect(actualizarEditables).not.toHaveBeenCalled();
  });

  it('«Completar datos» sobre una orden ajena también es 403', async () => {
    const { servicio, buscarPorCodigo } = armar();
    buscarPorCodigo.mockResolvedValueOnce(ordenDe(14));

    const fallo = await capturar(
      servicio.completarDatosPersona('OS-ABC-101-1', 'Agente', 20),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
  });

  it('no se reemiten las órdenes vigentes que generó OTRO Director (403)', async () => {
    const { servicio, listarDeOperativo, crear } = armar();
    listarDeOperativo.mockResolvedValueOnce([ordenDe(14)]);

    const fallo = await capturar(
      servicio.emitir(500, { ...DIRECTOR, usuarioId: 20 }),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect(crear).not.toHaveBeenCalled();
  });

  it('la orden se resuelve con SU plantilla y versión, no con la del Director que la abre', async () => {
    const {
      servicio,
      buscarPorCodigo,
      versionesDePlantilla,
      plantillaDeDirector,
    } = armar();
    buscarPorCodigo.mockResolvedValueOnce({
      ...ordenDe(14),
      firmante: null,
    });
    versionesDePlantilla.mockResolvedValueOnce([
      {
        plantillaId: 1,
        version: 1,
        apartados: null,
        datosGenerales: {
          ...DATOS_GENERALES_LLENOS,
          firmante: 'Mgs. LIDER DE LA GUERRA',
        },
      },
    ]);

    const datos = await servicio.datosDeMemorando('OS-ABC-101-1');

    expect(versionesDePlantilla).toHaveBeenCalledWith(
      [{ plantillaId: 1, version: 1 }],
      undefined,
    );
    expect(datos.firmante.nombre).toBe('Mgs. LIDER DE LA GUERRA');
    // Nunca se consulta la plantilla de quien la abre.
    expect(plantillaDeDirector).not.toHaveBeenCalled();
  });
});

describe('Paso automático a Vigente y numeración por año (2026-10-05)', () => {
  it('una orden vigente sin número y sin faltantes se numera al listarla', async () => {
    const { servicio, siguienteSecuencial, asignarNumero } = armar({
      siguienteSecuencial: 5580,
    });
    const orden = {
      id: 12,
      codigo: 'OS-X-1',
      vigente: true,
      numeroSecuencial: null as number | null,
      numeroAnio: null as number | null,
      emitidaEn: new Date('2026-07-31T12:00:00Z'),
    };

    await servicio.asegurarVigencia(
      [orden] as unknown as Parameters<typeof servicio.asegurarVigencia>[0],
      new Map([['OS-X-1', []]]),
    );

    expect(siguienteSecuencial).toHaveBeenCalledWith(2026, CLIENTE);
    expect(asignarNumero).toHaveBeenCalledWith(12, 2026, 5580, CLIENTE);
    expect(orden.numeroSecuencial).toBe(5580);
  });

  it('una orden con faltantes NO se numera al listarla (un borrador no consume número)', async () => {
    const { servicio, asignarNumero } = armar();

    await servicio.asegurarVigencia(
      [
        {
          id: 12,
          codigo: 'OS-X-1',
          vigente: true,
          numeroSecuencial: null,
          numeroAnio: null,
          emitidaEn: new Date('2026-07-31T12:00:00Z'),
        },
      ] as unknown as Parameters<typeof servicio.asegurarVigencia>[0],
      new Map([
        ['OS-X-1', [{ token: 'nut', etiqueta: 'NUT', origen: 'cuadro' }]],
      ]),
    );

    expect(asignarNumero).not.toHaveBeenCalled();
  });

  it('el contador es POR AÑO: una orden de 2027 pide el secuencial de 2027 (reinicio anual)', async () => {
    const { servicio, siguienteSecuencial } = armar({ siguienteSecuencial: 1 });

    await servicio.asegurarVigencia(
      [
        {
          id: 13,
          codigo: 'OS-Y-1',
          vigente: true,
          numeroSecuencial: null,
          numeroAnio: null,
          emitidaEn: new Date('2027-01-02T12:00:00Z'),
        },
      ] as unknown as Parameters<typeof servicio.asegurarVigencia>[0],
      new Map([['OS-Y-1', []]]),
    );

    expect(siguienteSecuencial).toHaveBeenCalledWith(2027, CLIENTE);
  });
});

describe('OrdenServicioService · sugerencia del firmante (2026-10-05)', () => {
  it('propone el firmante con el nombre, el cargo y la dependencia de la ficha del Director en sesión', async () => {
    const { servicio, fichaFirmante } = armar();

    const sugerencia = await servicio.sugerenciaFirmante({
      funcionarioId: 101,
      nombre: 'Sesión',
    });

    expect(fichaFirmante).toHaveBeenCalledWith(101);
    expect(sugerencia).toEqual({
      nombre: 'LUIS ALBERTO CARRERA POZO',
      cargo: 'Funcionario Directivo 9',
      dependencia: expect.any(String) as string,
    });
    expect(sugerencia?.dependencia.trim()).not.toBe('');
  });

  it('sin ficha asociada a la sesión no hay sugerencia', async () => {
    const { servicio, fichaFirmante } = armar();

    expect(
      await servicio.sugerenciaFirmante({ funcionarioId: null, nombre: 'X' }),
    ).toBeNull();
    expect(fichaFirmante).not.toHaveBeenCalled();

    fichaFirmante.mockResolvedValueOnce(null);
    expect(
      await servicio.sugerenciaFirmante({ funcionarioId: 5, nombre: 'X' }),
    ).toBeNull();
  });
});

describe('OrdenServicioService · la vista previa no usa la fecha de hoy (2026-10-05)', () => {
  it('la fecha de emisión y «Ciudad, fecha» van vacías (marcador gris), no con la fecha de hoy', async () => {
    const { servicio } = armar();
    const espia = jest.spyOn(exportador, 'exportarOrdenMemorando');

    await servicio.previsualizarPlantilla(
      [
        {
          id: 'a',
          titulo: 'PRIMERO',
          tipo: 'campos',
          contenido: 'Fecha de emisión: {{fechaEmision}}',
        },
      ],
      undefined,
      DIRECTOR.usuarioId,
    );

    const datos = espia.mock.calls[0][0];
    expect(datos.modoVistaPrevia).toBe(true);
    expect(datos.fechaEmision).toBe('');
    expect(datos.ciudadFecha).toBe('');
    // El token de la orden dentro del apartado sale como marcador, no como una fecha.
    expect(datos.apartados[0].contenido).toBe(
      'Fecha de emisión: [Fecha de emisión]',
    );
    espia.mockRestore();
  });
});
