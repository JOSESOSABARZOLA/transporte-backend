/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: operativos.service.spec.ts
 * Responsabilidad: Verificar el registro, la edición, la baja y la consulta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import {
  AccionAuditoria,
  AreaPersonal,
  EstadoCuadro,
  PoliticaVehiculo,
  Prisma,
  RolDepartamental,
  TipoTransporte,
} from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import type { VentanaCargaEvaluador } from '../../../common/auth/application/ventana-carga.evaluador';
import type { VentanaCargaRepository } from '../../../common/auth/infrastructure/ventana-carga.repository';
import {
  AutorizacionError,
  ConflictoConcurrenciaError,
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type { CatalogosService } from '../../configuracion/application/catalogos.service';
import type { FormulariosService } from '../../configuracion/application/formularios.service';
import type { ParametroPoliticaService } from '../../configuracion/application/parametro-politica.service';
import type { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import type { ElegibilidadService } from '../../talento-operativo/application/elegibilidad.service';
import type { FuncionariosService } from '../../talento-operativo/application/funcionarios.service';
import type { TramitesInspeccionService } from './tramites-inspeccion.service';
import type { AsignacionPersonalRepository } from '../infrastructure/asignacion-personal.repository';
import type {
  DatosOperativo,
  OperativoCompleto,
  OperativosRepository,
} from '../infrastructure/operativos.repository';
import type { CalculadorAlertasService } from './calculador-alertas.service';
import type { GeneradorIdentificadorService } from './generador-identificador.service';
import {
  RegistroHerenciaTransporte,
  type ResultadoHerencia,
} from './herencia-transporte.puerto';
import { RegistroCompatibilidadCompartir } from './compartir-transporte.puerto';
import { OperativosService, type DatosRegistro } from './operativos.service';

const CLIENTE = { marca: 'transaccion' };
const JORNADA = new Date(Date.UTC(2026, 7, 5));

const AUTOR = { usuarioId: 2, rol: RolDepartamental.DMIP_INSPECCIONES };

/** Formulario con un rol que aporta, para poder probar el cupo de PER-06. */
const FORMULARIO = {
  id: 8,
  codigo: 'INSP',
  nombre: 'INSPECCIONES',
  numero: 8,
  rolDueno: RolDepartamental.DMIP_INSPECCIONES,
  // Desde el 2026-08-25 la participación son filas de `t_formulario_rol`.
  roles: [
    {
      rol: RolDepartamental.DMIP_INSPECCIONES,
      acceso: 'ESCRITURA',
      cupo: null,
    },
    { rol: RolDepartamental.DMIT_INSTRUCTOR, acceso: 'APORTA', cupo: 1 },
  ],
  esPatrulla: false,
  condicionanteNoct: false,
  politicaVehiculo: PoliticaVehiculo.REQUERIDO,
  capturaLibrePunto: false,
  capturaLibreTipo: true,
  areas: [
    { area: AreaPersonal.GENERAL, esCompartida: false },
    { area: AreaPersonal.INSTRUCCION, esCompartida: true },
  ],
};

const FUNCIONARIO = {
  id: 100,
  apellidos: 'BENAVIDES',
  nombres: 'FERNANDO',
  area: AreaPersonal.GENERAL,
  telefono: '0999999999',
  activo: true,
};

const CATALOGOS = {
  zonales: [
    { id: 1, codigo: 'Z1', nombre: 'La Delicia' },
    { id: 2, codigo: 'Z2', nombre: 'Eugenio Espejo' },
  ],
  puntos: [
    {
      id: 10,
      nombre: 'Redondel del Ciclista',
      zonalId: 1,
      zonal: { nombre: 'La Delicia' },
      zonalFormulario: { nombre: 'La Delicia' },
    },
    {
      id: 20,
      nombre: 'Parque Bicentenario',
      zonalId: 2,
      zonal: { nombre: 'Eugenio Espejo' },
      zonalFormulario: { nombre: 'Eugenio Espejo' },
    },
  ],
  tiposControl: [{ id: 30, nombre: 'CONTROL DE VENTAS' }],
  instituciones: [
    { id: 40, sigla: 'AMT', nombre: 'Agencia Metropolitana de Tránsito' },
    { id: 41, sigla: 'CBQ', nombre: 'Cuerpo de Bomberos' },
  ],
  capturaLibrePunto: false,
  capturaLibreTipo: true,
};

const REGISTRO_VALIDO: DatosRegistro = {
  cuadroFecha: JORNADA,
  formularioCodigo: 'INSP',
  horaInicio: '08:00',
  horaFin: '12:00',
  zonalesIds: [1],
  puntoEncuentroId: 10,
  tipoControlId: 30,
  institucionesIds: [40],
};

const operativoGuardado = (
  parcial: Partial<OperativoCompleto> = {},
): OperativoCompleto =>
  ({
    id: 500,
    identificador: 'INSP-001-05-AGO-2026',
    secuencial: 1,
    cuadroId: 9,
    formularioId: 8,
    horaInicio: '08:00',
    horaFin: '12:00',
    esNocturno: false,
    cruzaMedianoche: false,
    duracionHoras: new Prisma.Decimal(4),
    puntoEncuentroId: 10,
    puntoLibre: null,
    tipoControlId: 30,
    tipoLibre: null,
    observaciones: [],
    // Adicional del día · 2026-08-20. Un operativo ordinario no nace de ninguno y no
    // tiene ninguno colgando: es el caso por defecto en casi todas las pruebas.
    origenId: null,
    origen: null,
    _count: { adicionales: 0 },
    estadoTransporte: 'PENDIENTE',
    // Transporte requerido (2026-10-07).
    tipoTransporte: 'COMPLETO',
    esMacrooperativo: false,
    transporteLiberadoEn: null,
    conductorId: null,
    vehiculoId: null,
    alertaActiva: true,
    alertas: null,
    activo: true,
    creadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
    creadoPor: 2,
    modificadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
    modificadoPor: 2,
    version: 1,
    creadoEn: new Date(),
    // `estado` viaja desde el 2026-08-20: de él depende si un adicional se admite, y
    // quién puede disponerlo. `APROBADO` es el estado normal el día de la ejecución.
    cuadro: { id: 9, fecha: JORNADA, estado: EstadoCuadro.APROBADO },
    formulario: FORMULARIO,
    puntoEncuentro: {
      id: 10,
      nombre: 'Redondel del Ciclista',
      zonalId: 1,
      zonal: { nombre: 'La Delicia' },
    },
    tipoControl: { id: 30, nombre: 'CONTROL DE VENTAS' },
    tiposControl: [],
    zonales: [{ zonal: { id: 1, codigo: 'Z1', nombre: 'La Delicia' } }],
    instituciones: [
      {
        institucion: {
          id: 40,
          sigla: 'AMT',
          nombre: 'Agencia Metropolitana de Tránsito',
        },
      },
    ],
    personal: [],
    ...parcial,
  }) as unknown as OperativoCompleto;

/** Una asignación ya existente en el operativo. */
const conPersonal = (
  funcionarioId: number,
  area: AreaPersonal = AreaPersonal.GENERAL,
  asignadoPorRol: RolDepartamental = RolDepartamental.DMIP_INSPECCIONES,
) => ({
  id: funcionarioId,
  funcionarioId,
  asignadoPorRol,
  esResponsable: false,
  funcionario: { ...FUNCIONARIO, id: funcionarioId, area },
});

const colision = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('unicidad', {
    code: 'P2002',
    clientVersion: '6.19.3',
  });

const armar = (
  opciones: {
    existente?: OperativoCompleto | null;
    conteoInicial?: number;
    fallosDeUnicidad?: number;
    versionDesactualizada?: boolean;
    escrituraBloqueada?: Error;
    funcionario?: Partial<typeof FUNCIONARIO>;
    /** Veredicto de `talento-operativo`. Elegible salvo que se indique otra cosa. */
    veredictoDescanso?: { elegible: boolean; codigo?: string; motivo?: string };
    /**
     * Banderas de captura libre del formulario. RN-20, por catálogo desde el
     * 2026-08-11: el valor por defecto es el de INSP —tipo sí, punto no—, que es la
     * configuración real del insumo aprobado.
     */
    catalogos?: { capturaLibrePunto?: boolean; capturaLibreTipo?: boolean };
    /**
     * Adicional del día · 2026-08-20. Cuántos cuelgan del operativo, y si la ventana de
     * carga del rol está abierta en el momento de crearlo.
     *
     * `ventanaAbierta` viene en **falso por defecto a propósito**: el caso real del
     * adicional es la ventana cerrada —se dispone el día de la ejecución, cuando la
     * carga ya cerró— y una prueba que solo ejercitara el caso cómodo no comprobaría lo
     * único que este cambio vino a permitir.
     */
    adicionales?: { activos: number; total: number };
    ventanaAbierta?: boolean;
    /** Si el formulario tiene configurado un prefijo para sus adicionales. */
    admiteAdicionales?: boolean;
    /** Miembros de la patrulla que devuelve `buscarPorGrupoRegistro` (2026-09-18). */
    grupo?: OperativoCompleto[];
    /** Transporte requerido (2026-10-07): si el operativo ya tiene transporte asignado. */
    transporteAsignado?: boolean;
    /**
     * Herencia del transporte del adicional (2026-10-14): lo que responde `transporte` por el
     * puerto, o un error. Ausente = `transporte` no está cargado (nadie inscrito).
     */
    herencia?: { resultado?: ResultadoHerencia; error?: Error };
    /**
     * Compartir unidad (2026-10-19): los operativos que devuelve el repositorio para las
     * coincidencias y para resolver el destino, y lo que responde `transporte` por el puerto.
     * Sin `evaluar`, nadie inscrito: todo compatible.
     */
    compartir?: {
      coincidencias?: unknown[];
      paraCompartir?: unknown[];
      miembros?: unknown[];
      evaluar?: jest.Mock;
    };
  } = {},
) => {
  const {
    existente = null,
    conteoInicial = 0,
    fallosDeUnicidad = 0,
    versionDesactualizada = false,
    escrituraBloqueada,
    funcionario = {},
    veredictoDescanso = { elegible: true },
    ordenesEmitidas = 0,
    catalogos = {},
    adicionales = { activos: 0, total: 0 },
    ventanaAbierta = false,
    admiteAdicionales = true,
    grupo = [],
  } = opciones;

  let restantes = fallosDeUnicidad;

  /** Lo que el servicio pidió guardar, con tipo, para poder afirmar sobre ello. */
  const enviados: DatosOperativo[] = [];

  const crear = jest.fn().mockImplementation((datos: DatosOperativo) => {
    enviados.push(datos);

    if (restantes > 0) {
      restantes -= 1;
      return Promise.reject(colision());
    }
    return Promise.resolve(
      operativoGuardado({
        identificador: datos.identificador,
        secuencial: datos.secuencial,
        origenId: datos.origenId,
      }),
    );
  });

  const contarDelFormulario = jest.fn().mockResolvedValue(conteoInicial);
  // Numeración POR PREFIJO en las patrullas (5/6): arranca del mismo `conteoInicial`.
  const contarDelPrefijo = jest.fn().mockResolvedValue(conteoInicial);
  const actualizar = jest
    .fn()
    .mockResolvedValue(versionDesactualizada ? null : operativoGuardado());
  // Transporte requerido (2026-10-07).
  const tieneTransporteAsignado = jest
    .fn()
    .mockResolvedValue(opciones.transporteAsignado ?? false);
  const liberarPorCambio = jest.fn().mockResolvedValue(undefined);
  // Conductor y placa del listado (2026-10-13).
  const transporteDeOperativos = jest
    .fn()
    .mockResolvedValue(
      new Map([[7, [{ conductor: 'PÉREZ JUAN', placa: 'PEA-1234' }]]]),
    );
  const limpiarTransporteLiberado = jest.fn().mockResolvedValue(undefined);
  // RN-66 (2026-09-09): re-derivar la ventana del operativo al editar un turno.
  const actualizarVentana = jest.fn().mockResolvedValue(undefined);
  const desactivar = jest
    .fn()
    .mockResolvedValue(
      versionDesactualizada ? null : operativoGuardado({ activo: false }),
    );
  const contarOrdenesEmitidas = jest.fn().mockResolvedValue(ordenesEmitidas);
  const contarAdicionales = jest.fn().mockResolvedValue(adicionales);
  // El evaluador es el MISMO que usa `VentanaCargaGuard`, y se dobla con su contrato:
  // devuelve el veredicto, no una decisión. Aquí nunca bloquea; solo se audita.
  const evaluarVentana = jest.fn().mockReturnValue({
    puedeEscribir: ventanaAbierta,
    horaCierre: '14:50',
    motivo: ventanaAbierta ? undefined : 'La ventana de carga está cerrada.',
  });
  const buscarVentanaPorRol = jest.fn().mockResolvedValue(null);
  const eliminar = jest.fn().mockResolvedValue(!versionDesactualizada);
  const reemplazarZonales = jest.fn().mockResolvedValue(undefined);
  const reemplazarInstituciones = jest.fn().mockResolvedValue(undefined);
  const reemplazarTiposControl = jest.fn().mockResolvedValue(undefined);
  const buscarPorGrupoRegistro = jest.fn().mockResolvedValue(grupo);
  const listar = jest.fn().mockResolvedValue({ datos: [], total: 0 });
  // «N hoy» del selector (2026-10-16): el formulario 1 lleva 3; el 2, ninguno.
  const contarPorFormulario = jest.fn().mockResolvedValue(new Map([[1, 3]]));
  const obtenerPermitidos = jest.fn().mockResolvedValue([
    { formulario: { id: 1 }, acceso: 'ESCRITURA' },
    { formulario: { id: 2 }, acceso: 'ESCRITURA' },
  ]);
  const registrar = jest.fn().mockResolvedValue(undefined);
  const generar = jest
    .fn()
    .mockImplementation((_formulario, secuencial: number, _fecha, adicional) =>
      Promise.resolve(
        adicional
          ? `AINSP-${String(secuencial).padStart(3, '0')}-05-AGO-2026`
          : `INSP-${String(secuencial).padStart(3, '0')}-05-AGO-2026`,
      ),
    );
  // Desde el 2026-09-17 el servicio resuelve el prefijo ANTES de contar (numeración por
  // prefijo en las patrullas) y compone aparte. Los dobles reproducen el formato de `generar`.
  const resolverPrefijo = jest
    .fn()
    .mockImplementation((_formulario, esAdicional: boolean) =>
      Promise.resolve(esAdicional ? 'AINSP' : 'INSP'),
    );
  const componer = jest
    .fn()
    .mockImplementation(
      (prefijo: string, secuencial: number) =>
        `${prefijo}-${String(secuencial).padStart(3, '0')}-05-AGO-2026`,
    );
  const exigirQueAdmitaAdicionales = jest
    .fn()
    .mockImplementation(() =>
      admiteAdicionales
        ? Promise.resolve(undefined)
        : Promise.reject(
            new ValidacionError(
              'El formulario INSPECCIONES no admite operativos adicionales.',
              {},
            ),
          ),
    );
  const exigirEscritura = jest
    .fn()
    .mockImplementation(() =>
      escrituraBloqueada
        ? Promise.reject(escrituraBloqueada)
        : Promise.resolve({ id: 9, fecha: JORNADA }),
    );
  // Regla del 2026-08-11: registrar abre la jornada si todavía no existe. El doble se
  // comporta igual que `exigirEscritura` porque desde el registro son indistinguibles:
  // los dos devuelven la jornada en la que se va a escribir, o rechazan con el motivo.
  const asegurarParaRegistro = jest
    .fn()
    .mockImplementation(() =>
      escrituraBloqueada
        ? Promise.reject(escrituraBloqueada)
        : Promise.resolve({ id: 9, fecha: JORNADA }),
    );
  const log = jest.fn();
  const warn = jest.fn();

  // ── M-15 ──
  const crearAsignacion = jest
    .fn()
    .mockImplementation((datos: { funcionarioId: number }) =>
      Promise.resolve({ id: 700, ...datos }),
    );
  const retirarResponsabilidad = jest.fn().mockResolvedValue(undefined);
  const eliminarAsignacion = jest.fn().mockResolvedValue(true);
  // RN-66 (2026-09-09): cambiar el turno de una asignación existente.
  const actualizarTurnoAsignacion = jest.fn().mockResolvedValue(undefined);
  // Trámites de Inspección (2026-10-07): la copia se guarda junto a la asignación.
  const guardarTramite = jest.fn().mockResolvedValue(undefined);
  const quitarTramite = jest.fn().mockResolvedValue(true);
  const copiasParaGuardar = jest
    .fn()
    .mockImplementation(
      (
        _fecha: string,
        solicitudes: { funcionarioId: number; codigoTramite: string }[],
      ) =>
        Promise.resolve(
          new Map(
            solicitudes.map((solicitud) => [
              solicitud.funcionarioId,
              {
                codigoTramite: solicitud.codigoTramite,
                nroSitra: 'AMC-ECU9500',
                predio: null,
                zonal: 'Los Chillos',
                materia: 'Espacio público',
                tipoTramite: 'DENUNCIA',
                estado: 'ASIGNADO',
              },
            ]),
          ),
        ),
    );
  const recalcular = jest.fn().mockResolvedValue([]);
  const obtenerFuncionario = jest
    .fn()
    .mockResolvedValue({ ...FUNCIONARIO, ...funcionario });
  const verificar = jest.fn().mockResolvedValue(veredictoDescanso);

  // PUNTO NUEVO al registrar (Unidad de Operativos, 2026-09-24). `validar…` corre antes de la
  // transacción y devuelve el nombre recortado; `crear…EnTransaccion` escribe dentro de ella y
  // devuelve el punto con su id, que el registro usa como punto de encuentro del operativo.
  const validarPuntoDeRegistro = jest
    .fn()
    .mockImplementation((_codigo: string, datos: { nombre: string }) =>
      Promise.resolve(datos.nombre.trim()),
    );
  const crearPuntoEnTransaccion = jest.fn().mockResolvedValue({
    id: 77,
    nombre: 'Plaza Nueva',
    zonalId: 1,
    activo: true,
  });

  const heredar = opciones.herencia?.error
    ? jest.fn().mockRejectedValue(opciones.herencia.error)
    : jest
        .fn()
        .mockResolvedValue(
          opciones.herencia?.resultado ?? { heredado: false, motivo: null },
        );
  const compararCambios = jest
    .fn()
    .mockReturnValue([{ campo: 'oper_hora_fin', valorNuevo: '13:00' }]);
  const registroHerencia = new RegistroHerenciaTransporte();
  const registroCompartir = new RegistroCompatibilidadCompartir();
  if (opciones.compartir?.evaluar)
    registroCompartir.registrar({ evaluar: opciones.compartir.evaluar });
  const buscarCoincidencias = jest
    .fn()
    .mockResolvedValue(opciones.compartir?.coincidencias ?? []);
  const paraCompartir = opciones.compartir?.paraCompartir ?? [];
  const buscarParaCompartir = jest
    .fn()
    .mockImplementation((ids: number[]) =>
      Promise.resolve(
        paraCompartir.filter((op) => ids.includes((op as { id: number }).id)),
      ),
    );
  const miembrosDeUnidad = jest
    .fn()
    .mockResolvedValue(opciones.compartir?.miembros ?? []);
  if (opciones.herencia) registroHerencia.registrar({ heredar });

  const servicio = new OperativosService(
    {
      conAutores: jest.fn((operativos: unknown[]) =>
        Promise.resolve(operativos),
      ),
      buscarPorId: jest.fn().mockResolvedValue(existente),
      // Al registrar con personal, el servicio relee el operativo DENTRO de la
      // transacción para derivar las alertas ya con su gente dentro: en ese momento
      // existe, aunque la prueba no haya preparado ninguno previo.
      buscarPorIdEn: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(existente ?? operativoGuardado()),
        ),
      listar,
      contarPorFormulario,
      contarDelFormulario,
      contarDelPrefijo,
      buscarPorGrupoRegistro,
      crear,
      actualizar,
      reemplazarZonales,
      reemplazarInstituciones,
      reemplazarTiposControl,
      desactivar,
      contarOrdenesEmitidas,
      contarAdicionales,
      eliminar,
      ejecutarEnTransaccion: jest
        .fn()
        .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
          operacion(CLIENTE),
        ),
      actualizarVentana,
      tieneTransporteAsignado,
      transporteDeOperativos,
      liberarPorCambio,
      limpiarTransporteLiberado,
      actualizarTransporte: jest.fn().mockResolvedValue(undefined),
      buscarCoincidencias,
      buscarParaCompartir,
      miembrosDeUnidad,
    } as unknown as OperativosRepository,
    {
      crear: crearAsignacion,
      retirarResponsabilidad,
      eliminar: eliminarAsignacion,
      actualizarTurno: actualizarTurnoAsignacion,
      guardarTramite,
      quitarTramite,
    } as unknown as AsignacionPersonalRepository,
    {
      exigirEscritura,
      asegurarParaRegistro,
    } as unknown as CuadroDiarioService,
    {
      obtenerDefinicion: jest.fn().mockResolvedValue(FORMULARIO),
      obtenerPermitidos,
    } as unknown as FormulariosService,
    {
      obtenerCatalogos: jest
        .fn()
        .mockResolvedValue({ ...CATALOGOS, ...catalogos }),
      validarPuntoDeRegistro,
      crearPuntoEnTransaccion,
    } as unknown as CatalogosService,
    {
      obtenerTexto: jest
        .fn()
        .mockImplementation((clave: string) =>
          Promise.resolve(
            clave === 'FRANJA_NOCTURNA_INICIO' ? '18:00' : '06:00',
          ),
        ),
      // Rango de «Mis operativos» (2026-10-13): sin sembrar, rige el valor por defecto.
      obtenerTextoOpcional: jest.fn().mockResolvedValue(''),
    } as unknown as ParametroPoliticaService,
    {
      generar,
      resolverPrefijo,
      componer,
      exigirQueAdmitaAdicionales,
    } as unknown as GeneradorIdentificadorService,
    { recalcular } as unknown as CalculadorAlertasService,
    { obtener: obtenerFuncionario } as unknown as FuncionariosService,
    { verificar } as unknown as ElegibilidadService,
    {
      registrar,
      compararCambios,
    } as unknown as AuditoriaService,
    {
      buscarPorRol: buscarVentanaPorRol,
    } as unknown as VentanaCargaRepository,
    { evaluar: evaluarVentana } as unknown as VentanaCargaEvaluador,
    { log, warn } as unknown as LoggerService,
    { copiasParaGuardar } as unknown as TramitesInspeccionService,
    registroHerencia,
    registroCompartir,
  );

  return {
    servicio,
    heredar,
    crearAsignacion,
    retirarResponsabilidad,
    eliminarAsignacion,
    actualizarTurnoAsignacion,
    actualizarVentana,
    recalcular,
    verificar,
    crear,
    enviados,
    contarDelFormulario,
    actualizar,
    desactivar,
    reemplazarZonales,
    reemplazarInstituciones,
    listar,
    contarPorFormulario,
    obtenerPermitidos,
    registrar,
    generar,
    resolverPrefijo,
    componer,
    contarDelPrefijo,
    buscarPorGrupoRegistro,
    reemplazarTiposControl,
    exigirEscritura,
    asegurarParaRegistro,
    contarOrdenesEmitidas,
    contarAdicionales,
    eliminar,
    evaluarVentana,
    exigirQueAdmitaAdicionales,
    validarPuntoDeRegistro,
    crearPuntoEnTransaccion,
    warn,
    guardarTramite,
    quitarTramite,
    copiasParaGuardar,
    tieneTransporteAsignado,
    transporteDeOperativos,
    liberarPorCambio,
    limpiarTransporteLiberado,
    buscarCoincidencias,
    buscarParaCompartir,
    miembrosDeUnidad,
    compararCambios,
  };
};

describe('OperativosService · registro', () => {
  it('caso 1 del plan · registra y devuelve el identificador generado', async () => {
    const { servicio, crear } = armar();

    const operativo = await servicio.registrar(REGISTRO_VALIDO, AUTOR);

    expect(operativo.identificador).toBe('INSP-001-05-AGO-2026');
    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ secuencial: 1, cuadroId: 9, formularioId: 8 }),
      CLIENTE,
    );
  });

  /**
   * PUNTO NUEVO al registrar (Unidad de Operativos, 2026-09-24). Se crea DENTRO de la MISMA
   * transacción del operativo (mismo `CLIENTE`): si el operativo no se creara, el punto tampoco
   * quedaría. Su identificador pasa a ser el punto de encuentro del operativo.
   */
  it('punto nuevo · lo crea en la transacción del operativo y lo usa como su punto', async () => {
    const { servicio, crear, validarPuntoDeRegistro, crearPuntoEnTransaccion } =
      armar();

    await servicio.registrar(
      {
        ...REGISTRO_VALIDO,
        puntoEncuentroId: undefined,
        puntoNuevo: { nombre: 'Plaza Nueva', zonalId: 1 },
      },
      AUTOR,
    );

    // Se valida ANTES de abrir la transacción.
    expect(validarPuntoDeRegistro).toHaveBeenCalledWith('INSP', {
      nombre: 'Plaza Nueva',
      zonalId: 1,
    });
    // Se crea DENTRO de la transacción (mismo cliente que el operativo) y ligado al formulario.
    expect(crearPuntoEnTransaccion).toHaveBeenCalledWith(
      CLIENTE,
      { nombre: 'Plaza Nueva', zonalId: 1, formularioId: 8 },
      AUTOR.usuarioId,
    );
    // El operativo usa el id del punto recién creado, sin punto libre.
    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ puntoEncuentroId: 77, puntoLibre: null }),
      CLIENTE,
    );
  });

  it('punto nuevo · es excluyente con elegir uno del catálogo', async () => {
    const { servicio, crear, crearPuntoEnTransaccion } = armar();

    await expect(
      servicio.registrar(
        {
          ...REGISTRO_VALIDO,
          puntoEncuentroId: 10,
          puntoNuevo: { nombre: 'Plaza Nueva', zonalId: 1 },
        },
        AUTOR,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);

    expect(crearPuntoEnTransaccion).not.toHaveBeenCalled();
    expect(crear).not.toHaveBeenCalled();
  });

  it('punto nuevo · su zonal debe estar entre las seleccionadas del operativo', async () => {
    const { servicio, crear, crearPuntoEnTransaccion } = armar();

    await expect(
      servicio.registrar(
        {
          ...REGISTRO_VALIDO,
          puntoEncuentroId: undefined,
          zonalesIds: [1],
          puntoNuevo: { nombre: 'Plaza Nueva', zonalId: 2 },
        },
        AUTOR,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);

    expect(crearPuntoEnTransaccion).not.toHaveBeenCalled();
    expect(crear).not.toHaveBeenCalled();
  });

  /**
   * RN-20, agregada el 2026-08-11. `ClasificacionControl` comprobaba la bandera desde
   * M-14 y `UbicacionOperativa` no: el servidor aceptaba un punto capturado libremente
   * en cualquiera de los nueve formularios.
   */
  it('rechaza el punto libre si el catálogo del formulario no lo prevé', async () => {
    const { servicio, crear } = armar();

    await expect(
      servicio.registrar(
        {
          ...REGISTRO_VALIDO,
          puntoEncuentroId: undefined,
          puntoLibre: 'Frente al mercado',
        },
        AUTOR,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);

    expect(crear).not.toHaveBeenCalled();
  });

  /**
   * REGLA DEL 2026-08-11 · EL OPERATIVO Y SU PERSONAL ENTRAN JUNTOS O NO ENTRAN.
   *
   * Antes el personal se asignaba después de crear el operativo, una persona por
   * petición: al rechazarse una, el operativo ya existía y quedaba vacío en el cuadro.
   */
  describe('personal en el registro', () => {
    it('asigna a quien viaja con el registro, en la misma transacción', async () => {
      const { servicio, crearAsignacion } = armar();

      await servicio.registrar(
        { ...REGISTRO_VALIDO, personalIds: [100] },
        AUTOR,
      );

      expect(crearAsignacion).toHaveBeenCalledWith(
        expect.objectContaining({ funcionarioId: 100, esResponsable: false }),
        CLIENTE,
      );
    });

    it('si una persona es rechazada, NO se crea el operativo', async () => {
      const { servicio, crear, crearAsignacion } = armar({
        veredictoDescanso: {
          elegible: false,
          codigo: 'SOLAPAMIENTO_HORARIO',
          motivo:
            'BENAVIDES FERNANDO ya está asignada al operativo INSP-001 de 08H00 A 12H00, que se cruza con este horario',
        },
      });

      await expect(
        servicio.registrar({ ...REGISTRO_VALIDO, personalIds: [100] }, AUTOR),
      ).rejects.toBeInstanceOf(ReglaNegocioError);

      // Ni el operativo ni la asignación: la verificación ocurre ANTES de escribir.
      expect(crear).not.toHaveBeenCalled();
      expect(crearAsignacion).not.toHaveBeenCalled();
    });

    it('el rechazo conserva el motivo del servidor, que es lo que se muestra', async () => {
      const { servicio } = armar({
        veredictoDescanso: {
          elegible: false,
          codigo: 'SOLAPAMIENTO_HORARIO',
          motivo: 'se cruza con este horario',
        },
      });

      const fallo = await servicio
        .registrar({ ...REGISTRO_VALIDO, personalIds: [100] }, AUTOR)
        .catch((error: unknown) => error);

      expect((fallo as ReglaNegocioError).message).toContain(
        'se cruza con este horario',
      );
    });

    it('sin personal el registro sigue funcionando igual', async () => {
      const { servicio, crear, crearAsignacion } = armar();

      await servicio.registrar(REGISTRO_VALIDO, AUTOR);

      expect(crear).toHaveBeenCalled();
      expect(crearAsignacion).not.toHaveBeenCalled();
    });

    it('trámite de Inspección · lo comprueba contra Inspección y guarda la copia en la asignación (2026-10-07)', async () => {
      const { servicio, copiasParaGuardar, guardarTramite } = armar();

      await servicio.registrar(
        {
          ...REGISTRO_VALIDO,
          personal: [
            {
              funcionarioId: 100,
              tramiteInspeccion: { codigoTramite: ' DENUNCIA-26-3415 ' },
            },
          ],
        },
        AUTOR,
        'token-de-auth',
      );

      // Una sola consulta, con la cédula de la ficha y el token de la sesión; el código recortado.
      expect(copiasParaGuardar).toHaveBeenCalledTimes(1);
      const [, solicitudes, token] = copiasParaGuardar.mock.calls[0] as [
        string,
        { funcionarioId: number; codigoTramite: string }[],
        string,
      ];
      expect(solicitudes).toEqual([
        expect.objectContaining({
          funcionarioId: 100,
          codigoTramite: 'DENUNCIA-26-3415',
        }),
      ]);
      expect(token).toBe('token-de-auth');
      // La copia se escribe en la asignación recién creada (id 700), dentro de la transacción.
      expect(guardarTramite).toHaveBeenCalledWith(
        700,
        expect.objectContaining({ codigoTramite: 'DENUNCIA-26-3415' }),
        AUTOR.usuarioId,
        CLIENTE,
      );
    });

    it('trámite de Inspección · sin trámite elegido NO se pregunta a Inspección', async () => {
      const { servicio, copiasParaGuardar, guardarTramite } = armar();

      await servicio.registrar(
        { ...REGISTRO_VALIDO, personalIds: [100] },
        AUTOR,
        'token-de-auth',
      );

      expect(copiasParaGuardar).not.toHaveBeenCalled();
      expect(guardarTramite).not.toHaveBeenCalled();
    });

    it('trámite de Inspección · si Inspección lo rechaza, NO se crea el operativo', async () => {
      const { servicio, copiasParaGuardar, crear } = armar();
      copiasParaGuardar.mockRejectedValueOnce(
        new ReglaNegocioError(
          'TRAMITE_INSPECCION_NO_VALIDO',
          'El trámite X no figura entre los asignados.',
        ),
      );

      await expect(
        servicio.registrar(
          {
            ...REGISTRO_VALIDO,
            personal: [
              { funcionarioId: 100, tramiteInspeccion: { codigoTramite: 'X' } },
            ],
          },
          AUTOR,
          'token-de-auth',
        ),
      ).rejects.toThrow('no figura entre los asignados');
      expect(crear).not.toHaveBeenCalled();
    });

    it('la misma persona repetida se asigna una sola vez', async () => {
      const { servicio, crearAsignacion } = armar();

      await servicio.registrar(
        { ...REGISTRO_VALIDO, personalIds: [100, 100] },
        AUTOR,
      );

      expect(crearAsignacion).toHaveBeenCalledTimes(1);
    });
  });

  it('regla del 2026-08-11 · abre la jornada en lugar de exigir que ya exista', async () => {
    const { servicio, asegurarParaRegistro, exigirEscritura } = armar();

    await servicio.registrar(REGISTRO_VALIDO, AUTOR);

    // Quien registra queda como autor de la apertura: es el único dato con el que la
    // auditoría puede decir después quién abrió la jornada.
    expect(asegurarParaRegistro).toHaveBeenCalledWith(JORNADA, AUTOR.usuarioId);
    // Y ya NO se exige una jornada preexistente: si se llamara a las dos, la primera
    // rechazaría el registro antes de que la segunda pudiera abrir nada.
    expect(exigirEscritura).not.toHaveBeenCalled();
  });

  it('caso 6 del plan · nace PENDIENTE, sin conductor ni vehículo', async () => {
    const { servicio, enviados } = armar();

    const operativo = await servicio.registrar(REGISTRO_VALIDO, AUTOR);

    // El servicio no envía ni conductor ni vehículo: RN-40 los deja nulos y solo la
    // DAF los completa, desde otro contrato. `DatosOperativo` ni siquiera los declara,
    // así que esto se comprueba también al compilar.
    expect(Object.keys(enviados[0])).not.toContain('conductorId');
    expect(Object.keys(enviados[0])).not.toContain('vehiculoId');
    expect(operativo.estadoTransporte).toBe('PENDIENTE');
    expect(operativo.alertaActiva).toBe(true);
  });

  it('deriva la duración y el cruce de medianoche del horario', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar(
      { ...REGISTRO_VALIDO, horaInicio: '22:00', horaFin: '02:00' },
      AUTOR,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        duracionHoras: 4,
        cruzaMedianoche: true,
        esNocturno: true,
      }),
      CLIENTE,
    );
  });

  it('marca como nocturno lo que toca la franja configurada', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar(
      { ...REGISTRO_VALIDO, horaInicio: '17:00', horaFin: '19:00' },
      AUTOR,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ esNocturno: true }),
      CLIENTE,
    );
  });

  it('RN-66 · sin horario de operativo, toma la ventana de la persona asignada', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar(
      {
        ...REGISTRO_VALIDO,
        horaInicio: undefined,
        horaFin: undefined,
        personal: [
          { funcionarioId: 100, horaInicio: '06:00', horaFin: '11:00' },
        ],
      },
      AUTOR,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        horaInicio: '06:00',
        horaFin: '11:00',
        duracionHoras: 5,
        esNocturno: false,
      }),
      CLIENTE,
    );
  });

  it('RN-66 · es nocturno si la persona lo es, aunque el operativo no traiga horario', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar(
      {
        ...REGISTRO_VALIDO,
        horaInicio: undefined,
        horaFin: undefined,
        personal: [
          { funcionarioId: 100, horaInicio: '20:00', horaFin: '23:00' },
        ],
      },
      AUTOR,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ esNocturno: true }),
      CLIENTE,
    );
  });

  it('RN-66 · sin horario de operativo, exige que cada persona traiga el suyo', async () => {
    const { servicio } = armar();

    await expect(
      servicio.registrar(
        {
          ...REGISTRO_VALIDO,
          horaInicio: undefined,
          horaFin: undefined,
          personal: [{ funcionarioId: 100 }],
        },
        AUTOR,
      ),
    ).rejects.toThrow(ValidacionError);
  });

  it('las observaciones entran como notas, recortadas y sin las vacías (RN, 2026-09-09)', async () => {
    const { servicio, enviados } = armar();

    await servicio.registrar(
      { ...REGISTRO_VALIDO, observaciones: ['Uno', '  Dos  ', '   '] },
      AUTOR,
    );

    // El repositorio las recibe ya limpias, como lista de textos: cada una será una fila.
    expect(enviados[0].observaciones).toEqual(['Uno', 'Dos']);
  });

  it('en un formulario por-persona, cada persona genera N operativos con la MISMA hora general (2026-09-14, sin segmentar)', async () => {
    // El 8 divide por persona (`variosPorPersona`) Y ofrece la cantidad (`cantidadPorPersona`).
    // La persona (id 100, horario 08:00–12:00) con cantidad 3 genera 3 operativos de una sola
    // persona: el horario YA NO se reparte en tramos, los tres llevan la ventana COMPLETA.
    const { servicio, crear } = armar({
      catalogos: { variosPorPersona: true, cantidadPorPersona: true },
    });

    await servicio.registrar(
      { ...REGISTRO_VALIDO, personal: [{ funcionarioId: 100, cantidad: 3 }] },
      AUTOR,
    );

    // Tres operativos, con secuenciales 1, 2 y 3 (una transacción), todos con 08:00–12:00.
    expect(crear).toHaveBeenCalledTimes(3);
    const llamadas = crear.mock.calls as Array<[DatosOperativo, ...unknown[]]>;
    expect(
      llamadas.map((llamada) => ({
        secuencial: llamada[0].secuencial,
        horaInicio: llamada[0].horaInicio,
        horaFin: llamada[0].horaFin,
      })),
    ).toEqual([
      { secuencial: 1, horaInicio: '08:00', horaFin: '12:00' },
      { secuencial: 2, horaInicio: '08:00', horaFin: '12:00' },
      { secuencial: 3, horaInicio: '08:00', horaFin: '12:00' },
    ]);
  });

  it('trámite de Inspección · las N copias del 8 heredan el MISMO trámite (2026-10-07)', async () => {
    const { servicio, crear, guardarTramite, copiasParaGuardar } = armar({
      catalogos: { variosPorPersona: true, cantidadPorPersona: true },
    });

    await servicio.registrar(
      {
        ...REGISTRO_VALIDO,
        personal: [
          {
            funcionarioId: 100,
            cantidad: 3,
            tramiteInspeccion: { codigoTramite: 'DENUNCIA-26-3415' },
          },
        ],
      },
      AUTOR,
      'token-de-auth',
    );

    expect(crear).toHaveBeenCalledTimes(3);
    // Se comprueba UNA vez y se copia a las tres asignaciones.
    expect(copiasParaGuardar).toHaveBeenCalledTimes(1);
    expect(guardarTramite).toHaveBeenCalledTimes(3);
  });

  it('sin cantidad, crea un solo operativo (por defecto 1)', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar(REGISTRO_VALIDO, AUTOR);

    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('las copias del 8 (cantidad) COMPARTEN un mismo grupoRegistro: se agrupan como un solo registro', async () => {
    // 2026-09-21: los `variosPorPersona` —patrulla (5/6) Y el 8— enlazan su registro con un lote,
    // para pintarlo como UN operativo. Que sea patrulla (aporte, roster) lo decide `esPatrulla`, no
    // el lote; el lote-patrulla del 5/6 se cubre extremo a extremo en la integración.
    const { servicio, enviados } = armar({
      catalogos: { variosPorPersona: true, cantidadPorPersona: true },
    });

    await servicio.registrar(
      { ...REGISTRO_VALIDO, personal: [{ funcionarioId: 100, cantidad: 2 }] },
      AUTOR,
    );

    expect(enviados).toHaveLength(2);
    // Ambas copias llevan el MISMO lote, no nulo: en pantalla se agrupan como un solo operativo.
    expect(enviados[0].grupoRegistro).not.toBeNull();
    expect(enviados[0].grupoRegistro).toBe(enviados[1].grupoRegistro);
  });

  it('un registro de un solo operativo tampoco lleva grupoRegistro', async () => {
    const { servicio, enviados } = armar();

    await servicio.registrar(REGISTRO_VALIDO, AUTOR);

    expect(enviados[0].grupoRegistro).toBeNull();
  });

  it('una cantidad>1 por persona se rechaza en un formulario que no lo permite (2026-09-10)', async () => {
    const { servicio, crear } = armar(); // sin flags

    // El formulario no ofrece la cantidad por persona: una cantidad > 1 se rechaza.
    await expect(
      servicio.registrar(
        { ...REGISTRO_VALIDO, personal: [{ funcionarioId: 100, cantidad: 2 }] },
        AUTOR,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
    expect(crear).not.toHaveBeenCalled();
  });

  it('el split y la cantidad están DESACOPLADOS: el 5 divide por persona pero rechaza cantidad>1 (2026-09-14)', async () => {
    // Form 5: `variosPorPersona` (divide por persona, para que cada área lleve su código) pero
    // SIN `cantidadPorPersona` (no ofrece elegir cantidad). Una cantidad > 1 se sigue rechazando.
    const { servicio, crear } = armar({
      catalogos: { variosPorPersona: true },
    });

    await expect(
      servicio.registrar(
        { ...REGISTRO_VALIDO, personal: [{ funcionarioId: 100, cantidad: 2 }] },
        AUTOR,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
    expect(crear).not.toHaveBeenCalled();
  });

  it('el secuencial continúa la numeración del formulario en esa jornada', async () => {
    const { servicio, crear, resolverPrefijo, componer } = armar({
      conteoInicial: 4,
    });

    await servicio.registrar(REGISTRO_VALIDO, AUTOR);

    // Desde el 2026-09-17 el prefijo se resuelve ANTES de contar (numeración por prefijo en
    // las patrullas) y el código se compone aparte. El 2.º argumento dice si nace adicional
    // —de él dependen la serie y el prefijo— y el 3.º son las áreas del personal (solo el 8 y
    // las patrullas las usan; aquí, sin personal en el registro de prueba, llega vacío).
    expect(resolverPrefijo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8 }),
      false,
      [],
    );
    expect(componer).toHaveBeenCalledWith('INSP', 5, JORNADA);
    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ secuencial: 5 }),
      CLIENTE,
    );
  });

  it('caso 5 del plan · una colisión de secuencial se reintenta sin que se note', async () => {
    const { servicio, crear } = armar({ fallosDeUnicidad: 1 });

    const operativo = await servicio.registrar(REGISTRO_VALIDO, AUTOR);

    expect(operativo.identificador).toBe('INSP-001-05-AGO-2026');
    expect(crear).toHaveBeenCalledTimes(2);
  });

  it('tres colisiones seguidas dejan de reintentarse', async () => {
    const { servicio, crear } = armar({ fallosDeUnicidad: 5 });

    await expect(servicio.registrar(REGISTRO_VALIDO, AUTOR)).rejects.toThrow();
    expect(crear).toHaveBeenCalledTimes(3);
  });

  it('audita el registro DENTRO de la transacción', async () => {
    const { servicio, registrar } = armar();

    await servicio.registrar(REGISTRO_VALIDO, AUTOR);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_operativo',
        accion: AccionAuditoria.CREAR,
        usuario: 2,
        rol: RolDepartamental.DMIP_INSPECCIONES,
      }),
      CLIENTE,
    );
  });

  it('PER-06 · el rol compartido no registra: tiene cupo de personal, no propiedad', async () => {
    const { servicio, crear } = armar();

    const fallo = await capturar(
      servicio.registrar(REGISTRO_VALIDO, {
        usuarioId: 3,
        rol: RolDepartamental.DMIT_INSTRUCTOR,
      }),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect((fallo as AutorizacionError).code).toBe('FORMULARIO_NO_AUTORIZADO');
    expect((fallo as AutorizacionError).message).toContain('cupo de personal');
    expect(crear).not.toHaveBeenCalled();
  });

  it('no registra en un cuadro cerrado, y ni siquiera consulta catálogos', async () => {
    const cerrado = new Error('cuadro cerrado');
    const { servicio, crear } = armar({ escrituraBloqueada: cerrado });

    await expect(servicio.registrar(REGISTRO_VALIDO, AUTOR)).rejects.toBe(
      cerrado,
    );
    expect(crear).not.toHaveBeenCalled();
  });
});

describe('OperativosService · coherencia de lo elegido', () => {
  it('caso 7 del plan · una hora fuera de la media hora se rechaza', async () => {
    const { servicio } = armar();

    await expect(
      servicio.registrar({ ...REGISTRO_VALIDO, horaInicio: '08:15' }, AUTOR),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('el mismo horario de inicio y fin se rechaza', async () => {
    const { servicio } = armar();

    await expect(
      servicio.registrar(
        { ...REGISTRO_VALIDO, horaInicio: '08:00', horaFin: '08:00' },
        AUTOR,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('caso 8 del plan · sin ninguna zonal se rechaza', async () => {
    const { servicio } = armar();

    const fallo = await capturar(
      servicio.registrar({ ...REGISTRO_VALIDO, zonalesIds: [] }, AUTOR),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('zonal');
  });

  it('caso 9 del plan · punto de catálogo y punto libre a la vez se rechaza', async () => {
    const { servicio } = armar();

    const fallo = await capturar(
      servicio.registrar(
        { ...REGISTRO_VALIDO, puntoLibre: 'Frente al mercado' },
        AUTOR,
      ),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('no las dos cosas');
  });

  it('INV-07 · un punto de otra zonal se rechaza nombrando ambas', async () => {
    const { servicio } = armar();

    // El punto 20 pertenece a Eugenio Espejo; el operativo solo abarca La Delicia.
    const fallo = await capturar(
      servicio.registrar(
        { ...REGISTRO_VALIDO, zonalesIds: [1], puntoEncuentroId: 20 },
        AUTOR,
      ),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('Parque Bicentenario');
    expect((fallo as ValidacionError).message).toContain('Eugenio Espejo');
  });

  it('INV-08 · un tipo de control ajeno al formulario se rechaza', async () => {
    const { servicio } = armar();

    const fallo = await capturar(
      servicio.registrar({ ...REGISTRO_VALIDO, tipoControlId: 999 }, AUTOR),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('INSPECCIONES');
  });

  it('una institución que no participa en el formulario se rechaza', async () => {
    const { servicio } = armar();

    const fallo = await capturar(
      servicio.registrar({ ...REGISTRO_VALIDO, institucionesIds: [99] }, AUTOR),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('instituciones');
  });

  it('RN-20 · el tipo libre se acepta porque el formulario ofrece ADICIONALES', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar(
      {
        ...REGISTRO_VALIDO,
        tipoControlId: undefined,
        tipoLibre: 'Control de escombros',
      },
      AUTOR,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoControlId: null,
        tipoLibre: 'Control de escombros',
      }),
      CLIENTE,
    );
  });

  it('una zonal repetida no duplica la fila puente', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar({ ...REGISTRO_VALIDO, zonalesIds: [1, 1] }, AUTOR);

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ zonalIds: [1] }),
      CLIENTE,
    );
  });
});

describe('OperativosService · edición', () => {
  it('modifica el horario y recalcula lo derivado', async () => {
    const { servicio, actualizar } = armar({ existente: operativoGuardado() });

    await servicio.editar(500, { version: 1, horaFin: '13:00' }, AUTOR);

    expect(actualizar).toHaveBeenCalledWith(
      500,
      1,
      expect.objectContaining({
        horaInicio: '08:00',
        horaFin: '13:00',
        duracionHoras: 5,
      }),
      AUTOR,
      CLIENTE,
      // Sin notas nuevas en esta edición (bitácora append-only, 2026-09-09).
      [],
    );
  });

  it('al editar se AGREGAN las notas nuevas, limpias (bitácora, 2026-09-09)', async () => {
    const { servicio, actualizar } = armar({ existente: operativoGuardado() });

    await servicio.editar(
      500,
      { version: 1, observacionesNuevas: ['Nueva', '   ', ' Otra '] },
      AUTOR,
    );

    // El 6.º argumento son las notas nuevas, recortadas y sin las vacías.
    expect(actualizar).toHaveBeenCalledWith(
      500,
      1,
      expect.any(Object),
      AUTOR,
      CLIENTE,
      ['Nueva', 'Otra'],
    );
  });

  it('caso 10 del plan · una versión desactualizada produce conflicto', async () => {
    const { servicio } = armar({
      existente: operativoGuardado(),
      versionDesactualizada: true,
    });

    const fallo = await capturar(
      servicio.editar(500, { version: 1, horaFin: '13:00' }, AUTOR),
    );

    expect(fallo).toBeInstanceOf(ConflictoConcurrenciaError);
    expect((fallo as ConflictoConcurrenciaError).message).toContain(
      'otra persona',
    );
  });

  it('no toca las zonales si no cambiaron', async () => {
    const { servicio, reemplazarZonales } = armar({
      existente: operativoGuardado(),
    });

    await servicio.editar(500, { version: 1, zonalesIds: [1] }, AUTOR);

    expect(reemplazarZonales).not.toHaveBeenCalled();
  });

  it('reemplaza las zonales cuando cambian', async () => {
    const { servicio, reemplazarZonales } = armar({
      existente: operativoGuardado(),
    });

    await servicio.editar(500, { version: 1, zonalesIds: [1, 2] }, AUTOR);

    expect(reemplazarZonales).toHaveBeenCalledWith(500, [1, 2], CLIENTE);
  });

  it('cambiar a punto libre borra el punto del catálogo', async () => {
    // El formulario debe admitirlo: desde el 2026-08-11 `UbicacionOperativa` comprueba
    // RN-20 también en el punto, y el fixture usa la configuración de INSP, que no lo
    // ofrece. Lo que esta prueba verifica es el borrado del punto de catálogo, no la
    // bandera, así que se habilita explícitamente.
    const { servicio, actualizar } = armar({
      existente: operativoGuardado(),
      catalogos: { capturaLibrePunto: true },
    });

    await servicio.editar(
      500,
      { version: 1, puntoLibre: 'Frente al mercado' },
      AUTOR,
    );

    expect(actualizar).toHaveBeenCalledWith(
      500,
      1,
      expect.objectContaining({
        puntoEncuentroId: null,
        puntoLibre: 'Frente al mercado',
      }),
      AUTOR,
      CLIENTE,
      [],
    );
  });

  it('un rol que no es dueño del formulario no puede editar', async () => {
    const { servicio, actualizar } = armar({ existente: operativoGuardado() });

    const fallo = await capturar(
      servicio.editar(
        500,
        { version: 1, horaFin: '13:00' },
        {
          usuarioId: 1,
          rol: RolDepartamental.DMIP_OPERATIVOS,
        },
      ),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect((fallo as AutorizacionError).code).toBe('FORMULARIO_NO_AUTORIZADO');
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('un operativo inexistente produce 404', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editar(500, { version: 1 }, AUTOR),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('audita la modificación campo a campo', async () => {
    const { servicio, registrar } = armar({ existente: operativoGuardado() });

    await servicio.editar(500, { version: 1, horaFin: '13:00' }, AUTOR);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: AccionAuditoria.ACTUALIZAR,
        operativoId: 500,
        cambios: [{ campo: 'oper_hora_fin', valorNuevo: '13:00' }],
      }),
      CLIENTE,
    );
  });
});

/**
 * PV-10, decidido por el Product Owner el 2026-08-07: la baja BORRA la fila mientras no
 * haya nada emitido, y solo se conserva desactivada cuando ya existen órdenes.
 *
 * Las tres primeras pruebas de este bloque afirmaban lo contrario —que nunca se borraba—
 * y se reescribieron con la decisión nueva, no se ampliaron: una prueba que sobreviva a
 * un cambio de regla es una prueba que ya no dice qué regla rige.
 */
describe('OperativosService · baja (PV-10)', () => {
  it('sin órdenes emitidas, la fila SE BORRA', async () => {
    const { servicio, eliminar, desactivar } = armar({
      existente: operativoGuardado(),
      ordenesEmitidas: 0,
    });

    const baja = await servicio.retirar(500, 1, AUTOR);

    expect(eliminar).toHaveBeenCalledWith(500, 1, CLIENTE);
    expect(desactivar).not.toHaveBeenCalled();
    expect(baja.eliminado).toBe(true);
    expect(baja.identificador).toBe('INSP-001-05-AGO-2026');
  });

  it('con órdenes emitidas, la fila se conserva desactivada', async () => {
    const { servicio, eliminar, desactivar } = armar({
      existente: operativoGuardado(),
      ordenesEmitidas: 2,
    });

    const baja = await servicio.retirar(500, 1, AUTOR);

    expect(desactivar).toHaveBeenCalledWith(500, 1, AUTOR, CLIENTE);
    expect(eliminar).not.toHaveBeenCalled();
    expect(baja.eliminado).toBe(false);
    expect(baja.ordenesEmitidas).toBe(2);
  });

  /**
   * `fk_auditoria_operativo` es `SET NULL`: tras el borrado la fila de auditoría queda
   * sin enlace, y el identificador es lo único que la deja legible. Por eso viaja en
   * `valorAnterior` y no se confía en `operativoId`.
   */
  it('la traza nombra el identificador, porque el enlace no sobrevive al borrado', async () => {
    const { servicio, registrar } = armar({ existente: operativoGuardado() });

    await servicio.retirar(500, 1, AUTOR);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: AccionAuditoria.ELIMINAR,
        entidad: 't_operativo',
        cambios: [
          expect.objectContaining({ valorAnterior: 'INSP-001-05-AGO-2026' }),
        ],
      }),
      CLIENTE,
    );
  });

  it('una versión desactualizada impide el borrado', async () => {
    const { servicio } = armar({
      existente: operativoGuardado(),
      versionDesactualizada: true,
    });

    await expect(servicio.retirar(500, 1, AUTOR)).rejects.toBeInstanceOf(
      ConflictoConcurrenciaError,
    );
  });

  it('una versión desactualizada impide también la baja lógica', async () => {
    const { servicio } = armar({
      existente: operativoGuardado(),
      versionDesactualizada: true,
      ordenesEmitidas: 1,
    });

    await expect(servicio.retirar(500, 1, AUTOR)).rejects.toBeInstanceOf(
      ConflictoConcurrenciaError,
    );
  });

  it('un rol ajeno no puede retirar', async () => {
    const { servicio, eliminar, desactivar } = armar({
      existente: operativoGuardado(),
    });

    await expect(
      servicio.retirar(500, 1, {
        usuarioId: 3,
        rol: RolDepartamental.DMIT_INSTRUCTOR,
      }),
    ).rejects.toBeInstanceOf(AutorizacionError);
    expect(eliminar).not.toHaveBeenCalled();
    expect(desactivar).not.toHaveBeenCalled();
  });
});

describe('OperativosService · asignación de personal (M-15)', () => {
  it('caso 1 del plan · asigna a una persona elegible y recalcula las alertas', async () => {
    const { servicio, crearAsignacion, recalcular } = armar({
      existente: operativoGuardado(),
    });

    await servicio.asignarPersonal(500, { funcionarioId: 100 }, AUTOR);

    expect(crearAsignacion).toHaveBeenCalledWith(
      {
        operativoId: 500,
        funcionarioId: 100,
        asignadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
        esResponsable: false,
        horaInicio: null,
        horaFin: null,
      },
      CLIENTE,
    );
    expect(recalcular).toHaveBeenCalledTimes(1);
  });

  it('con ventana propia dentro del operativo · verifica y persiste ese turno (2026-09-08)', async () => {
    const { servicio, crearAsignacion, verificar } = armar({
      existente: operativoGuardado(),
    });

    await servicio.asignarPersonal(
      500,
      { funcionarioId: 100, horaInicio: '09:00', horaFin: '11:00' },
      AUTOR,
    );

    // El descanso se comprueba sobre el turno de la persona, no sobre el del operativo.
    expect(verificar).toHaveBeenCalledWith(100, {
      fecha: JORNADA,
      horaInicio: '09:00',
      horaFin: '11:00',
      esPatrulla: false,
      operativoId: 500,
    });
    expect(crearAsignacion).toHaveBeenCalledWith(
      {
        operativoId: 500,
        funcionarioId: 100,
        asignadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
        esResponsable: false,
        horaInicio: '09:00',
        horaFin: '11:00',
      },
      CLIENTE,
    );
  });

  it('una ventana propia fuera del operativo se rechaza sin tocar la base (2026-09-08)', async () => {
    const { servicio, crearAsignacion, verificar } = armar({
      existente: operativoGuardado(),
    });

    const fallo = await capturar(
      servicio.asignarPersonal(
        500,
        { funcionarioId: 100, horaInicio: '07:00', horaFin: '14:00' },
        AUTOR,
      ),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect(verificar).not.toHaveBeenCalled();
    expect(crearAsignacion).not.toHaveBeenCalled();
  });

  it('consulta el descanso a `talento-operativo`, excluyendo este operativo', async () => {
    const { servicio, verificar } = armar({ existente: operativoGuardado() });

    await servicio.asignarPersonal(500, { funcionarioId: 100 }, AUTOR);

    expect(verificar).toHaveBeenCalledWith(100, {
      fecha: JORNADA,
      horaInicio: '08:00',
      horaFin: '12:00',
      esPatrulla: false,
      operativoId: 500,
    });
  });

  it('el veredicto de descanso se traslada tal cual, con su código y su motivo', async () => {
    const { servicio, crearAsignacion } = armar({
      existente: operativoGuardado(),
      veredictoDescanso: {
        elegible: false,
        codigo: 'PATRULLA_CONSECUTIVA',
        motivo: 'BENAVIDES FERNANDO salió en patrulla ayer.',
      },
    });

    const fallo = await capturar(
      servicio.asignarPersonal(500, { funcionarioId: 100 }, AUTOR),
    );

    expect((fallo as ReglaNegocioError).code).toBe('PATRULLA_CONSECUTIVA');
    expect((fallo as ReglaNegocioError).message).toContain('patrulla ayer');
    expect(crearAsignacion).not.toHaveBeenCalled();
  });

  it('caso 2 del plan · la misma persona dos veces se rechaza antes de preguntar el descanso', async () => {
    const { servicio, verificar, crearAsignacion } = armar({
      existente: operativoGuardado({
        personal: [conPersonal(100)],
      } as Partial<OperativoCompleto>),
    });

    const fallo = await capturar(
      servicio.asignarPersonal(500, { funcionarioId: 100 }, AUTOR),
    );

    expect((fallo as ReglaNegocioError).message).toContain('ya figura');
    expect(verificar).not.toHaveBeenCalled();
    expect(crearAsignacion).not.toHaveBeenCalled();
  });

  it('caso 3 del plan · un área no admitida se rechaza enumerando las que sí', async () => {
    const { servicio } = armar({
      existente: operativoGuardado(),
      funcionario: { area: AreaPersonal.OPERATIVOS },
    });

    const fallo = await capturar(
      servicio.asignarPersonal(500, { funcionarioId: 100 }, AUTOR),
    );

    expect((fallo as ReglaNegocioError).code).toBe('AREA_NO_ADMITIDA');
    expect((fallo as ReglaNegocioError).message).toContain('GENERAL');
  });

  it('caso 4 del plan · el rol compartido asigna dentro de su cupo', async () => {
    const { servicio, crearAsignacion } = armar({
      existente: operativoGuardado(),
      funcionario: { area: AreaPersonal.INSTRUCCION },
    });

    await servicio.asignarPersonal(
      500,
      { funcionarioId: 100 },
      {
        usuarioId: 3,
        rol: RolDepartamental.DMIT_INSTRUCTOR,
      },
    );

    expect(crearAsignacion).toHaveBeenCalledWith(
      expect.objectContaining({
        asignadoPorRol: RolDepartamental.DMIT_INSTRUCTOR,
      }),
      CLIENTE,
    );
  });

  it('caso 5 del plan · excedido el cupo, responde CUPO_COMPARTIDO_SUPERADO', async () => {
    const { servicio } = armar({
      existente: operativoGuardado({
        personal: [
          conPersonal(
            99,
            AreaPersonal.INSTRUCCION,
            RolDepartamental.DMIT_INSTRUCTOR,
          ),
        ],
      } as Partial<OperativoCompleto>),
      funcionario: { area: AreaPersonal.INSTRUCCION },
    });

    const fallo = await capturar(
      servicio.asignarPersonal(
        500,
        { funcionarioId: 100 },
        {
          usuarioId: 3,
          rol: RolDepartamental.DMIT_INSTRUCTOR,
        },
      ),
    );

    expect((fallo as ReglaNegocioError).code).toBe('CUPO_COMPARTIDO_SUPERADO');
  });

  it('caso 6 del plan · el rol compartido no asigna fuera de su área', async () => {
    const { servicio } = armar({
      existente: operativoGuardado(),
      funcionario: { area: AreaPersonal.GENERAL },
    });

    const fallo = await capturar(
      servicio.asignarPersonal(
        500,
        { funcionarioId: 100 },
        {
          usuarioId: 3,
          rol: RolDepartamental.DMIT_INSTRUCTOR,
        },
      ),
    );

    expect((fallo as ReglaNegocioError).code).toBe('CUPO_COMPARTIDO_SUPERADO');
    expect((fallo as ReglaNegocioError).message).toContain('INSTRUCCION');
  });

  it('un rol que no participa en el formulario no asigna', async () => {
    const { servicio, crearAsignacion } = armar({
      existente: operativoGuardado(),
    });

    const fallo = await capturar(
      servicio.asignarPersonal(
        500,
        { funcionarioId: 100 },
        {
          usuarioId: 1,
          rol: RolDepartamental.DMIP_OPERATIVOS,
        },
      ),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect(crearAsignacion).not.toHaveBeenCalled();
  });

  it('marcar responsable retira la responsabilidad de las demás', async () => {
    const { servicio, retirarResponsabilidad } = armar({
      existente: operativoGuardado(),
    });

    await servicio.asignarPersonal(
      500,
      { funcionarioId: 100, esResponsable: true },
      AUTOR,
    );

    expect(retirarResponsabilidad).toHaveBeenCalledWith(500, 100, CLIENTE);
  });

  it('sin marcar responsable, no toca a las demás', async () => {
    const { servicio, retirarResponsabilidad } = armar({
      existente: operativoGuardado(),
    });

    await servicio.asignarPersonal(500, { funcionarioId: 100 }, AUTOR);

    expect(retirarResponsabilidad).not.toHaveBeenCalled();
  });

  it('no se asigna personal en un cuadro cerrado', async () => {
    const cerrado = new Error('cuadro cerrado');
    const { servicio, crearAsignacion } = armar({
      existente: operativoGuardado(),
      escrituraBloqueada: cerrado,
    });

    await expect(
      servicio.asignarPersonal(500, { funcionarioId: 100 }, AUTOR),
    ).rejects.toBe(cerrado);
    expect(crearAsignacion).not.toHaveBeenCalled();
  });

  it('audita la asignación dentro de la transacción', async () => {
    const { servicio, registrar } = armar({ existente: operativoGuardado() });

    await servicio.asignarPersonal(500, { funcionarioId: 100 }, AUTOR);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_asignacion_personal',
        accion: AccionAuditoria.CREAR,
        operativoId: 500,
      }),
      CLIENTE,
    );
  });
});

describe('OperativosService · aporte a una patrulla CREA operativo propio (Form 5/6, 2026-09-17)', () => {
  // Una patrulla ya registrada (Form 6: `variosPorPersona` sin `cantidadPorPersona`), con su
  // lote. En una patrulla cada persona sale con su código por área, así que agregar personal no
  // suma al operativo: crea uno nuevo enlazado al MISMO grupo.
  const patrulla = (
    parcial: Partial<OperativoCompleto> = {},
  ): OperativoCompleto =>
    operativoGuardado({
      id: 700,
      identificador: 'IGNECU-001-05-AGO-2026',
      formularioId: 6,
      grupoRegistro: 'lote-1',
      formulario: {
        ...FORMULARIO,
        id: 6,
        numero: 6,
        nombre: 'PATRULLA REACCION NOCTURNA',
        variosPorPersona: true,
        cantidadPorPersona: false,
      },
      personal: [],
      ...parcial,
    } as Partial<OperativoCompleto>);

  it('no suma la persona al destino: crea un operativo, numerado POR PREFIJO, en el mismo lote', async () => {
    const { servicio, enviados, contarDelPrefijo, contarDelFormulario } = armar(
      {
        existente: patrulla(),
        // Ya hay un IGNECU en la patrulla: el nuevo operativo será el 2.º de su serie.
        conteoInicial: 1,
      },
    );

    await servicio.asignarPersonal(
      700,
      { funcionarioId: 101 },
      { usuarioId: 5, rol: RolDepartamental.DMIP_INSPECCIONES },
    );

    // Numeración por prefijo (cada área desde 001), no por formulario.
    expect(contarDelPrefijo).toHaveBeenCalled();
    expect(contarDelFormulario).not.toHaveBeenCalled();

    // Se creó UN operativo, heredando del destino ubicación/tipo/instituciones/zonales, con el
    // MISMO grupo, sin origen y sin transporte, y con la ventana de la persona.
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({
      cuadroId: 9,
      formularioId: 6,
      secuencial: 2,
      grupoRegistro: 'lote-1',
      origenId: null,
      puntoEncuentroId: 10,
      tipoControlId: 30,
      zonalIds: [1],
      institucionIds: [40],
      horaInicio: '08:00',
      horaFin: '12:00',
    });
  });

  it('la persona queda en el operativo NUEVO (no en el destino), sin marca de responsable', async () => {
    const { servicio, crearAsignacion } = armar({ existente: patrulla() });

    await servicio.asignarPersonal(
      700,
      { funcionarioId: 100 },
      { usuarioId: 5, rol: RolDepartamental.DMIP_INSPECCIONES },
    );

    // El doble de `crear` devuelve el operativo nuevo con id 500: la asignación va sobre ÉL,
    // no sobre el destino 700.
    expect(crearAsignacion).toHaveBeenCalledWith(
      expect.objectContaining({
        operativoId: 500,
        funcionarioId: 100,
        esResponsable: false,
      }),
      CLIENTE,
    );
  });

  it('el DMIT aporta Instrucción: el prefijo se elige por SU área y todo queda bajo su rol', async () => {
    const { servicio, enviados, resolverPrefijo, crearAsignacion } = armar({
      existente: patrulla(),
      funcionario: { area: AreaPersonal.INSTRUCCION },
    });

    await servicio.asignarPersonal(
      700,
      { funcionarioId: 300 },
      { usuarioId: 7, rol: RolDepartamental.DMIT_INSTRUCTOR },
      [RolDepartamental.DMIT_INSTRUCTOR],
    );

    // El prefijo (INECU) lo decide el área de la persona; el generador tiene su propia prueba.
    expect(resolverPrefijo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 6 }),
      false,
      [AreaPersonal.INSTRUCCION],
    );
    // `creado_por_rol` y `asignado_por_rol` son del DMIT que aporta.
    expect(enviados[0]).toMatchObject({
      rol: RolDepartamental.DMIT_INSTRUCTOR,
    });
    expect(crearAsignacion).toHaveBeenCalledWith(
      expect.objectContaining({
        asignadoPorRol: RolDepartamental.DMIT_INSTRUCTOR,
      }),
      CLIENTE,
    );
  });

  it('el aporte reintenta ante una colisión de secuencial, como el registro', async () => {
    const { servicio, enviados } = armar({
      existente: patrulla(),
      fallosDeUnicidad: 1,
    });

    await servicio.asignarPersonal(
      700,
      { funcionarioId: 101 },
      { usuarioId: 5, rol: RolDepartamental.DMIP_INSPECCIONES },
    );

    // Dos intentos de `crear`: el primero chocó (P2002), el segundo entró.
    expect(enviados).toHaveLength(2);
  });
});

describe('OperativosService · editar los generales de la patrulla (2026-09-18)', () => {
  // Patrulla del Form 6: inspectores del DMIP + Instrucción del DMIT, mismo `grupoRegistro`. El
  // registrante es el primero del lote (menor id): el DMIP.
  const miembro = (
    id: number,
    identificador: string,
    creadoPorRol: RolDepartamental,
  ): OperativoCompleto =>
    operativoGuardado({
      id,
      identificador,
      grupoRegistro: 'lote-1',
      creadoPorRol,
    });

  const grupo = (): OperativoCompleto[] => [
    miembro(1, 'IGNECU-001', RolDepartamental.DMIP_INSPECCIONES),
    miembro(2, 'ITNECU-001', RolDepartamental.DMIP_INSPECCIONES),
    miembro(3, 'INECU-001', RolDepartamental.DMIT_INSTRUCTOR),
  ];

  it('el registrante (DMIP) edita el punto y se aplica a los TRES códigos', async () => {
    const { servicio, actualizar, buscarPorGrupoRegistro } = armar({
      grupo: grupo(),
    });

    // Punto 20 (Parque Bicentenario) es de la zonal 2, así que se envía junto con esa zonal.
    await servicio.editarPatrulla(
      'lote-1',
      { zonalesIds: [2], puntoEncuentroId: 20 },
      { usuarioId: 2, rol: RolDepartamental.DMIP_INSPECCIONES },
    );

    // Un `actualizar` por miembro: la patrulla entera cambia, no un solo código.
    expect(actualizar).toHaveBeenCalledTimes(3);
    expect(actualizar).toHaveBeenCalledWith(
      1,
      expect.any(Number),
      expect.objectContaining({ puntoEncuentroId: 20 }),
      expect.objectContaining({ rol: RolDepartamental.DMIP_INSPECCIONES }),
      CLIENTE,
      expect.any(Array),
    );
    // Relee el lote para devolver la patrulla ya modificada.
    expect(buscarPorGrupoRegistro).toHaveBeenCalledWith('lote-1');
  });

  it('el DMIT NO puede editar los generales de la patrulla (PER-08)', async () => {
    const { servicio, actualizar } = armar({ grupo: grupo() });

    const fallo = await capturar(
      servicio.editarPatrulla(
        'lote-1',
        { puntoEncuentroId: 20 },
        { usuarioId: 7, rol: RolDepartamental.DMIT_INSTRUCTOR },
        [RolDepartamental.DMIT_INSTRUCTOR],
      ),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('una patrulla inexistente (grupo vacío) se detiene', async () => {
    const { servicio } = armar({ grupo: [] });

    const fallo = await capturar(
      servicio.editarPatrulla('lote-x', { puntoEncuentroId: 20 }, AUTOR),
    );

    expect(fallo).toBeInstanceOf(RecursoNoEncontradoError);
  });
});

describe('OperativosService · reemplazar la persona de un operativo de patrulla (2026-09-18)', () => {
  const miembroInstruccion = (): OperativoCompleto =>
    operativoGuardado({
      id: 700,
      identificador: 'INECU-001',
      grupoRegistro: 'lote-1',
      creadoPorRol: RolDepartamental.DMIT_INSTRUCTOR,
      personal: [
        conPersonal(
          100,
          AreaPersonal.INSTRUCCION,
          RolDepartamental.DMIT_INSTRUCTOR,
        ),
      ],
    });

  it('cambia a la persona por otra de la MISMA área, sobre el mismo código', async () => {
    const { servicio, eliminarAsignacion, crearAsignacion } = armar({
      existente: miembroInstruccion(),
      funcionario: { id: 200, area: AreaPersonal.INSTRUCCION },
    });

    await servicio.reemplazarPersonal(
      700,
      200,
      { usuarioId: 7, rol: RolDepartamental.DMIT_INSTRUCTOR },
      [RolDepartamental.DMIT_INSTRUCTOR],
    );

    // Sale la 100, entra la 200 en el MISMO operativo 700 (no se crea uno nuevo).
    expect(eliminarAsignacion).toHaveBeenCalledWith(700, 100, CLIENTE);
    expect(crearAsignacion).toHaveBeenCalledWith(
      expect.objectContaining({
        operativoId: 700,
        funcionarioId: 200,
        asignadoPorRol: RolDepartamental.DMIT_INSTRUCTOR,
      }),
      CLIENTE,
    );
  });

  it('rechaza a una persona de OTRA área (el código cambiaría de significado)', async () => {
    const { servicio, eliminarAsignacion, crearAsignacion } = armar({
      existente: miembroInstruccion(),
      funcionario: { id: 200, area: AreaPersonal.GENERAL },
    });

    const fallo = await capturar(
      servicio.reemplazarPersonal(
        700,
        200,
        { usuarioId: 7, rol: RolDepartamental.DMIT_INSTRUCTOR },
        [RolDepartamental.DMIT_INSTRUCTOR],
      ),
    );

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect(eliminarAsignacion).not.toHaveBeenCalled();
    expect(crearAsignacion).not.toHaveBeenCalled();
  });

  it('rechaza si el operativo tiene más de una persona', async () => {
    const { servicio } = armar({
      existente: operativoGuardado({
        personal: [
          conPersonal(100, AreaPersonal.GENERAL),
          conPersonal(101, AreaPersonal.GENERAL),
        ],
      }),
      funcionario: { id: 200, area: AreaPersonal.GENERAL },
    });

    const fallo = await capturar(servicio.reemplazarPersonal(500, 200, AUTOR));

    expect(fallo).toBeInstanceOf(ValidacionError);
  });
});

describe('OperativosService · retiro de personal (M-15)', () => {
  const conUnaPersona = () =>
    operativoGuardado({
      personal: [conPersonal(100)],
    } as Partial<OperativoCompleto>);

  it('caso 7 del plan · retira y vuelve a derivar las alertas', async () => {
    const { servicio, eliminarAsignacion, recalcular } = armar({
      existente: conUnaPersona(),
    });

    await servicio.retirarPersonal(500, 100, AUTOR);

    expect(eliminarAsignacion).toHaveBeenCalledWith(500, 100, CLIENTE);
    expect(recalcular).toHaveBeenCalledTimes(1);
  });

  it('quien no figura en el operativo produce 404', async () => {
    const { servicio } = armar({ existente: conUnaPersona() });

    await expect(
      servicio.retirarPersonal(500, 999, AUTOR),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('el rol compartido retira lo que él mismo asignó', async () => {
    const { servicio, eliminarAsignacion } = armar({
      existente: operativoGuardado({
        personal: [
          conPersonal(
            100,
            AreaPersonal.INSTRUCCION,
            RolDepartamental.DMIT_INSTRUCTOR,
          ),
        ],
      } as Partial<OperativoCompleto>),
    });

    await servicio.retirarPersonal(500, 100, {
      usuarioId: 3,
      rol: RolDepartamental.DMIT_INSTRUCTOR,
    });

    expect(eliminarAsignacion).toHaveBeenCalled();
  });

  it('el rol compartido NO retira lo que asignó el dueño', async () => {
    const { servicio, eliminarAsignacion } = armar({
      existente: conUnaPersona(),
    });

    const fallo = await capturar(
      servicio.retirarPersonal(500, 100, {
        usuarioId: 3,
        rol: RolDepartamental.DMIT_INSTRUCTOR,
      }),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect(eliminarAsignacion).not.toHaveBeenCalled();
  });

  it('el dueño retira a cualquiera, incluida la persona del rol compartido', async () => {
    const { servicio, eliminarAsignacion } = armar({
      existente: operativoGuardado({
        personal: [
          conPersonal(
            100,
            AreaPersonal.INSTRUCCION,
            RolDepartamental.DMIT_INSTRUCTOR,
          ),
        ],
      } as Partial<OperativoCompleto>),
    });

    await servicio.retirarPersonal(500, 100, AUTOR);

    expect(eliminarAsignacion).toHaveBeenCalled();
  });

  it('deja traza de la baja de la asignación', async () => {
    const { servicio, registrar } = armar({ existente: conUnaPersona() });

    await servicio.retirarPersonal(500, 100, AUTOR);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_asignacion_personal',
        accion: AccionAuditoria.ELIMINAR,
      }),
      CLIENTE,
    );
  });
});

describe('OperativosService · trámite de Inspección de una persona asignada (2026-10-07)', () => {
  const conInspector = () =>
    operativoGuardado({
      personal: [
        {
          ...conPersonal(100),
          funcionario: { ...FUNCIONARIO, cedula: '1700000004' },
          tramiteInspeccion: null,
        },
      ],
    } as Partial<OperativoCompleto>);

  it('con código, lo comprueba contra Inspección y guarda la copia en la asignación', async () => {
    const { servicio, copiasParaGuardar, guardarTramite, registrar } = armar({
      existente: conInspector(),
    });

    await servicio.fijarTramitePersonal(
      500,
      100,
      'DENUNCIA-26-3415',
      AUTOR,
      undefined,
      'token-de-auth',
    );

    expect(copiasParaGuardar).toHaveBeenCalledWith(
      expect.any(String),
      [
        expect.objectContaining({
          funcionarioId: 100,
          cedula: '1700000004',
          codigoTramite: 'DENUNCIA-26-3415',
        }),
      ],
      'token-de-auth',
    );
    expect(guardarTramite).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ codigoTramite: 'DENUNCIA-26-3415' }),
      AUTOR.usuarioId,
      CLIENTE,
    );
    // Queda en la auditoría, dentro de la transacción.
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 't_operativo_tramite_inspeccion' }),
      CLIENTE,
    );
  });

  it('con null, lo quita sin preguntar a Inspección', async () => {
    const { servicio, copiasParaGuardar, quitarTramite, guardarTramite } =
      armar({ existente: conInspector() });

    await servicio.fijarTramitePersonal(500, 100, null, AUTOR);

    expect(copiasParaGuardar).not.toHaveBeenCalled();
    expect(guardarTramite).not.toHaveBeenCalled();
    expect(quitarTramite).toHaveBeenCalledWith(100, CLIENTE);
  });

  it('quien no figura en el operativo produce 404', async () => {
    const { servicio } = armar({ existente: conInspector() });

    await expect(
      servicio.fijarTramitePersonal(500, 999, 'X', AUTOR),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('form 8 por lote · el cambio se aplica a TODAS las copias de esa persona en el registro', async () => {
    const copia = (id: number) =>
      operativoGuardado({
        id,
        grupoRegistro: 'lote-1',
        personal: [
          {
            ...conPersonal(100),
            id: id + 1000,
            funcionario: { ...FUNCIONARIO, cedula: '1700000004' },
            tramiteInspeccion: null,
          },
        ],
      } as Partial<OperativoCompleto>);
    const { servicio, guardarTramite, registrar, copiasParaGuardar } = armar({
      existente: copia(500),
      grupo: [copia(500), copia(501), copia(502)],
    });

    await servicio.fijarTramitePersonal(
      500,
      100,
      'DENUNCIA-26-3415',
      AUTOR,
      undefined,
      'token-de-auth',
    );

    // Una sola comprobación contra Inspección, tres copias guardadas y tres trazas.
    expect(copiasParaGuardar).toHaveBeenCalledTimes(1);
    expect(
      (guardarTramite.mock.calls as unknown[][]).map((llamada) => llamada[0]),
    ).toEqual([1500, 1501, 1502]);
    const trazas = (registrar.mock.calls as unknown[][]).filter(
      (llamada) =>
        (llamada[0] as { entidad: string }).entidad ===
        't_operativo_tramite_inspeccion',
    );
    expect(
      trazas.map(
        (llamada) => (llamada[0] as { operativoId: number }).operativoId,
      ),
    ).toEqual([500, 501, 502]);
  });

  it('form 8 por lote · quitar el trámite también lo quita en todas las copias', async () => {
    const copia = (id: number) =>
      operativoGuardado({
        id,
        grupoRegistro: 'lote-1',
        personal: [
          { ...conPersonal(100), id: id + 1000, tramiteInspeccion: null },
        ],
      } as Partial<OperativoCompleto>);
    const { servicio, quitarTramite } = armar({
      existente: copia(500),
      grupo: [copia(500), copia(501)],
    });

    await servicio.fijarTramitePersonal(500, 100, null, AUTOR);

    expect(
      (quitarTramite.mock.calls as unknown[][]).map((llamada) => llamada[0]),
    ).toEqual([1500, 1501]);
  });

  it('sin grupoRegistro solo se toca ese operativo', async () => {
    const { servicio, guardarTramite } = armar({ existente: conInspector() });

    await servicio.fijarTramitePersonal(500, 100, 'DENUNCIA-26-3415', AUTOR);

    expect(guardarTramite).toHaveBeenCalledTimes(1);
  });

  it('el rol compartido NO cambia el trámite de una persona que asignó el dueño (403)', async () => {
    const { servicio, guardarTramite } = armar({ existente: conInspector() });

    const fallo = await capturar(
      servicio.fijarTramitePersonal(500, 100, 'DENUNCIA-26-3415', {
        usuarioId: 3,
        rol: RolDepartamental.DMIT_INSTRUCTOR,
      }),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect(guardarTramite).not.toHaveBeenCalled();
  });
});

describe('OperativosService · editar el turno de una persona (RN-66, 2026-09-09)', () => {
  // Un operativo con dos personas, cada una con su turno: la envolvente inicial es 08:00–14:00.
  const conDosPersonas = () =>
    operativoGuardado({
      horaInicio: '08:00',
      horaFin: '14:00',
      personal: [
        { ...conPersonal(100), horaInicio: '08:00', horaFin: '12:00' },
        { ...conPersonal(200), horaInicio: '10:00', horaFin: '14:00' },
      ],
    } as Partial<OperativoCompleto>);

  it('D4 · si la ventana cambia y hay transporte asignado, exige confirmar (409)', async () => {
    const { servicio, actualizarTurnoAsignacion } = armar({
      existente: conDosPersonas(),
      transporteAsignado: true,
    });

    const fallo = (await capturar(
      servicio.actualizarTurnoPersonal(
        500,
        100,
        { horaInicio: '06:00', horaFin: '12:00' },
        AUTOR,
      ),
    )) as ReglaNegocioError;

    expect(fallo.code).toBe('CAMBIO_CON_TRANSPORTE');
    expect(actualizarTurnoAsignacion).not.toHaveBeenCalled();
  });

  it('D4 · confirmado, libera el transporte y borra los tramos en la misma transacción', async () => {
    const { servicio, liberarPorCambio } = armar({
      existente: conDosPersonas(),
      transporteAsignado: true,
    });

    await servicio.actualizarTurnoPersonal(
      500,
      100,
      { horaInicio: '06:00', horaFin: '12:00', confirmarLiberacion: true },
      AUTOR,
    );

    expect(liberarPorCambio).toHaveBeenCalledWith(
      500,
      expect.objectContaining({ conTransporte: true }),
      CLIENTE,
    );
  });

  it('D4 · un turno que NO cambia la ventana no toca el transporte', async () => {
    const { servicio, tieneTransporteAsignado, liberarPorCambio } = armar({
      existente: conDosPersonas(),
      transporteAsignado: true,
    });

    // Se reescribe el mismo turno 10:00–14:00: la envolvente sigue en 08:00–14:00.
    await servicio.actualizarTurnoPersonal(
      500,
      200,
      { horaInicio: '10:00', horaFin: '14:00' },
      AUTOR,
    );

    expect(tieneTransporteAsignado).not.toHaveBeenCalled();
    expect(liberarPorCambio).not.toHaveBeenCalled();
  });

  it('cambia el turno de la asignación y re-deriva la ventana del operativo', async () => {
    const {
      servicio,
      actualizarTurnoAsignacion,
      actualizarVentana,
      verificar,
    } = armar({ existente: conDosPersonas() });

    // Se adelanta el inicio de la persona 100 a 06:00: la envolvente pasa a 06:00–14:00.
    await servicio.actualizarTurnoPersonal(
      500,
      100,
      { horaInicio: '06:00', horaFin: '12:00' },
      AUTOR,
    );

    // El turno de la asignación se escribe…
    expect(actualizarTurnoAsignacion).toHaveBeenCalledWith(
      500,
      100,
      '06:00',
      '12:00',
      CLIENTE,
    );
    // …y la ventana del operativo se re-deriva de los turnos (envolvente 06:00–14:00).
    expect(actualizarVentana).toHaveBeenCalledWith(
      500,
      expect.objectContaining({ horaInicio: '06:00', horaFin: '14:00' }),
      expect.anything(),
      CLIENTE,
    );
    // Y se revalidó el descanso/cruce de esa persona con su NUEVO turno.
    expect(verificar).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ horaInicio: '06:00', horaFin: '12:00' }),
    );
  });

  it('quien no figura en el operativo produce 404', async () => {
    const { servicio } = armar({ existente: conDosPersonas() });

    await expect(
      servicio.actualizarTurnoPersonal(
        500,
        999,
        { horaInicio: '06:00', horaFin: '12:00' },
        AUTOR,
      ),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('si la persona no puede cumplir el turno, se rechaza y no se escribe nada', async () => {
    const { servicio, actualizarTurnoAsignacion, actualizarVentana } = armar({
      existente: conDosPersonas(),
      veredictoDescanso: {
        elegible: false,
        codigo: 'SOLAPAMIENTO_HORARIO',
        motivo: 'La persona ya tiene un operativo a esa hora.',
      },
    });

    await expect(
      servicio.actualizarTurnoPersonal(
        500,
        100,
        { horaInicio: '06:00', horaFin: '12:00' },
        AUTOR,
      ),
    ).rejects.toBeInstanceOf(ReglaNegocioError);

    expect(actualizarTurnoAsignacion).not.toHaveBeenCalled();
    expect(actualizarVentana).not.toHaveBeenCalled();
  });

  it('el rol compartido NO edita el turno de lo que asignó el dueño', async () => {
    const { servicio, actualizarTurnoAsignacion } = armar({
      existente: conDosPersonas(),
    });

    const fallo = await capturar(
      servicio.actualizarTurnoPersonal(
        500,
        100,
        { horaInicio: '06:00', horaFin: '12:00' },
        { usuarioId: 3, rol: RolDepartamental.DMIT_INSTRUCTOR },
      ),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect(actualizarTurnoAsignacion).not.toHaveBeenCalled();
  });
});

describe('OperativosService · las alertas se recalculan en cada cambio', () => {
  it('al registrar', async () => {
    const { servicio, recalcular } = armar();

    await servicio.registrar(REGISTRO_VALIDO, AUTOR);

    expect(recalcular).toHaveBeenCalledTimes(1);
  });

  it('caso 8 del plan · al editar el horario', async () => {
    const { servicio, recalcular } = armar({ existente: operativoGuardado() });

    await servicio.editar(500, { version: 1, horaFin: '22:00' }, AUTOR);

    expect(recalcular).toHaveBeenCalledTimes(1);
  });

  it('se recalculan DENTRO de la transacción, con su cliente', async () => {
    const { servicio, recalcular } = armar({ existente: operativoGuardado() });

    await servicio.asignarPersonal(500, { funcionarioId: 100 }, AUTOR);

    expect(recalcular).toHaveBeenCalledWith(expect.anything(), CLIENTE);
  });
});

describe('OperativosService · escritura con varios roles (2026-09-09)', () => {
  // El operativo lo creó DMIP_INSPECCIONES (por defecto). El usuario tiene DMIP Operativos
  // (que la guarda elige primero) e Inspecciones: debe poder editar/retirar, y la traza queda
  // a nombre de Inspecciones —el sombrero con el que es dueño—, no de Operativos.
  const MULTI = {
    usuarioId: 9,
    rol: RolDepartamental.DMIP_OPERATIVOS,
  };
  const ROLES_MULTI = [
    RolDepartamental.DMIP_OPERATIVOS,
    RolDepartamental.DMIP_INSPECCIONES,
  ];

  it('retira un operativo de OTRO de sus roles, y la traza queda a nombre del creador', async () => {
    const { servicio, eliminar, registrar } = armar({
      existente: operativoGuardado(),
    });

    await servicio.retirar(500, 1, MULTI, ROLES_MULTI);

    expect(eliminar).toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_operativo',
        accion: AccionAuditoria.ELIMINAR,
        rol: RolDepartamental.DMIP_INSPECCIONES,
      }),
      CLIENTE,
    );
  });

  it('sin el rol que lo creó, no lo retira', async () => {
    const { servicio, eliminar } = armar({ existente: operativoGuardado() });

    const fallo = await capturar(
      // Solo Operativos: no es dueño del operativo de Inspecciones.
      servicio.retirar(500, 1, MULTI, [RolDepartamental.DMIP_OPERATIVOS]),
    );

    expect(fallo).toBeInstanceOf(AutorizacionError);
    expect(eliminar).not.toHaveBeenCalled();
  });

  it('edita un operativo de otro de sus roles, con la traza a nombre del creador', async () => {
    const { servicio, registrar } = armar({ existente: operativoGuardado() });

    await servicio.editar(
      500,
      { version: 1, horaFin: '13:00' },
      MULTI,
      ROLES_MULTI,
    );

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_operativo',
        accion: AccionAuditoria.ACTUALIZAR,
        rol: RolDepartamental.DMIP_INSPECCIONES,
      }),
      CLIENTE,
    );
  });
});

describe('OperativosService · consulta (PER-02)', () => {
  it('caso 12 del plan · un rol departamental consulta filtrado', async () => {
    const { servicio, listar } = armar();

    await servicio.consultar({ pagina: 1, tamanio: 25 }, [
      RolDepartamental.DMIP_INSPECCIONES,
    ]);

    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({
        visiblesPara: [RolDepartamental.DMIP_INSPECCIONES],
      }),
    );
  });

  it('un usuario con varios roles ve la UNIÓN de lo suyo (2026-09-09)', async () => {
    const { servicio, listar } = armar();

    // Quien tiene DMIP Operativos e Inspecciones ve los formularios de AMBOS: era el defecto
    // por el que el formulario 8 no aparecía si el rol de partida era Operativos.
    await servicio.consultar({ pagina: 1, tamanio: 25 }, [
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DMIP_INSPECCIONES,
    ]);

    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({
        visiblesPara: [
          RolDepartamental.DMIP_OPERATIVOS,
          RolDepartamental.DMIP_INSPECCIONES,
        ],
      }),
    );
  });

  it('la Dirección y la DAF ven la jornada completa', async () => {
    for (const rol of [RolDepartamental.DIRECTOR, RolDepartamental.DAF]) {
      const { servicio, listar } = armar();

      await servicio.consultar({ pagina: 1, tamanio: 25 }, [rol]);

      expect(listar).toHaveBeenCalledWith(
        expect.objectContaining({ visiblesPara: null }),
      );
    }
  });

  it('un rol de lectura total NO amplía lo departamental: con DMIP + Dirección, ve SOLO lo de DMIP (Camino B, 2026-09-10)', async () => {
    // Antes, tener DIRECTOR entre los roles ponía `visiblesPara: null` (veía todo) aunque el
    // usuario actuara como departamento en P-01/P-02. El negocio lo corrigió: un rol de lectura
    // total no expande las pantallas departamentales; ahí se ve lo del rol departamental.
    const { servicio, listar } = armar();

    await servicio.consultar({ pagina: 1, tamanio: 25 }, [
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DIRECTOR,
    ]);

    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({
        visiblesPara: [RolDepartamental.DMIP_OPERATIVOS],
      }),
    );
  });

  it('la Dirección con un rol NO departamental (admin) sigue viendo todo: no hay departamento que acotar', async () => {
    // El «ve todo» se conserva para quien es de lectura total y no tiene ámbito departamental
    // propio. Un administrador no aporta ese ámbito, así que la Dirección sigue viendo la jornada.
    const { servicio, listar } = armar();

    await servicio.consultar({ pagina: 1, tamanio: 25 }, [
      RolDepartamental.DIRECTOR,
      RolDepartamental.ADMINISTRADOR_DMIP,
    ]);

    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({ visiblesPara: null }),
    );
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * CADA DEPARTAMENTO EDITA Y RETIRA LO QUE ÉL CREÓ. 2026-08-25.
   *
   * Hasta hoy bastaba con ser el dueño del formulario, y era equivalente porque el dueño
   * era el único que podía haberlo creado. Con **dos departamentos escribiendo en el
   * mismo formulario** —la patrulla ECU— deja de serlo, y el negocio eligió: cada uno lo
   * suyo, para que no se pisen el trabajo en un cuadro que se arma contra reloj.
   *
   * ES LA PRUEBA QUE SEPARA «VER» DE «TOCAR». La de más abajo comprueba que el otro
   * departamento SÍ ve el operativo; ésta, que no puede cambiarlo. Si algún día alguien
   * unificara las dos comprobaciones, una de las dos caería.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('ni siquiera el responsable del formulario edita lo que registró el otro', async () => {
    /*
      ESTE ES EL CASO QUE SEPARA LOS DOS CRITERIOS, y por eso está escrito así.

      El operativo es del formulario 8, cuyo RESPONSABLE es DMIP Inspecciones, pero lo
      registró el DMIT —el segundo departamento con escritura—. Con el criterio anterior
      —«manda el dueño del formulario»— Inspecciones podría retirarlo; con el nuevo, no.

      Probarlo al revés no demuestra nada: un tercero ajeno lo rechazan los dos criterios
      por igual, y la prueba pasaría aunque el cambio se hubiera revertido.
    */
    const compartido = {
      ...FORMULARIO,
      roles: [
        {
          rol: RolDepartamental.DMIP_INSPECCIONES,
          acceso: 'ESCRITURA',
          cupo: null,
        },
        {
          rol: RolDepartamental.DMIT_INSTRUCTOR,
          acceso: 'ESCRITURA',
          cupo: null,
        },
      ],
    };
    const { servicio } = armar({
      existente: operativoGuardado({
        formulario: compartido,
        creadoPorRol: RolDepartamental.DMIT_INSTRUCTOR,
      } as Partial<OperativoCompleto>),
    });

    const fallo: unknown = await servicio
      .retirar(500, 1, {
        usuarioId: 3,
        rol: RolDepartamental.DMIP_INSPECCIONES,
      })
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(AutorizacionError);
    // El mensaje dice QUIÉN lo registró: sin eso hay que ir a preguntar por teléfono,
    // que es el canal que este sistema existe para reemplazar.
    expect((fallo as AutorizacionError).message).toContain('DMIT_INSTRUCTOR');
  });

  /** Y quien sí lo creó lo retira, aunque no sea el responsable del formulario. */
  it('quien lo registró lo retira, aunque el formulario no sea suyo', async () => {
    const compartido = {
      ...FORMULARIO,
      roles: [
        {
          rol: RolDepartamental.DMIP_INSPECCIONES,
          acceso: 'ESCRITURA',
          cupo: null,
        },
        {
          rol: RolDepartamental.DMIT_INSTRUCTOR,
          acceso: 'ESCRITURA',
          cupo: null,
        },
      ],
    };
    const { servicio, eliminar } = armar({
      existente: operativoGuardado({
        formulario: compartido,
        creadoPorRol: RolDepartamental.DMIT_INSTRUCTOR,
      } as Partial<OperativoCompleto>),
      ordenesEmitidas: 0,
    });

    await servicio.retirar(500, 1, {
      usuarioId: 3,
      rol: RolDepartamental.DMIT_INSTRUCTOR,
    });

    expect(eliminar).toHaveBeenCalled();
  });

  it('un operativo de otro departamento no se puede abrir por su identificador', async () => {
    const { servicio } = armar({ existente: operativoGuardado() });

    await expect(
      servicio.obtener(500, {
        usuarioId: 1,
        rol: RolDepartamental.DMIP_OPERATIVOS,
      }),
    ).rejects.toBeInstanceOf(AutorizacionError);
  });

  it('el rol que APORTA sí puede consultarlo, aunque no editarlo', async () => {
    const { servicio } = armar({
      existente: operativoGuardado({
        formulario: FORMULARIO,
      } as Partial<OperativoCompleto>),
    });

    const operativo = await servicio.obtener(500, {
      usuarioId: 3,
      rol: RolDepartamental.DMIT_INSTRUCTOR,
    });

    expect(operativo.id).toBe(500);
  });
});

describe('OperativosService · conteo por formulario (2026-10-16)', () => {
  const FECHA = new Date(Date.UTC(2026, 9, 17));

  it('devuelve todos los formularios permitidos, con 0 los que no tienen operativos', async () => {
    const { servicio } = armar();

    await expect(
      servicio.contarPorFormulario(FECHA, [RolDepartamental.DMIP_OPERATIVOS]),
    ).resolves.toEqual([
      { formularioId: 1, total: 3 },
      { formularioId: 2, total: 0 },
    ]);
  });

  it('cuenta el día pedido con la misma visibilidad que el listado (PER-02)', async () => {
    const { servicio, contarPorFormulario, obtenerPermitidos } = armar();

    await servicio.contarPorFormulario(FECHA, [
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DIRECTOR,
    ]);

    // Camino B: Dirección encima de un rol departamental no amplía lo que se cuenta.
    expect(contarPorFormulario).toHaveBeenCalledWith({
      desde: FECHA,
      hasta: FECHA,
      visiblesPara: [RolDepartamental.DMIP_OPERATIVOS],
    });
    expect(obtenerPermitidos).toHaveBeenCalledWith([
      RolDepartamental.DMIP_OPERATIVOS,
      RolDepartamental.DIRECTOR,
    ]);
  });

  it('la Dirección «pura» cuenta la jornada entera', async () => {
    const { servicio, contarPorFormulario } = armar();

    await servicio.contarPorFormulario(FECHA, [RolDepartamental.DIRECTOR]);

    expect(contarPorFormulario).toHaveBeenCalledWith(
      expect.objectContaining({ visiblesPara: null }),
    );
  });

  it('una fecha sin cuadro da todo en 0, no un error', async () => {
    const { servicio, contarPorFormulario } = armar();
    contarPorFormulario.mockResolvedValueOnce(new Map());

    await expect(
      servicio.contarPorFormulario(FECHA, [RolDepartamental.DMIP_OPERATIVOS]),
    ).resolves.toEqual([
      { formularioId: 1, total: 0 },
      { formularioId: 2, total: 0 },
    ]);
  });
});

describe('OperativosService · rango y edición por fila (2026-10-13)', () => {
  // 10H00 del 13 de octubre en Quito: el cuadro vigente es el del 14.
  const AHORA = new Date('2026-10-13T15:00:00Z');

  const fila = (
    fecha: string,
    estado: EstadoCuadro = EstadoCuadro.BORRADOR,
    creadoPorRol: RolDepartamental = RolDepartamental.DMIP_OPERATIVOS,
  ): OperativoCompleto =>
    ({
      cuadro: { fecha: new Date(fecha + 'T00:00:00Z'), estado },
      creadoPorRol,
    }) as unknown as OperativoCompleto;

  it('expone la fecha vigente y el máximo por defecto si el parámetro falta', async () => {
    const { servicio } = armar();

    await expect(servicio.parametrosDeRango(AHORA)).resolves.toEqual({
      fechaVigente: '2026-10-14',
      rangoMaxDias: 31,
    });
  });

  it('el cuadro vigente con la ventana abierta admite edición', async () => {
    const { servicio } = armar({ ventanaAbierta: true });

    await expect(
      servicio.admisionDeEdicion(
        [fila('2026-10-14')],
        [RolDepartamental.DMIP_OPERATIVOS],
        AHORA,
      ),
    ).resolves.toEqual([true]);
  });

  it('el cuadro vigente con la ventana cerrada no admite edición', async () => {
    const { servicio } = armar({ ventanaAbierta: false });

    await expect(
      servicio.admisionDeEdicion(
        [fila('2026-10-14')],
        [RolDepartamental.DMIP_OPERATIVOS],
        AHORA,
      ),
    ).resolves.toEqual([false]);
  });

  it('un cuadro pasado o cerrado no admite edición aunque la ventana esté abierta', async () => {
    const { servicio } = armar({ ventanaAbierta: true });

    await expect(
      servicio.admisionDeEdicion(
        [
          fila('2026-10-13'),
          fila('2026-10-14', EstadoCuadro.CERRADO),
          fila('2026-10-14'),
        ],
        [RolDepartamental.DMIP_OPERATIVOS],
        AHORA,
      ),
    ).resolves.toEqual([false, false, true]);
  });

  it('evalúa la ventana una vez por rol y no la evalúa si ninguna fila es del vigente', async () => {
    const { servicio, evaluarVentana } = armar({ ventanaAbierta: true });

    await servicio.admisionDeEdicion(
      [fila('2026-10-14'), fila('2026-10-14'), fila('2026-10-14')],
      [RolDepartamental.DMIP_OPERATIVOS, RolDepartamental.DIRECTOR],
      AHORA,
    );
    expect(evaluarVentana).toHaveBeenCalledTimes(1);

    evaluarVentana.mockClear();
    await servicio.admisionDeEdicion(
      [fila('2026-10-10')],
      [RolDepartamental.DMIP_OPERATIVOS],
      AHORA,
    );
    expect(evaluarVentana).not.toHaveBeenCalled();
  });

  it('trae conductor y placa de toda la página en una sola llamada, en el orden de las filas', async () => {
    const { servicio, transporteDeOperativos } = armar();
    const filas = [{ id: 9 }, { id: 7 }] as unknown as OperativoCompleto[];

    await expect(servicio.transporteDelListado(filas)).resolves.toEqual([
      [],
      [{ conductor: 'PÉREZ JUAN', placa: 'PEA-1234' }],
    ]);
    expect(transporteDeOperativos).toHaveBeenCalledTimes(1);
    expect(transporteDeOperativos).toHaveBeenCalledWith([9, 7]);
  });

  it('pasa el rango al repositorio', async () => {
    const { servicio, listar } = armar();
    const desde = new Date('2026-10-01T00:00:00Z');
    const hasta = new Date('2026-10-14T00:00:00Z');

    await servicio.consultar({ desde, hasta, pagina: 1, tamanio: 25 }, [
      RolDepartamental.DMIP_OPERATIVOS,
    ]);

    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({ desde, hasta }),
    );
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL ADICIONAL DEL DÍA · 2026-08-20
 *
 * Un operativo extraordinario que se dispone POR URGENCIA el mismo día en que se ejecuta,
 * colgando de otro ya registrado. Es la ÚNICA escritura del sistema que se salta la
 * ventana de carga, y por eso lo que se protege aquí es, sobre todo, el perímetro de esa
 * excepción: qué sigue estando prohibido, y que quede constancia de cuándo se usó.
 *
 * NINGUNA DE ESTAS PRUEBAS COMPRUEBA MAQUETADO. Todas comprueban decisiones que, de
 * romperse, no darían ningún error visible: un secuencial que continúa la serie
 * equivocada, una traza sin el veredicto de la ventana, una excepción que se extiende a
 * una escritura que no debía tenerla.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('OperativosService · adicional del día', () => {
  /** Lo que la pantalla envía: un registro sin jornada ni formulario. */
  const ADICIONAL = {
    horaInicio: '14:00',
    horaFin: '18:00',
    zonalesIds: [1],
    puntoEncuentroId: 10,
    tipoControlId: 30,
    institucionesIds: [40],
  };

  const PADRE = () => operativoGuardado({ id: 500 });

  describe('la serie propia', () => {
    /**
     * EL ADICIONAL ENUMERA APARTE. Decisión del negocio: el primero del día es el 001
     * aunque el formulario lleve seis operativos ordinarios. Si el conteo no discriminara,
     * saldría `OCAPMO-007`, un código que sugiere seis adicionales previos que no
     * existieron —y que además iría impreso en una orden de servicio—.
     */
    it('trámite de Inspección · el adicional lo comprueba y lo guarda como el alta (2026-10-07)', async () => {
      const { servicio, copiasParaGuardar, guardarTramite } = armar({
        existente: PADRE(),
      });

      await servicio.registrarAdicional(
        500,
        {
          ...ADICIONAL,
          personal: [
            {
              funcionarioId: 100,
              horaInicio: '14:00',
              horaFin: '18:00',
              tramiteInspeccion: { codigoTramite: 'DENUNCIA-26-3415' },
            },
          ],
        },
        AUTOR,
        undefined,
        'token-de-auth',
      );

      expect(copiasParaGuardar).toHaveBeenCalledWith(
        expect.any(String),
        [expect.objectContaining({ codigoTramite: 'DENUNCIA-26-3415' })],
        'token-de-auth',
      );
      expect(guardarTramite).toHaveBeenCalled();
    });

    it('cuenta solo entre adicionales, no continúa la serie ordinaria', async () => {
      const { servicio, contarDelFormulario, crear } = armar({
        existente: PADRE(),
        conteoInicial: 0,
      });

      await servicio.registrarAdicional(500, ADICIONAL, AUTOR);

      // El tercer argumento es el que separa las dos series.
      expect(contarDelFormulario).toHaveBeenCalledWith(9, 8, true, CLIENTE);
      expect(crear).toHaveBeenCalledWith(
        expect.objectContaining({ secuencial: 1, origenId: 500 }),
        CLIENTE,
      );
    });

    it('pide el identificador con el prefijo de adicional', async () => {
      const { servicio, resolverPrefijo, componer } = armar({
        existente: PADRE(),
      });

      const adicional = await servicio.registrarAdicional(
        500,
        ADICIONAL,
        AUTOR,
      );

      // El 2.º argumento `true` elige la serie de adicionales; `resolverPrefijo` devuelve
      // `AINSP` y `componer` arma el código con el secuencial 1 de esa serie propia.
      expect(resolverPrefijo).toHaveBeenCalledWith(
        expect.objectContaining({ id: 8 }),
        true,
        [],
      );
      expect(componer).toHaveBeenCalledWith('AINSP', 1, JORNADA);
      expect(adicional.identificador).toBe('AINSP-001-05-AGO-2026');
    });

    /**
     * ANTES QUE NADA MÁS. Un formulario sin prefijo de adicional se rechaza sin haber
     * mirado el punto de encuentro ni el personal: si no, el motivo verdadero llegaría al
     * final y los rechazos anteriores habrían sido ruido. Ver §11.1 de la guía.
     */
    it('se detiene si el formulario no contempla adicionales, antes de validar catálogos', async () => {
      const { servicio, crear } = armar({
        existente: PADRE(),
        admiteAdicionales: false,
      });

      await expect(
        servicio.registrarAdicional(
          500,
          { ...ADICIONAL, puntoEncuentroId: 999 },
          AUTOR,
        ),
      ).rejects.toBeInstanceOf(ValidacionError);

      expect(crear).not.toHaveBeenCalled();
    });
  });

  describe('la ventana de carga', () => {
    /** El caso real: se dispone el día de la ejecución, con la carga ya cerrada. */
    it('se crea aunque la ventana esté cerrada', async () => {
      const { servicio, crear } = armar({
        existente: PADRE(),
        ventanaAbierta: false,
      });

      const adicional = await servicio.registrarAdicional(
        500,
        ADICIONAL,
        AUTOR,
      );

      expect(adicional.origenId).toBe(500);
      expect(crear).toHaveBeenCalled();
    });

    /**
     * «AUDITADA» SIGNIFICA ESTO. Sin el veredicto en la traza, un adicional creado a las
     * diez de la mañana —dentro de ventana, sin nada excepcional— quedaría escrito igual
     * que uno creado a las once de la noche, y la pregunta que justifica la excepción
     * —«¿cuántos se crearon fuera de ventana?»— no tendría respuesta.
     */
    it('deja constancia de que la ventana estaba cerrada, y de qué operativo nació', async () => {
      const { servicio, registrar } = armar({
        existente: PADRE(),
        ventanaAbierta: false,
      });

      await servicio.registrarAdicional(500, ADICIONAL, AUTOR);

      const traza = primeraTraza(registrar);

      const asiento = (campo: string) =>
        traza.cambios?.find((cambio) => cambio.campo === campo)?.valorNuevo;

      expect(traza.accion).toBe('CREAR');
      // De qué nació: el IDENTIFICADOR del padre, no su número de fila. Una traza que
      // dijera «500» no permitiría reconstruir nada si esa fila desapareciera.
      expect(asiento('oper_origen_id')).toBe('INSP-001-05-AGO-2026');
      expect(asiento('ventana_carga')).toContain('excepción');
    });

    /** Y distingue: con la ventana abierta la traza NO puede decir que hubo excepción. */
    it('no llama excepción a un adicional creado con la ventana abierta', async () => {
      const { servicio, registrar } = armar({
        existente: PADRE(),
        ventanaAbierta: true,
      });

      await servicio.registrarAdicional(500, ADICIONAL, AUTOR);

      const ventana = primeraTraza(registrar).cambios?.find(
        (cambio) => cambio.campo === 'ventana_carga',
      );

      expect(ventana?.valorNuevo).toBe('abierta al crear el adicional');
      expect(ventana?.valorNuevo).not.toContain('excepción');
    });

    /**
     * EL REGISTRO ORDINARIO NO DEBE ARRASTRAR NADA DE ESTO. Es la prueba que caería si
     * alguien decidiera «unificar» ambos caminos: la traza de un operativo normal no
     * habla de ventanas ni de orígenes, porque su ventana sí lo protegió.
     */
    it('el registro ordinario sigue sin llevar detalle en su traza', async () => {
      const { servicio, registrar } = armar();

      await servicio.registrar(REGISTRO_VALIDO, AUTOR);

      expect(primeraTraza(registrar).cambios).toBeUndefined();
    });
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LA DIRECCIÓN SOBRE UN CUADRO CERRADO · 2026-08-20
   *
   * La operación real es: se arma el cuadro, se consolida la matriz, **se cierra**, y
   * ENTONCES aparece la urgencia. Con el cuadro abierto el adicional casi no hace falta.
   *
   * RN-58 no dice que un cuadro cerrado sea inmutable: dice que no admite modificaciones
   * **sin autorización de la Dirección**. Estas pruebas fijan las dos mitades de esa
   * frase, y la segunda importa tanto como la primera: si el departamento pudiera
   * escribir sobre lo cerrado, la autorización dejaría de existir sin que nada fallara.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  describe('la Dirección y el cuadro cerrado', () => {
    const DIRECCION = { usuarioId: 1, rol: RolDepartamental.DIRECTOR };

    const cerrado = () =>
      operativoGuardado({
        id: 500,
        cuadro: { id: 9, fecha: JORNADA, estado: EstadoCuadro.CERRADO },
      } as Partial<OperativoCompleto>);

    it('la Dirección crea el adicional sobre un cuadro ya cerrado', async () => {
      const { servicio, crear, exigirEscritura } = armar({
        existente: cerrado(),
      });

      const adicional = await servicio.registrarAdicional(
        500,
        ADICIONAL,
        DIRECCION,
      );

      expect(adicional.origenId).toBe(500);
      expect(crear).toHaveBeenCalled();
      // Ni siquiera se pregunta: para la Dirección, RN-58 se satisface con que sea ella.
      expect(exigirEscritura).not.toHaveBeenCalled();
    });

    /**
     * LA OTRA MITAD DE RN-58, y es la que impide que la excepción se extienda sola. Si
     * esto cayera, cualquier departamento podría sumar operativos a un cuadro cerrado y
     * la matriz firmada dejaría de significar nada.
     */
    it('un departamento NO puede, sobre el mismo cuadro cerrado', async () => {
      const cuadroCerrado = new ReglaNegocioError(
        'CUADRO_CERRADO',
        'El cuadro del 2026-08-05 fue cerrado por la Dirección y no admite modificaciones.',
      );
      const { servicio, crear, exigirEscritura } = armar({
        existente: cerrado(),
        escrituraBloqueada: cuadroCerrado,
      });

      await expect(
        servicio.registrarAdicional(500, ADICIONAL, AUTOR),
      ).rejects.toBe(cuadroCerrado);

      expect(exigirEscritura).toHaveBeenCalled();
      expect(crear).not.toHaveBeenCalled();
    });

    /** La Dirección responde por el cuadro entero, no por un formulario. */
    it('la Dirección puede sobre un formulario que no es suyo', async () => {
      const { servicio, crear } = armar({ existente: cerrado() });

      await servicio.registrarAdicional(500, ADICIONAL, DIRECCION);

      expect(crear).toHaveBeenCalled();
    });

    /**
     * LA TRAZA ES LA AUTORIZACIÓN. Sin este asiento, escribir sobre un cuadro cerrado
     * sería indistinguible de escribir sobre uno abierto, y RN-58 quedaría sin evidencia
     * de haberse cumplido.
     */
    it('deja constancia de que se dispuso sobre un cuadro CERRADO', async () => {
      const { servicio, registrar } = armar({ existente: cerrado() });

      await servicio.registrarAdicional(500, ADICIONAL, DIRECCION);

      const asiento = primeraTraza(registrar).cambios?.find(
        (cambio) => cambio.campo === 'estado_cuadro',
      );

      expect(asiento?.valorNuevo).toContain('CERRADO');
      expect(asiento?.valorNuevo).toContain('Dirección');
    });

    /** Con el cuadro abierto la traza no puede insinuar que hubo nada excepcional. */
    it('sobre un cuadro abierto la traza no habla de excepción', async () => {
      const { servicio, registrar } = armar({ existente: PADRE() });

      await servicio.registrarAdicional(500, ADICIONAL, AUTOR);

      const asiento = primeraTraza(registrar).cambios?.find(
        (cambio) => cambio.campo === 'estado_cuadro',
      );

      expect(asiento?.valorNuevo).toBe('APROBADO');
    });

    /** La excepción es de RN-58, no de todo: un adicional sigue sin engendrar adicionales. */
    it('la Dirección tampoco puede encadenar adicionales', async () => {
      const { servicio } = armar({
        existente: operativoGuardado({
          id: 501,
          origenId: 500,
          cuadro: { id: 9, fecha: JORNADA, estado: EstadoCuadro.CERRADO },
        } as Partial<OperativoCompleto>),
      });

      const error = (await capturar(
        servicio.registrarAdicional(501, ADICIONAL, DIRECCION),
      )) as ReglaNegocioError;

      expect(error.code).toBe('ADICIONAL_NO_ENCADENABLE');
    });
  });

  describe('lo que la excepción NO alcanza', () => {
    /**
     * VENTANA Y CUADRO CERRADO SON COSAS DISTINTAS. La primera acota el horario de carga;
     * el segundo dice si la jornada admite cambios. Reabrir el cuadro es potestad de la
     * Dirección y deja su propia traza: es quien debe enterarse de que algo se sale de lo
     * que ya aprobó.
     */
    it('sobre un cuadro cerrado se detiene, aunque la ventana no importe', async () => {
      const cerrado = new ReglaNegocioError(
        'CUADRO_CERRADO',
        'El cuadro del 2026-08-05 fue cerrado por la Dirección y no admite modificaciones.',
      );
      const { servicio, crear } = armar({
        existente: PADRE(),
        escrituraBloqueada: cerrado,
      });

      await expect(
        servicio.registrarAdicional(500, ADICIONAL, AUTOR),
      ).rejects.toBe(cerrado);

      expect(crear).not.toHaveBeenCalled();
    });

    /** La propiedad del formulario se comprueba igual: la excepción es solo horaria. */
    it('un operativo de otro departamento no admite adicionales de este', async () => {
      const { servicio, crear } = armar({ existente: PADRE() });

      await expect(
        servicio.registrarAdicional(500, ADICIONAL, {
          usuarioId: 1,
          rol: RolDepartamental.DMIP_OPERATIVOS,
        }),
      ).rejects.toBeInstanceOf(AutorizacionError);

      expect(crear).not.toHaveBeenCalled();
    });

    /**
     * UN ADICIONAL NO PUEDE TENER ADICIONALES. Encadenarlos convertiría una excepción
     * acotada en una cadena sin fondo: lo que se dispone por urgencia se cuelga de lo
     * planificado, no de otra urgencia.
     */
    it('no se encadena sobre otro adicional, y dice dónde colgarlo', async () => {
      const { servicio, crear } = armar({
        existente: operativoGuardado({ id: 501, origenId: 500 }),
      });

      const error = (await capturar(
        servicio.registrarAdicional(501, ADICIONAL, AUTOR),
      )) as ReglaNegocioError;

      expect(error).toBeInstanceOf(ReglaNegocioError);
      expect(error.code).toBe('ADICIONAL_NO_ENCADENABLE');
      expect(error.message).toContain('operativo original de la jornada');
      expect(crear).not.toHaveBeenCalled();
    });
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * EL ADICIONAL YA NO HEREDA EL TRANSPORTE · 2026-10-14 (decisión D3)
   *
   * Hasta entonces copiaba conductor y vehículo del original al operativo, sin tramos: la
   * agenda del conductor —que desde esa fecha sale SOLO de `t_tramo_transporte`— no lo veía
   * y podía asignársele otra cosa a la misma hora. Ahora nace PENDIENTE y la DAF lo asigna
   * por tramos, y la traza lo dice.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  describe('el transporte del adicional', () => {
    const conTransporte = () =>
      operativoGuardado({
        id: 500,
        conductorId: 77,
        vehiculoId: 88,
        estadoTransporte: 'ASIGNADO',
      } as Partial<OperativoCompleto>);

    /**
     * Herencia por tramos (2026-10-14). El alta crea el operativo sin conductor —la columna no
     * viaja en el `crear`— y DESPUÉS pide a `transporte`, por el puerto, que cree los tramos del
     * adicional ya asignados. Lo que se valida allí se prueba en `planificacion-transporte`.
     */
    it('pide a transporte que el adicional herede del original, después del alta', async () => {
      const { servicio, crear, heredar } = armar({
        existente: conTransporte(),
        herencia: { resultado: { heredado: true, motivo: null } },
      });

      await servicio.registrarAdicional(500, ADICIONAL, AUTOR);

      const datos = (crear.mock.calls[0] as [Record<string, unknown>])[0];
      expect(datos).not.toHaveProperty('transporte');
      expect(heredar).toHaveBeenCalledWith(
        { padreId: 500, adicionalId: expect.any(Number) as number },
        expect.objectContaining({ usuarioId: AUTOR.usuarioId }),
      );
      expect(crear.mock.invocationCallOrder[0]).toBeLessThan(
        heredar.mock.invocationCallOrder[0],
      );
    });

    it('si la herencia falla a mitad, el adicional no se pierde y queda pendiente', async () => {
      const { servicio, crear, warn } = armar({
        existente: conTransporte(),
        herencia: { error: new Error('se cayó la base') },
      });

      await expect(
        servicio.registrarAdicional(500, ADICIONAL, AUTOR),
      ).resolves.toBeDefined();

      expect(crear).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        'El adicional no pudo heredar el transporte',
        expect.objectContaining({ error: 'se cayó la base' }),
      );
    });

    it('con la ventana de carga cerrada hereda igual: la herencia no mira la ventana (regla 9)', async () => {
      const { servicio, heredar } = armar({
        existente: conTransporte(),
        ventanaAbierta: false,
        herencia: { resultado: { heredado: true, motivo: null } },
      });

      await servicio.registrarAdicional(500, ADICIONAL, AUTOR);

      expect(heredar).toHaveBeenCalledTimes(1);
    });

    it('sin transporte cargado (nadie inscrito en el puerto), el adicional nace igual', async () => {
      const { servicio, crear, heredar } = armar({
        existente: conTransporte(),
      });

      await servicio.registrarAdicional(500, ADICIONAL, AUTOR);

      expect(crear).toHaveBeenCalled();
      expect(heredar).not.toHaveBeenCalled();
    });

    it('la traza del alta ya no habla del transporte: la deja la herencia', async () => {
      const { servicio, registrar } = armar({ existente: conTransporte() });

      await servicio.registrarAdicional(500, ADICIONAL, AUTOR);

      const asiento = primeraTraza(registrar).cambios?.find(
        (cambio) => cambio.campo === 'transporte',
      );
      expect(asiento).toBeUndefined();
    });
  });

  describe('la baja del operativo del que nació', () => {
    /**
     * Retirar el original dejaría al adicional colgando de una salida que ya no está en el
     * cuadro, y el adicional describe algo que va a ocurrir hoy. Se rechaza indicando el
     * orden correcto en lugar de resolverlo por nuestra cuenta.
     */
    it('no se retira mientras cuelgue un adicional vigente', async () => {
      const { servicio, eliminar, desactivar } = armar({
        existente: PADRE(),
        adicionales: { activos: 1, total: 1 },
      });

      const error = (await capturar(
        servicio.retirar(500, 1, AUTOR),
      )) as ReglaNegocioError;

      expect(error.code).toBe('OPERATIVO_CON_ADICIONALES');
      expect(error.message).toContain('Retire primero el adicional');
      expect(eliminar).not.toHaveBeenCalled();
      expect(desactivar).not.toHaveBeenCalled();
    });

    /**
     * PERO UN ADICIONAL YA RETIRADO NO LO BLOQUEA PARA SIEMPRE: baja lógica en vez de
     * borrado físico. `fk_operativo_origen` es RESTRICT y esa fila sigue existiendo, así
     * que el `DELETE` fallaría contra la base. Es el mismo criterio de las órdenes ya
     * emitidas, y sin él el original quedaría imposible de retirar.
     */
    it('con un adicional ya retirado, la baja es lógica y no física', async () => {
      const { servicio, eliminar, desactivar } = armar({
        existente: PADRE(),
        adicionales: { activos: 0, total: 1 },
      });

      const resultado = await servicio.retirar(500, 1, AUTOR);

      expect(resultado.eliminado).toBe(false);
      expect(eliminar).not.toHaveBeenCalled();
      expect(desactivar).toHaveBeenCalled();
    });

    /** Sin adicionales y sin órdenes, la baja sigue siendo física. PV-10 intacto. */
    it('sin adicionales, la baja física de PV-10 sigue funcionando igual', async () => {
      const { servicio, eliminar } = armar({ existente: PADRE() });

      const resultado = await servicio.retirar(500, 1, AUTOR);

      expect(resultado.eliminado).toBe(true);
      expect(eliminar).toHaveBeenCalled();
    });
  });
});

async function capturar(promesa: Promise<unknown>): Promise<unknown> {
  return promesa.catch((error: unknown) => error);
}

/**
 * La primera traza que el servicio pidió escribir, ya tipada.
 *
 * `mock.calls` es una matriz de `any`, y leerla en cada prueba obligaba a repetir la
 * aserción de tipo cuatro veces —y a que el linter marcara las cuatro—. Aquí se hace una
 * sola vez, y de paso el nombre dice lo que se está mirando.
 */
function primeraTraza(registrar: jest.Mock): {
  accion?: string;
  cambios?: { campo: string; valorNuevo: string }[];
} {
  const llamadas = registrar.mock.calls as unknown as [
    { accion?: string; cambios?: { campo: string; valorNuevo: string }[] },
  ][];

  return llamadas[0][0];
}

describe('OperativosService · tipo de transporte por defecto del formulario (2026-10-07)', () => {
  const conDefecto = async (
    tipoTransporte: 'COMPLETO' | undefined,
  ): Promise<unknown> => {
    const original = (FORMULARIO as Record<string, unknown>)
      .tipoTransporteDefecto;
    (FORMULARIO as Record<string, unknown>).tipoTransporteDefecto =
      'INICIO_Y_FIN';
    try {
      const { servicio, crear } = armar();
      await servicio.registrar({ ...REGISTRO_VALIDO, tipoTransporte }, AUTOR);
      const [datos] = crear.mock.calls[0] as [{ tipoTransporte?: string }];
      return datos.tipoTransporte;
    } finally {
      (FORMULARIO as Record<string, unknown>).tipoTransporteDefecto = original;
    }
  };

  it('sin tipo indicado, el operativo toma el del formulario (PMO → INICIO_Y_FIN)', async () => {
    expect(await conDefecto(undefined)).toBe('INICIO_Y_FIN');
  });

  it('si el registro lo indica, manda el registro', async () => {
    expect(await conDefecto('COMPLETO')).toBe('COMPLETO');
  });
});

describe('OperativosService · transporte requerido (2026-10-07)', () => {
  it('cambiar el tipo con transporte asignado y SIN confirmar se rechaza (409)', async () => {
    const { servicio, actualizar, liberarPorCambio } = armar({
      existente: operativoGuardado({ conductorId: 3, vehiculoId: 4 }),
      transporteAsignado: true,
    });

    const fallo = await capturar(
      servicio.editar(
        500,
        { version: 1, tipoTransporte: 'SOLO_INICIO' },
        AUTOR,
      ),
    );

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).code).toBe(
      'CAMBIO_TIPO_CON_TRANSPORTE',
    );
    expect(actualizar).not.toHaveBeenCalled();
    expect(liberarPorCambio).not.toHaveBeenCalled();
  });

  it('con la confirmación, libera el transporte en la misma transacción y lo audita', async () => {
    const { servicio, liberarPorCambio, registrar } = armar({
      existente: operativoGuardado({ conductorId: 3, vehiculoId: 4 }),
      transporteAsignado: true,
    });

    await servicio.editar(
      500,
      { version: 1, tipoTransporte: 'SOLO_INICIO', confirmarLiberacion: true },
      AUTOR,
    );

    expect(liberarPorCambio).toHaveBeenCalledWith(
      500,
      { conTransporte: true, marcarLiberado: true },
      CLIENTE,
    );
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 't_operativo', operativoId: 500 }),
      CLIENTE,
    );
  });

  it('a Propios medios no deja alerta de liberado y limpia el macrooperativo', async () => {
    const { servicio, actualizar, liberarPorCambio } = armar({
      existente: operativoGuardado({ esMacrooperativo: true, conductorId: 3 }),
      transporteAsignado: true,
    });
    actualizar.mockResolvedValueOnce(
      operativoGuardado({ tipoTransporte: 'PROPIOS_MEDIOS', conductorId: 3 }),
    );

    await servicio.editar(
      500,
      {
        version: 1,
        tipoTransporte: 'PROPIOS_MEDIOS',
        confirmarLiberacion: true,
      },
      AUTOR,
    );

    expect(actualizar).toHaveBeenCalledWith(
      500,
      1,
      expect.objectContaining({
        tipoTransporte: 'PROPIOS_MEDIOS',
        esMacrooperativo: false,
      }),
      AUTOR,
      CLIENTE,
      [],
    );
    expect(liberarPorCambio).toHaveBeenCalledWith(
      500,
      { conTransporte: true, marcarLiberado: false },
      CLIENTE,
    );
  });

  it('sin transporte asignado no pide confirmar: solo borra los tramos para regenerarlos', async () => {
    const { servicio, liberarPorCambio } = armar({
      existente: operativoGuardado(),
    });

    await servicio.editar(
      500,
      { version: 1, tipoTransporte: 'INICIO_Y_FIN' },
      AUTOR,
    );

    expect(liberarPorCambio).toHaveBeenCalledWith(
      500,
      { conTransporte: false, marcarLiberado: true },
      CLIENTE,
    );
  });

  it('sin cambio de tipo, horario ni zonal no toca el transporte', async () => {
    const { servicio, tieneTransporteAsignado, liberarPorCambio } = armar({
      existente: operativoGuardado({ conductorId: 3, vehiculoId: 4 }),
      transporteAsignado: true,
    });

    await servicio.editar(
      500,
      { version: 1, observacionesNuevas: ['Llevar chalecos.'] },
      AUTOR,
    );

    expect(tieneTransporteAsignado).not.toHaveBeenCalled();
    expect(liberarPorCambio).not.toHaveBeenCalled();
  });

  /**
   * D4 (2026-10-14). Los tramos se cortan con el horario y la zonal del operativo: si cambian, ya
   * no corresponden. Con transporte asignado hay que confirmar (409 CAMBIO_CON_TRANSPORTE); sin
   * él, solo se borran para que transporte los regenere.
   */
  it('D4 · cambiar el horario de un operativo con tramos asignados exige confirmar', async () => {
    const { servicio, actualizar, liberarPorCambio } = armar({
      existente: operativoGuardado({ conductorId: 3, vehiculoId: 4 }),
      transporteAsignado: true,
    });

    const fallo = (await capturar(
      servicio.editar(500, { version: 1, horaFin: '13:00' }, AUTOR),
    )) as ReglaNegocioError;

    expect(fallo.code).toBe('CAMBIO_CON_TRANSPORTE');
    expect(fallo.message).toContain('horario o su zonal');
    expect(actualizar).not.toHaveBeenCalled();
    expect(liberarPorCambio).not.toHaveBeenCalled();
  });

  it('D4 · con la confirmación, el cambio de horario libera el transporte y borra sus tramos', async () => {
    const { servicio, liberarPorCambio } = armar({
      existente: operativoGuardado({ conductorId: 3, vehiculoId: 4 }),
      transporteAsignado: true,
    });

    await servicio.editar(
      500,
      { version: 1, horaFin: '13:00', confirmarLiberacion: true },
      AUTOR,
    );

    expect(liberarPorCambio).toHaveBeenCalledWith(
      500,
      expect.objectContaining({ conTransporte: true }),
      CLIENTE,
    );
  });

  it('D4 · sin transporte asignado, cambiar el horario solo borra los tramos para regenerarlos', async () => {
    const { servicio, liberarPorCambio } = armar({
      existente: operativoGuardado(),
      transporteAsignado: false,
    });

    await servicio.editar(500, { version: 1, horaFin: '13:00' }, AUTOR);

    expect(liberarPorCambio).toHaveBeenCalledWith(
      500,
      expect.objectContaining({ conTransporte: false }),
      CLIENTE,
    );
  });

  it('al registrar con Propios medios, el macrooperativo se limpia', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar(
      {
        ...REGISTRO_VALIDO,
        tipoTransporte: 'PROPIOS_MEDIOS',
        esMacrooperativo: true,
      },
      AUTOR,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoTransporte: 'PROPIOS_MEDIOS',
        esMacrooperativo: false,
      }),
      CLIENTE,
    );
  });

  /*
    SOLO EN COMPLETO (2026-10-19, a pedido del negocio): el vehículo exclusivo solo tiene sentido
    cuando la unidad acompaña todo el operativo. En otro tipo la marca se limpia en silencio.
  */
  it('al registrar con Solo dejar, el macrooperativo se limpia', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar(
      {
        ...REGISTRO_VALIDO,
        tipoTransporte: 'SOLO_INICIO',
        esMacrooperativo: true,
      },
      AUTOR,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoTransporte: 'SOLO_INICIO',
        esMacrooperativo: false,
      }),
      CLIENTE,
    );
  });

  it('al registrar con Completo, el macrooperativo se guarda', async () => {
    const { servicio, crear } = armar();

    await servicio.registrar(
      {
        ...REGISTRO_VALIDO,
        tipoTransporte: 'COMPLETO',
        esMacrooperativo: true,
      },
      AUTOR,
    );

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        tipoTransporte: 'COMPLETO',
        esMacrooperativo: true,
      }),
      CLIENTE,
    );
  });

  it('al editar de Completo a Solo retirar, el macrooperativo se limpia', async () => {
    const { servicio, actualizar } = armar({
      existente: operativoGuardado({
        tipoTransporte: 'COMPLETO',
        esMacrooperativo: true,
      } as Partial<OperativoCompleto>),
    });

    await servicio.editar(
      500,
      { version: 1, tipoTransporte: 'SOLO_FIN' },
      AUTOR,
    );

    // actualizar(id, version, cambios, autor, cliente, notas): los cambios, en el tercero.
    expect(actualizar).toHaveBeenCalledWith(
      500,
      expect.anything(),
      expect.objectContaining({
        tipoTransporte: 'SOLO_FIN',
        esMacrooperativo: false,
      }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('OperativosService · ALV-07 se apaga al reasignar (2026-10-07)', () => {
  it('la DAF vuelve a asignar: se limpia la marca de transporte liberado', async () => {
    const { servicio, limpiarTransporteLiberado } = armar({
      existente: operativoGuardado({
        transporteLiberadoEn: new Date('2026-10-07T10:00:00Z'),
      }),
    });

    await servicio.asignarTransporte(
      500,
      { conductorId: 3, vehiculoId: 4 },
      AUTOR,
    );

    expect(limpiarTransporteLiberado).toHaveBeenCalledWith(500, CLIENTE);
  });

  it('sin marca previa no escribe nada extra', async () => {
    const { servicio, limpiarTransporteLiberado } = armar({
      existente: operativoGuardado(),
    });

    await servicio.asignarTransporte(
      500,
      { conductorId: 3, vehiculoId: 4 },
      AUTOR,
    );

    expect(limpiarTransporteLiberado).not.toHaveBeenCalled();
  });
});

/**
 * COMPARTIR UNIDAD · 2026-10-19 (plan «compartir unidad»). Varios operativos de una persona en el
 * mismo punto y hora chocaban por SOLAPAMIENTO en la DAF; el registro sugiere viajar juntos y deja
 * la INTENCIÓN, que la DAF ejecuta. Aquí se fija lo que decide `operativos`: la visibilidad (RN-48),
 * la coincidencia y lo que se guarda o se retira.
 */
describe('OperativosService · compartir unidad', () => {
  /** Un operativo que podría ser anfitrión: mismo cuadro (9), punto (10) y zonal (1). */
  const anfitrion = (parcial: Record<string, unknown> = {}) => ({
    id: 600,
    identificador: 'INSP-002-05-AGO-2026',
    cuadroId: 9,
    puntoEncuentroId: 10,
    horaInicio: '08:00',
    horaFin: '12:00',
    tipoTransporte: 'SOLO_INICIO',
    esMacrooperativo: false,
    compartirConId: null,
    formulario: { numero: 2 },
    zonales: [{ zonalId: 1 }],
    personal: [
      { funcionario: { apellidos: 'BARRERA TUTASIG', nombres: 'ANGELA' } },
    ],
    ...parcial,
  });

  const FILTRO = {
    fecha: JORNADA,
    puntoEncuentroId: 10,
    zonalId: 1,
    horaInicio: '08:00',
    horaFin: '12:00',
    tipoTransporte: TipoTransporte.SOLO_INICIO,
  };

  describe('coincidencias en tiempo real', () => {
    it('busca con la visibilidad del rol y descarta los horarios que no se cruzan', async () => {
      const { servicio, buscarCoincidencias } = armar({
        compartir: {
          coincidencias: [
            anfitrion(),
            anfitrion({
              id: 601,
              identificador: 'INSP-003-05-AGO-2026',
              horaInicio: '14:00',
              horaFin: '16:00',
            }),
          ],
        },
      });

      const lista = await servicio.coincidenciasTransporte(FILTRO, [
        RolDepartamental.DMIP_INSPECCIONES,
      ]);

      expect(buscarCoincidencias).toHaveBeenCalledWith(
        expect.objectContaining({
          puntoEncuentroId: 10,
          zonalId: 1,
          visiblesPara: [RolDepartamental.DMIP_INSPECCIONES],
        }),
      );
      expect(lista.map((c) => c.identificador)).toEqual([
        'INSP-002-05-AGO-2026',
      ]);
      // Solo el nombre del personal: ni teléfono ni cédula.
      expect(lista[0]).toEqual({
        operativoId: 600,
        identificador: 'INSP-002-05-AGO-2026',
        formularioNumero: 2,
        personal: ['BARRERA TUTASIG ANGELA'],
        horaInicio: '08:00',
        horaFin: '12:00',
        tipoTransporte: 'SOLO_INICIO',
        esMacrooperativo: false,
        compatible: true,
        comparte: [],
        propios: [],
        comparteCon: [],
        // «Completo» (2026-10-20): sin «completo» de por medio, vacíos.
        contiene: [],
        contenidoEn: null,
      });
    });

    it('la unidad es la del GRUPO: con el anfitrión viajan a transporte quienes ya piden ir con él', async () => {
      const evaluar = jest.fn().mockResolvedValue([
        {
          compatible: true,
          comparte: ['retirar'],
          propios: [],
          comparteCon: [{ tipo: 'retirar', con: 'INSP-004-05-AGO-2026' }],
        },
      ]);
      const { servicio } = armar({
        compartir: {
          coincidencias: [anfitrion()],
          miembros: [
            anfitrion({
              id: 602,
              identificador: 'INSP-004-05-AGO-2026',
              tipoTransporte: 'INICIO_Y_FIN',
              compartirConId: 600,
            }),
          ],
          evaluar,
        },
      });

      const [coincidencia] = await servicio.coincidenciasTransporte(
        { ...FILTRO, tipoTransporte: TipoTransporte.SOLO_FIN },
        [RolDepartamental.DMIP_INSPECCIONES],
      );

      const llamadas = evaluar.mock.calls as unknown[][];
      const anfitriones = llamadas[0][1] as {
        identificador: string;
        miembros: { identificador: string }[];
      }[];
      expect(anfitriones[0].identificador).toBe('INSP-002-05-AGO-2026');
      expect(anfitriones[0].miembros.map((m) => m.identificador)).toEqual([
        'INSP-004-05-AGO-2026',
      ]);
      expect(coincidencia.comparteCon).toEqual([
        { tipo: 'retirar', con: 'INSP-004-05-AGO-2026' },
      ]);
    });

    it('quien ya pide viajar con otro se ofrece como ese anfitrión, sin cadenas ni repetidos', async () => {
      const { servicio } = armar({
        compartir: {
          coincidencias: [
            anfitrion(),
            anfitrion({
              id: 601,
              identificador: 'INSP-003-05-AGO-2026',
              compartirConId: 600,
            }),
          ],
        },
      });

      const lista = await servicio.coincidenciasTransporte(FILTRO, [
        RolDepartamental.DMIP_INSPECCIONES,
      ]);

      expect(lista.map((c) => c.operativoId)).toEqual([600]);
    });

    it('ofrece como mucho cinco, los de hora más cercana primero', async () => {
      const { servicio } = armar({
        compartir: {
          coincidencias: [
            '10:00',
            '09:30',
            '09:00',
            '08:30',
            '11:00',
            '08:00',
          ].map((hora, i) =>
            anfitrion({
              id: 700 + i,
              identificador: `INSP-01${i}-05-AGO-2026`,
              horaInicio: hora,
            }),
          ),
        },
      });

      const lista = await servicio.coincidenciasTransporte(FILTRO, [
        RolDepartamental.DMIP_INSPECCIONES,
      ]);

      expect(lista.map((c) => c.horaInicio)).toEqual([
        '08:00',
        '08:30',
        '09:00',
        '09:30',
        '10:00',
      ]);
    });

    it('el veredicto de transporte llega con su motivo', async () => {
      const evaluar = jest
        .fn()
        .mockResolvedValue([
          { compatible: false, motivo: 'No piden el mismo traslado.' },
        ]);
      const { servicio } = armar({
        compartir: { coincidencias: [anfitrion()], evaluar },
      });

      const [coincidencia] = await servicio.coincidenciasTransporte(FILTRO, [
        RolDepartamental.DMIP_INSPECCIONES,
      ]);

      expect(coincidencia).toMatchObject({
        compatible: false,
        motivo: 'No piden el mismo traslado.',
      });
      expect(evaluar).toHaveBeenCalledWith(
        expect.objectContaining({ zonalId: 1, tipoTransporte: 'SOLO_INICIO' }),
        [expect.objectContaining({ horaInicio: '08:00', zonalId: 1 })],
      );
    });
  });

  describe('la intención al registrar', () => {
    const CON_TRANSPORTE: DatosRegistro = {
      ...REGISTRO_VALIDO,
      tipoTransporte: TipoTransporte.SOLO_INICIO,
    };

    it('guarda el anfitrión con el que pide compartir unidad', async () => {
      const { servicio, crear } = armar({
        compartir: { paraCompartir: [anfitrion()] },
      });

      await servicio.registrar(
        { ...CON_TRANSPORTE, compartirConOperativoId: 600 },
        AUTOR,
      );

      expect(crear).toHaveBeenCalledWith(
        expect.objectContaining({
          compartirConId: 600,
          justificacionExclusivo: null,
        }),
        CLIENTE,
      );
    });

    it('un destino fuera de su alcance da 404 sin revelar que existe, y no escribe nada', async () => {
      const { servicio, crear } = armar({ compartir: { paraCompartir: [] } });

      await expect(
        servicio.registrar(
          { ...CON_TRANSPORTE, compartirConOperativoId: 600 },
          AUTOR,
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(crear).not.toHaveBeenCalled();
    });

    it('otro punto de encuentro: 409 COMPARTIR_NO_COMPATIBLE', async () => {
      const { servicio } = armar({
        compartir: { paraCompartir: [anfitrion({ puntoEncuentroId: 20 })] },
      });

      await expect(
        servicio.registrar(
          { ...CON_TRANSPORTE, compartirConOperativoId: 600 },
          AUTOR,
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'COMPARTIR_NO_COMPATIBLE',
      });
    });

    it('si transporte dice que los tramos no van juntos, 409 con su motivo', async () => {
      const evaluar = jest
        .fn()
        .mockResolvedValue([{ compatible: false, motivo: 'Otro sector.' }]);
      const { servicio } = armar({
        compartir: { paraCompartir: [anfitrion()], evaluar },
      });

      await expect(
        servicio.registrar(
          { ...CON_TRANSPORTE, compartirConOperativoId: 600 },
          AUTOR,
        ),
      ).rejects.toThrow(
        'No se puede compartir unidad con INSP-002-05-AGO-2026: Otro sector.',
      );
    });

    it('compartir y vehículo exclusivo se excluyen: 409 COMPARTIR_CON_EXCLUSIVO', async () => {
      const { servicio } = armar({
        compartir: { paraCompartir: [anfitrion()] },
      });

      await expect(
        servicio.registrar(
          {
            ...CON_TRANSPORTE,
            // El macrooperativo solo existe en COMPLETO (2026-10-19).
            tipoTransporte: TipoTransporte.COMPLETO,
            esMacrooperativo: true,
            compartirConOperativoId: 600,
          },
          AUTOR,
        ),
      ).rejects.toMatchObject({ code: 'COMPARTIR_CON_EXCLUSIVO' });
    });

    it('un anfitrión con vehículo exclusivo tampoco comparte', async () => {
      const { servicio } = armar({
        compartir: { paraCompartir: [anfitrion({ esMacrooperativo: true })] },
      });

      await expect(
        servicio.registrar(
          { ...CON_TRANSPORTE, compartirConOperativoId: 600 },
          AUTOR,
        ),
      ).rejects.toMatchObject({ code: 'COMPARTIR_CON_EXCLUSIVO' });
    });

    it('propios medios limpia la intención y no consulta a nadie', async () => {
      const { servicio, crear, buscarParaCompartir } = armar();

      await servicio.registrar(
        {
          ...REGISTRO_VALIDO,
          tipoTransporte: TipoTransporte.PROPIOS_MEDIOS,
          compartirConOperativoId: 600,
          justificacionExclusivo: 'No aplica en propios medios',
        },
        AUTOR,
      );

      expect(buscarParaCompartir).not.toHaveBeenCalled();
      expect(crear).toHaveBeenCalledWith(
        expect.objectContaining({
          compartirConId: null,
          justificacionExclusivo: null,
        }),
        CLIENTE,
      );
    });

    it('la justificación solo se guarda con vehículo exclusivo', async () => {
      const { servicio, enviados } = armar();

      await servicio.registrar(
        {
          ...CON_TRANSPORTE,
          tipoTransporte: TipoTransporte.COMPLETO,
          esMacrooperativo: true,
          justificacionExclusivo: 'Traslado de equipos pesados',
        },
        AUTOR,
      );
      await servicio.registrar(
        {
          ...CON_TRANSPORTE,
          justificacionExclusivo: 'Traslado de equipos pesados',
        },
        AUTOR,
      );

      expect(enviados[0]).toMatchObject({
        esMacrooperativo: true,
        justificacionExclusivo: 'Traslado de equipos pesados',
      });
      expect(enviados[1]).toMatchObject({
        esMacrooperativo: false,
        justificacionExclusivo: null,
      });
    });
  });

  describe('la intención al editar', () => {
    /** Los cambios que llegaron al repositorio en la primera edición. */
    const cambiosEditados = (actualizar: jest.Mock): unknown =>
      (actualizar.mock.calls[0] as unknown[])[2];

    const conIntencion = () =>
      operativoGuardado({
        tipoTransporte: TipoTransporte.SOLO_INICIO,
        compartirConId: 600,
      } as Partial<OperativoCompleto>);

    it('si el cambio de horario deja de coincidir, la retira y avisa COMPARTIR_RETIRADO', async () => {
      const { servicio, actualizar } = armar({
        existente: conIntencion(),
        compartir: { paraCompartir: [anfitrion()] },
      });

      const editado = await servicio.editar(
        500,
        { version: 1, horaInicio: '14:00', horaFin: '18:00' },
        AUTOR,
      );

      expect(editado.avisos).toEqual(['COMPARTIR_RETIRADO']);
      expect(cambiosEditados(actualizar)).toMatchObject({
        compartirConId: null,
      });
    });

    it('si sigue coincidiendo, la conserva y no avisa nada', async () => {
      const { servicio, actualizar } = armar({
        existente: conIntencion(),
        compartir: { paraCompartir: [anfitrion()] },
      });

      const editado = await servicio.editar(
        500,
        { version: 1, horaFin: '11:00' },
        AUTOR,
      );

      expect(editado.avisos).toBeUndefined();
      expect(cambiosEditados(actualizar)).toMatchObject({
        compartirConId: 600,
      });
    });

    it('pedirla ahora con un destino que no coincide es un error, no un aviso', async () => {
      const { servicio } = armar({
        existente: operativoGuardado({
          tipoTransporte: TipoTransporte.SOLO_INICIO,
        } as Partial<OperativoCompleto>),
        compartir: {
          paraCompartir: [anfitrion({ horaInicio: '15:00', horaFin: '18:00' })],
        },
      });

      await expect(
        servicio.editar(
          500,
          { version: 1, compartirConOperativoId: 600 },
          AUTOR,
        ),
      ).rejects.toMatchObject({ code: 'COMPARTIR_NO_COMPATIBLE' });
    });

    it('marcar vehículo exclusivo retira la intención de compartir', async () => {
      const { servicio, actualizar } = armar({ existente: conIntencion() });

      await servicio.editar(
        500,
        {
          version: 1,
          tipoTransporte: TipoTransporte.COMPLETO,
          esMacrooperativo: true,
        },
        AUTOR,
      );

      expect(cambiosEditados(actualizar)).toMatchObject({
        esMacrooperativo: true,
        compartirConId: null,
      });
    });

    it('la intención entra en la traza de auditoría', async () => {
      const { servicio, compararCambios } = armar({
        existente: operativoGuardado({
          tipoTransporte: TipoTransporte.SOLO_INICIO,
        } as Partial<OperativoCompleto>),
        compartir: { paraCompartir: [anfitrion()] },
      });

      await servicio.editar(
        500,
        { version: 1, compartirConOperativoId: 600 },
        AUTOR,
      );

      expect(compararCambios).toHaveBeenLastCalledWith(
        expect.objectContaining({ oper_compartir_con_id: null }),
        expect.objectContaining({ oper_compartir_con_id: 600 }),
      );
    });

    /*
      QUIÉN LA PIDIÓ Y CUÁNDO (2026-10-19, plan «acciones-icono-notas», N2): la tarjeta
      «Comparte con X» de las notas lleva su autor y su hora.
    */
    it('al pedirla, guarda quién edita y cuándo, y entra en la traza', async () => {
      const { servicio, actualizar, compararCambios } = armar({
        existente: operativoGuardado({
          tipoTransporte: TipoTransporte.SOLO_INICIO,
        } as Partial<OperativoCompleto>),
        compartir: { paraCompartir: [anfitrion()] },
      });

      await servicio.editar(
        500,
        { version: 1, compartirConOperativoId: 600 },
        AUTOR,
      );

      expect(cambiosEditados(actualizar)).toMatchObject({
        compartirConId: 600,
        compartirSolicitadoPor: AUTOR.usuarioId,
        compartirSolicitadoEn: expect.any(Date) as unknown,
      });
      expect(compararCambios).toHaveBeenLastCalledWith(
        expect.objectContaining({ oper_compartir_solicitado_por: null }),
        expect.objectContaining({
          oper_compartir_solicitado_por: AUTOR.usuarioId,
        }),
      );
    });

    it('al retirarla, vacía quién la pidió y cuándo', async () => {
      const { servicio, actualizar } = armar({
        existente: operativoGuardado({
          tipoTransporte: TipoTransporte.SOLO_INICIO,
          compartirConId: 600,
          compartirSolicitadoPor: 9,
          compartirSolicitadoEn: new Date('2026-10-19T14:00:00.000Z'),
        } as Partial<OperativoCompleto>),
      });

      await servicio.editar(
        500,
        { version: 1, compartirConOperativoId: null },
        AUTOR,
      );

      expect(cambiosEditados(actualizar)).toMatchObject({
        compartirConId: null,
        compartirSolicitadoPor: null,
        compartirSolicitadoEn: null,
      });
    });

    it('si la conserva, no toca quién la pidió', async () => {
      const { servicio, actualizar } = armar({
        existente: conIntencion(),
        compartir: { paraCompartir: [anfitrion()] },
      });

      await servicio.editar(500, { version: 1, horaFin: '11:00' }, AUTOR);

      expect(cambiosEditados(actualizar)).not.toHaveProperty(
        'compartirSolicitadoPor',
      );
    });
  });
});
