/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Jornada del día (P-13)
 * Archivo: jornada.service.spec.ts
 * Responsabilidad: Verificar qué secciones llegan editables y cuáles de solo lectura.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-26
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LO QUE ESTE ARCHIVO PROTEGE ES UNA FRONTERA, NO UN MAQUETADO.
 *
 * P-13 le muestra al DMIT los nueve formularios y le deja tocar el personal **solo en
 * aquellos donde su rol tiene fila en `t_formulario_rol`**. Si el marcado de secciones se
 * rompiera, la pantalla ofrecería botones que el servidor rechaza con 403 —molesto pero
 * inocuo— o, al revés, escondería los que sí puede usar.
 *
 * LA PRUEBA QUE DE VERDAD DISCRIMINA es «el rol decide, no el formulario»: compone la
 * misma jornada dos veces con roles distintos y exige que el marcado cambie. Sin ella, un
 * `acceso` devuelto siempre igual pasaría todas las demás.
 *
 * Y CONVIENE NO CONFUNDIRSE SOBRE EL ALCANCE: esto decide qué se pinta. Quien autoriza la
 * escritura es `exigirParticipacion` en `operativos.service.ts`, y tiene sus propias
 * pruebas. Falsear lo de aquí no da acceso a nada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { AreaPersonal, EstadoCuadro, RolDepartamental } from '@prisma/client';

import { RecursoNoEncontradoError } from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type { VentanaCargaService } from '../../configuracion/application/ventana-carga.service';
import type { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import type {
  FormularioDeJornada,
  JornadaRepository,
  OperativoDeJornada,
} from '../infrastructure/jornada.repository';
import { JornadaController } from '../presentation/jornada.controller';
import { aJornadaResponse } from '../presentation/dto/jornada.dto';
import { JornadaService, type SeccionJornada } from './jornada.service';

const JORNADA = new Date(Date.UTC(2026, 7, 26));

const CUADRO = {
  id: 9,
  fecha: JORNADA,
  ordenTrabajo: 'AMC-2026-AGO-26',
  nroSemana: 35,
  anioSemana: 2026,
  estado: EstadoCuadro.APROBADO,
};

/**
 * Un formulario con las filas de `t_formulario_rol` y `t_formulario_area` que se le den.
 *
 * Las áreas por omisión son `[]`, y eso hace que las pruebas de acceso —que no hablan de
 * personal— no tengan que declarar lo que no miran.
 */
const formulario = (
  numero: number,
  nombre: string,
  roles: {
    rol: RolDepartamental;
    acceso: 'ESCRITURA' | 'APORTA';
    /**
     * Si ese rol asigna personal DESDE P-13. Por omisión **no**, que es la postura de la
     * columna en la base: participar en un formulario no concede este camino.
     */
    editaDesdeJornada?: boolean;
  }[],
  areas: { area: AreaPersonal; esCompartida: boolean }[] = [],
): FormularioDeJornada =>
  ({
    id: numero,
    numero,
    codigo: `F${numero}`,
    nombre,
    colorFondo: '#EEEEEE',
    colorAcento: '#000000',
    colorNombre: 'gris',
    rolDueno: roles[0]?.rol ?? RolDepartamental.DMIP_OPERATIVOS,
    esPatrulla: false,
    orden: numero,
    activo: true,
    roles: roles.map((fila) => ({
      rol: fila.rol,
      acceso: fila.acceso,
      cupo: fila.acceso === 'APORTA' ? 1 : null,
      editaDesdeJornada: fila.editaDesdeJornada ?? false,
    })),
    areas,
  }) as unknown as FormularioDeJornada;

const operativo = (
  id: number,
  formularioId: number,
  personal: AreaPersonal[] = [],
): OperativoDeJornada =>
  ({
    id,
    formularioId,
    identificador: `OP-00${id}`,
    secuencial: id,
    origenId: null,
    origen: null,
    horaInicio: '08:00',
    horaFin: '12:00',
    esNocturno: false,
    estadoTransporte: 'PENDIENTE',
    observaciones: [],
    puntoLibre: null,
    tipoLibre: null,
    alertas: [],
    zonales: [],
    instituciones: [],
    personal: personal.map((area, indice) => ({
      funcionarioId: indice + 1,
      esResponsable: indice === 0,
      asignadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
      funcionario: { area },
    })),
    conductor: null,
    vehiculo: null,
    puntoEncuentro: null,
    tipoControl: null,
  }) as unknown as OperativoDeJornada;

/**
 * Los cuatro formularios en los que el DMIT participa hoy, y uno en el que no.
 *
 * `editaDesdeJornada` reproduce la siembra del 2026-09-01: la lleva el departamento que
 * aporta en algún formulario, y en **todas** sus filas, no solo en las de aporte. Es lo
 * que hace que P-13 siga siendo su pantalla del día y no lo sea del resto.
 */
const ECU = formulario(4, 'PATRULLA ECU DIURNA', [
  { rol: RolDepartamental.DMIP_OPERATIVOS, acceso: 'ESCRITURA' },
  {
    rol: RolDepartamental.DMIT_INSTRUCTOR,
    acceso: 'ESCRITURA',
    editaDesdeJornada: true,
  },
]);

const REACN = formulario(6, 'PATRULLA REACCIÓN NOCTURNA', [
  { rol: RolDepartamental.DMIP_INSPECCIONES, acceso: 'ESCRITURA' },
  {
    rol: RolDepartamental.DMIT_INSTRUCTOR,
    acceso: 'APORTA',
    editaDesdeJornada: true,
  },
]);

const FIJOS = formulario(1, 'OPERATIVOS DE CONTROL FIJOS', [
  { rol: RolDepartamental.DMIP_OPERATIVOS, acceso: 'ESCRITURA' },
]);

const armar = (
  opciones: {
    formularios?: FormularioDeJornada[];
    operativos?: OperativoDeJornada[];
    ventana?: { activo: boolean; abierta: boolean; horaCierre: string | null };
    sinCuadro?: Error;
  } = {},
) => {
  const {
    formularios = [FIJOS, ECU, REACN],
    operativos = [],
    ventana = { activo: true, abierta: true, horaCierre: '15:00' },
    sinCuadro,
  } = opciones;

  const listarFormularios = jest.fn().mockResolvedValue(formularios);
  const listarOperativos = jest.fn().mockResolvedValue(operativos);
  const obtenerEstado = jest.fn().mockResolvedValue(ventana);
  const obtenerPorFecha = jest
    .fn()
    .mockImplementation(() =>
      sinCuadro ? Promise.reject(sinCuadro) : Promise.resolve(CUADRO),
    );
  const log = jest.fn();

  const servicio = new JornadaService(
    { listarFormularios, listarOperativos } as unknown as JornadaRepository,
    { obtenerPorFecha } as unknown as CuadroDiarioService,
    { obtenerEstado } as unknown as VentanaCargaService,
    { log } as unknown as LoggerService,
  );

  return { servicio, listarFormularios, listarOperativos, obtenerEstado, log };
};

const accesoPorNumero = (
  secciones: { formulario: { numero: number }; acceso: string }[],
) =>
  Object.fromEntries(
    secciones.map((seccion) => [seccion.formulario.numero, seccion.acceso]),
  );

describe('JornadaService · qué puede tocar quien consulta', () => {
  it('donde el rol registra, la sección llega como ESCRITURA', async () => {
    const { servicio } = armar();

    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);

    expect(accesoPorNumero(jornada.secciones)[4]).toBe('ESCRITURA');
  });

  it('donde solo aporta personal, llega como APORTA y no como ESCRITURA', async () => {
    // No se funden en un booleano: el cupo existe únicamente en `APORTA`, y el servidor
    // lo aplica al asignar. Perder la distinción perdería el motivo del rechazo.
    const { servicio } = armar();

    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);

    expect(accesoPorNumero(jornada.secciones)[6]).toBe('APORTA');
  });

  it('un formulario que el rol solo lee ya NO aparece en la jornada (2026-09-15)', async () => {
    const { servicio } = armar();

    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);

    // form 1 (FIJOS) es de OPERATIVOS; el DMIT no participa, así que su sección no viaja.
    expect(accesoPorNumero(jornada.secciones)[1]).toBeUndefined();
  });

  /**
   * ES LA PRUEBA QUE DISCRIMINA. Las anteriores pasarían si la jornada trajera siempre lo
   * mismo; esta exige que qué formularios aparecen dependa de **quién pregunta**.
   */
  it('el rol decide qué formularios ve: la misma jornada trae secciones distintas', async () => {
    const { servicio } = armar();

    const paraDmit = await servicio.componer(JORNADA, [
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);
    const paraOperativos = await servicio.componer(JORNADA, [
      RolDepartamental.DMIP_OPERATIVOS,
    ]);

    // form 1: OPERATIVOS lo escribe (aparece); el DMIT no participa (ausente).
    expect(accesoPorNumero(paraOperativos.secciones)[1]).toBe('ESCRITURA');
    expect(accesoPorNumero(paraDmit.secciones)[1]).toBeUndefined();

    // form 6: el DMIT aporta (aparece); OPERATIVOS no participa (ausente).
    expect(accesoPorNumero(paraDmit.secciones)[6]).toBe('APORTA');
    expect(accesoPorNumero(paraOperativos.secciones)[6]).toBeUndefined();
  });

  it('con VARIOS roles, el acceso de cada sección es el MÁS FUERTE de todos (unión, 2026-09-14)', async () => {
    // Un usuario con todos sus roles. Antes se usaba uno solo y veía «No se publica» en los
    // formularios que escriben sus OTROS roles; ahora el acceso es la unión, como P-01/P-02.
    const { servicio } = armar();

    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIT_INSTRUCTOR,
      RolDepartamental.DMIP_OPERATIVOS,
    ]);
    const acceso = accesoPorNumero(jornada.secciones);

    // form 1: el DMIT solo lee, pero OPERATIVOS escribe → ESCRITURA (antes salía LECTURA).
    expect(acceso[1]).toBe('ESCRITURA');
    // form 6: el DMIT aporta y OPERATIVOS lee → gana APORTA.
    expect(acceso[6]).toBe('APORTA');
    // form 4: el DMIT escribe → ESCRITURA.
    expect(acceso[4]).toBe('ESCRITURA');
  });

  it('los formularios ajenos ya NO se entregan (2026-09-15): ni la sección ni sus totales', async () => {
    // Giro respecto de 2026-08-26: el rol ya no ve el volumen ajeno. La sección del formulario
    // que solo leería no viaja, y sus operativos no cuentan en los totales.
    const { servicio } = armar({ operativos: [operativo(11, 1)] });

    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);
    const ajena = jornada.secciones.find(
      (seccion) => seccion.formulario.numero === 1,
    );

    expect(ajena).toBeUndefined();
    expect(jornada.totales.operativos).toBe(0);
  });

  it('nombra a los dos departamentos que responden por la ECU', async () => {
    const { servicio } = armar();

    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);
    const ecu = jornada.secciones.find(
      (seccion) => seccion.formulario.numero === 4,
    );

    expect(ecu?.responsable).toContain('+');
  });

  it('RN-53 · el formulario vacío con la ventana vencida lleva su evidencia', async () => {
    const { servicio } = armar({
      formularios: [FIJOS],
      ventana: { activo: true, abierta: false, horaCierre: '15:00' },
    });

    // El rol debe PARTICIPAR en el formulario para verlo (2026-09-15); FIJOS es de OPERATIVOS.
    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIP_OPERATIVOS,
    ]);

    expect(jornada.secciones[0].evidencia).not.toBeNull();
    expect(jornada.totales.formulariosSinCarga).toBe(1);
  });

  it('una fecha sin jornada abierta no devuelve una jornada vacía', async () => {
    const { servicio } = armar({
      sinCuadro: new RecursoNoEncontradoError('No hay cuadro para esa fecha.'),
    });

    await expect(
      servicio.componer(JORNADA, [RolDepartamental.DMIT_INSTRUCTOR]),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LO QUE HACE QUE P-13 AVISE SIN QUE EXISTA UN SUBSISTEMA DE NOTIFICACIONES.
 *
 * El encargo era: cuando DMIP Operativos registra un operativo de la ECU, el DMIT debe
 * enterarse de que le toca poner a su gente. En vez de una campana, la propia jornada lo
 * dice, y lo dice **por operativo**.
 *
 * LA TRAMPA ESTÁ EN CONFUNDIR LAS ÁREAS DEL FORMULARIO CON LAS DEL ROL, y por eso los
 * fixtures de aquí llevan la configuración real: la 6 · Patrulla Reacción Nocturna admite
 * tres áreas y el DMIT solo pone una. Contar las tres le pediría gente que el servidor le
 * rechazaría al asignar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('JornadaService · qué personal se espera de quien consulta', () => {
  /** 4 · ECU: DMIP registra, el DMIT aporta Instrucción. Configuración del 2026-08-27. */
  const ECU_APORTE = formulario(
    4,
    'PATRULLA ECU DIURNA',
    [
      { rol: RolDepartamental.DMIP_OPERATIVOS, acceso: 'ESCRITURA' },
      { rol: RolDepartamental.DMIT_INSTRUCTOR, acceso: 'APORTA' },
    ],
    [
      { area: AreaPersonal.OPERATIVOS, esCompartida: false },
      { area: AreaPersonal.INSTRUCCION, esCompartida: true },
    ],
  );

  /** 6 · REACN: tres áreas admitidas, y el DMIT solo aporta la tercera. */
  const REACN_TRES_AREAS = formulario(
    6,
    'PATRULLA REACCIÓN NOCTURNA',
    [
      { rol: RolDepartamental.DMIP_INSPECCIONES, acceso: 'ESCRITURA' },
      { rol: RolDepartamental.DMIT_INSTRUCTOR, acceso: 'APORTA' },
    ],
    [
      { area: AreaPersonal.GENERAL, esCompartida: false },
      { area: AreaPersonal.TECNICO, esCompartida: false },
      { area: AreaPersonal.INSTRUCCION, esCompartida: true },
    ],
  );

  /** 1 · FIJOS: el DMIT no participa. */
  const FIJOS_AJENO = formulario(
    1,
    'OPERATIVOS DE CONTROL FIJOS',
    [{ rol: RolDepartamental.DMIP_OPERATIVOS, acceso: 'ESCRITURA' }],
    [{ area: AreaPersonal.OPERATIVOS, esCompartida: false }],
  );

  const jornadaDelDmit = async (
    formularios: FormularioDeJornada[],
    operativos: OperativoDeJornada[],
  ) => {
    const { servicio } = armar({ formularios, operativos });

    return aJornadaResponse(
      await servicio.componer(JORNADA, [RolDepartamental.DMIT_INSTRUCTOR]),
    );
  };

  const pendientesDe = (
    respuesta: Awaited<ReturnType<typeof jornadaDelDmit>>,
    numero: number,
  ) =>
    respuesta.secciones.find((seccion) => seccion.numero === numero)?.filas[0]
      ?.areasPendientesDelRol;

  it('el operativo que DMIP registró sin el DMIT lo reclama por su nombre', async () => {
    // Es el caso del encargo. DMIP puso a su gente de Operativos; falta la de Instrucción.
    const respuesta = await jornadaDelDmit(
      [ECU_APORTE],
      [operativo(1, 4, [AreaPersonal.OPERATIVOS])],
    );

    expect(pendientesDe(respuesta, 4)).toEqual([AreaPersonal.INSTRUCCION]);
  });

  it('en cuanto el DMIT asigna a su gente, deja de reclamarlo', async () => {
    const respuesta = await jornadaDelDmit(
      [ECU_APORTE],
      [operativo(1, 4, [AreaPersonal.OPERATIVOS, AreaPersonal.INSTRUCCION])],
    );

    expect(pendientesDe(respuesta, 4)).toEqual([]);
  });

  /**
   * ES LA PRUEBA QUE DISCRIMINA, y la que cae si alguien devuelve las áreas del
   * formulario en lugar de las del rol. El operativo no tiene a nadie: le faltan las
   * tres. Al DMIT solo le toca una.
   */
  it('de un operativo vacío solo reclama su parte, no la del otro departamento', async () => {
    const respuesta = await jornadaDelDmit(
      [REACN_TRES_AREAS],
      [operativo(1, 6)],
    );

    expect(pendientesDe(respuesta, 6)).toEqual([AreaPersonal.INSTRUCCION]);
  });

  it('un formulario ajeno ya no aparece: no está para reclamar nada (2026-09-15)', async () => {
    // Giro respecto de 2026-08-26: el rol ya no ve la sección ajena, así que no hay dónde
    // reclamarle —ni dejar de reclamarle— nada.
    const respuesta = await jornadaDelDmit([FIJOS_AJENO], [operativo(1, 1)]);

    expect(
      respuesta.secciones.find((seccion) => seccion.numero === 1),
    ).toBeUndefined();
  });

  /**
   * UN FORMULARIO DE APORTE SIN ÁREA COMPARTIDA NO RECLAMA NADA, Y ES CORRECTO.
   *
   * Sin esa fila el servidor rechaza cada asignación de ese rol con «participa con
   * personal de: ninguna área». Anunciarle trabajo pendiente sería mandarlo a una puerta
   * cerrada, y ya ocurrió una vez: es la lección de la migración del 25-AGO.
   */
  it('sin área compartida no se le pide nada al que solo aporta', async () => {
    const sinCompartir = formulario(
      4,
      'PATRULLA ECU DIURNA',
      [
        { rol: RolDepartamental.DMIP_OPERATIVOS, acceso: 'ESCRITURA' },
        { rol: RolDepartamental.DMIT_INSTRUCTOR, acceso: 'APORTA' },
      ],
      [
        { area: AreaPersonal.OPERATIVOS, esCompartida: false },
        { area: AreaPersonal.INSTRUCCION, esCompartida: false },
      ],
    );

    const respuesta = await jornadaDelDmit([sinCompartir], [operativo(1, 4)]);

    expect(pendientesDe(respuesta, 4)).toEqual([]);
  });

  it('donde registra, se le reclaman todas las áreas del formulario', async () => {
    // `ESCRITURA` es el otro extremo: ahí el operativo es suyo entero.
    const propio = formulario(
      7,
      'OPERATIVO DMIT',
      [{ rol: RolDepartamental.DMIT_INSTRUCTOR, acceso: 'ESCRITURA' }],
      [
        { area: AreaPersonal.INSTRUCCION, esCompartida: false },
        { area: AreaPersonal.OPERATIVOS, esCompartida: false },
      ],
    );

    const respuesta = await jornadaDelDmit(
      [propio],
      [operativo(1, 7, [AreaPersonal.INSTRUCCION])],
    );

    expect(pendientesDe(respuesta, 7)).toEqual([AreaPersonal.OPERATIVOS]);
  });
});

describe('JornadaService · lo que la respuesta NO lleva', () => {
  it('sin indicador de flota: el DMIT no asigna transporte', async () => {
    const { servicio } = armar();

    const respuesta = aJornadaResponse(
      await servicio.componer(JORNADA, [RolDepartamental.DMIT_INSTRUCTOR]),
    );

    expect(respuesta.cabecera).not.toHaveProperty('flota');
  });

  it('sin admiteAdicionales: disponer adicionales es de la Dirección', async () => {
    const { servicio } = armar();

    const respuesta = aJornadaResponse(
      await servicio.componer(JORNADA, [RolDepartamental.DMIT_INSTRUCTOR]),
    );

    expect(respuesta.secciones[0]).not.toHaveProperty('admiteAdicionales');
  });

  /**
   * EL PDF ES DE LA DIRECCIÓN (RN-44 y RN-47): es el artefacto que circulaba por WhatsApp.
   * Que el DMIT vea la jornada en pantalla se decidió; que pueda llevársela en un archivo
   * firmable, no. Esta prueba cae si alguien copia la ruta de exportación de la matriz.
   */
  it('el controlador no expone ninguna exportación ni ningún cierre', () => {
    const metodos = Object.getOwnPropertyNames(
      JornadaController.prototype,
    ).filter((nombre) => nombre !== 'constructor');

    expect(metodos).toEqual(['consultar']);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA SECCIÓN AJENA NO VIAJA. 2026-09-15 (antes: viajaba sin el personal, 2026-09-01).
 *
 * El rol ve la jornada SOLO de los formularios que escribe o aporta; el resto ni siquiera
 * aparece. Es la parte del cambio que protege el requisito que originó el encargo —el cuadro
 * circulaba por WhatsApp—: sin estas pruebas, un filtro mal escrito devolvería secciones
 * ajenas a quien no debe verlas, y no fallaría nada visible.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('JornadaService · la sección ajena no viaja', () => {
  const personalDe = (secciones: SeccionJornada[], numero: number): number =>
    secciones
      .filter((seccion) => seccion.formulario.numero === numero)
      .flatMap((seccion) => seccion.operativos)
      .flatMap((operativo) => operativo.personal).length;

  it('la sección donde el rol escribe conserva su personal', async () => {
    const { servicio } = armar({
      operativos: [operativo(11, 1, [AreaPersonal.OPERATIVOS])],
    });

    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIP_OPERATIVOS,
    ]);

    expect(accesoPorNumero(jornada.secciones)[1]).toBe('ESCRITURA');
    expect(personalDe(jornada.secciones, 1)).toBeGreaterThan(0);
  });

  /**
   * ES LA QUE DISCRIMINA. La anterior pasaría con un filtro que no filtrara nada; esta exige
   * que la sección del formulario ajeno NO aparezca —y con ella, su personal—.
   */
  it('y la sección que el rol solo leería ya no aparece (2026-09-15)', async () => {
    const { servicio } = armar({
      operativos: [operativo(11, 1, [AreaPersonal.OPERATIVOS])],
    });

    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);

    // form 1 (FIJOS) es de OPERATIVOS; el DMIT no participa → ni la sección ni su personal.
    expect(accesoPorNumero(jornada.secciones)[1]).toBeUndefined();
    expect(personalDe(jornada.secciones, 1)).toBe(0);
  });

  /**
   * ALCANZA TAMBIÉN AL DMIT, y es deliberado. El 27-AGO se le añadió el teléfono del
   * personal ajeno «para que no viera una columna vacía en las secciones ajenas»; al
   * abrir la jornada a los tres, esa columna vacía pasó a ser justamente lo que se
   * quiere. La regla es una y no depende de qué rol pregunta.
   */
  it('el mismo operativo se entrega con personal a uno y sin él a otro', async () => {
    const { servicio } = armar({
      operativos: [operativo(11, 1, [AreaPersonal.OPERATIVOS])],
    });

    const paraDueno = await servicio.componer(JORNADA, [
      RolDepartamental.DMIP_OPERATIVOS,
    ]);
    const paraAjeno = await servicio.componer(JORNADA, [
      RolDepartamental.DMIP_INSPECCIONES,
    ]);

    expect(personalDe(paraDueno.secciones, 1)).toBeGreaterThan(0);
    expect(personalDe(paraAjeno.secciones, 1)).toBe(0);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * QUIÉN PUEDE ASIGNAR PERSONAL DESDE ESTA PANTALLA. 2026-09-01.
 *
 * EL DEFECTO QUE CIERRAN. P-13 se abrió esa mañana a los tres departamentos con la
 * decisión «solo en lectura y sin el personal ajeno». Se implementó el recorte del
 * personal y no la lectura: la pantalla ofrecía la acción donde `acceso <> LECTURA`, así
 * que los dos roles nuevos podían asignar desde aquí sobre sus propios formularios.
 *
 * LO QUE FIJAN ES QUE LAS DOS PREGUNTAS SON DISTINTAS. Un rol con ESCRITURA que no tenga
 * la columna mira y no toca; uno con APORTA que la tenga, toca. Si algún día alguien
 * volviera a derivar esto de `acceso`, la primera prueba de aquí caería.
 *
 * Y NINGUNA NOMBRA UN ROL PARA DECIDIR: describen filas de `t_formulario_rol`. El rol
 * aparece solo como sujeto de la consulta, que es lo que la petición lleva de verdad.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('JornadaService · quién asigna personal desde la jornada', () => {
  const puedePorNumero = (secciones: SeccionJornada[]) =>
    Object.fromEntries(
      secciones.map((seccion) => [
        seccion.formulario.numero,
        seccion.puedeEditarPersonal,
      ]),
    );

  it('con ESCRITURA pero sin la columna, la sección llega sin la acción', async () => {
    const { servicio } = armar();

    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIP_OPERATIVOS,
    ]);

    // Registra el 1 y el 4, y en los dos tiene sus propias pantallas para hacerlo.
    expect(accesoPorNumero(jornada.secciones)[1]).toBe('ESCRITURA');
    expect(puedePorNumero(jornada.secciones)[1]).toBe(false);
    expect(puedePorNumero(jornada.secciones)[4]).toBe(false);
  });

  it('con la columna, llega con la acción tanto donde escribe como donde aporta', async () => {
    const { servicio } = armar();

    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);

    expect(accesoPorNumero(jornada.secciones)[4]).toBe('ESCRITURA');
    expect(puedePorNumero(jornada.secciones)[4]).toBe(true);

    expect(accesoPorNumero(jornada.secciones)[6]).toBe('APORTA');
    expect(puedePorNumero(jornada.secciones)[6]).toBe(true);
  });

  /**
   * Sin fila no hay ni sección ni acción: la tabla es la única fuente. Desde 2026-09-15 el
   * formulario ajeno ni siquiera aparece, así que la acción no existe por partida doble.
   */
  it('donde el rol no participa, no hay sección (ni acción) que ofrecer', async () => {
    const { servicio } = armar();

    const jornada = await servicio.componer(JORNADA, [
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);

    expect(accesoPorNumero(jornada.secciones)[1]).toBeUndefined();
    expect(puedePorNumero(jornada.secciones)[1]).toBeUndefined();
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PROPIOS MEDIOS SE DICE CON PALABRAS (RN-41 y RN-42). 2026-09-21.
 *
 * Un formulario `NO_APLICA` no lleva conductor ni placa por definición. La celda quedaba en
 * blanco —indistinguible de «aún no asignado»—; ahora dice «Propios medios» / «No se activa»,
 * como en P-02. Solo cuando de verdad no hay conductor/placa asignados.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('JornadaService · propios medios (NO_APLICA)', () => {
  const FIJOS_PROPIOS = {
    ...formulario(1, 'OPERATIVOS DE CONTROL FIJOS', [
      { rol: RolDepartamental.DMIP_OPERATIVOS, acceso: 'ESCRITURA' },
    ]),
    politicaVehiculo: 'NO_APLICA',
  } as unknown as FormularioDeJornada;

  it('el conductor y la placa lo dicen con palabras, no dejan la celda en blanco', async () => {
    const { servicio } = armar({
      formularios: [FIJOS_PROPIOS],
      operativos: [operativo(1, 1, [AreaPersonal.OPERATIVOS])],
    });

    const respuesta = aJornadaResponse(
      await servicio.componer(JORNADA, [RolDepartamental.DMIP_OPERATIVOS]),
    );
    const fila = respuesta.secciones.find((seccion) => seccion.numero === 1)
      ?.filas[0];

    expect(fila?.conductor).toBe('Propios medios');
    expect(fila?.placa).toBe('No se activa');
  });
});
