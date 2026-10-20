/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: formularios-admin.service.spec.ts
 * Responsabilidad: Verificar las puertas del alta/edición/baja de formularios.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-29
 *
 * Se prueban DECISIONES: unicidad de número y código, color de la paleta, escritura de los
 * satélites en la transacción, color completo al editar y baja lógica. La transacción se
 * ejercita ejecutando el callback con un cliente falso.
 */

import {
  AreaPersonal,
  PoliticaVehiculo,
  RolDepartamental,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  FormulariosRepository,
  type FormularioCompleto,
} from '../infrastructure/formularios.repository';
import { FormulariosAdminService } from './formularios-admin.service';
import { CrearFormularioDto } from '../presentation/dto/administrar-formularios.dto';

/** Un formulario completo de referencia (con áreas y prefijos), para las lecturas. */
const formularioCompleto = (
  parcial: Partial<FormularioCompleto> = {},
): FormularioCompleto =>
  ({
    id: 99,
    numero: 10,
    codigo: 'OCFIJ',
    nombre: 'Operativos de control fijos',
    colorFondo: '#A2C4C9',
    colorAcento: '#000000',
    colorNombre: 'Verde azulado',
    rolDueno: RolDepartamental.DMIP_OPERATIVOS,
    politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
    condicionanteNoct: false,
    esPatrulla: false,
    capturaLibrePunto: false,
    capturaLibreTipo: false,
    puntoManual: false,
    filtraPersonalPorRol: true,
    tipoControlMultiple: false,
    variosPorPersona: false,
    cantidadPorPersona: false,
    tipoTransporteDefecto: 'COMPLETO',
    orden: 10,
    vigenciaDesde: null,
    vigenciaHasta: null,
    activo: true,
    creadoEn: new Date(),
    areas: [
      { formularioId: 99, area: AreaPersonal.OPERATIVOS, esCompartida: false },
    ],
    prefijos: [
      {
        id: 1,
        formularioId: 99,
        prefijo: 'OCF',
        areaAplica: null,
        esPredeterminado: true,
        esAdicional: false,
      },
    ],
    ...parcial,
  }) as FormularioCompleto;

/** El cuerpo de un alta válida. Color de la paleta y un prefijo; nace sin áreas. */
const NUEVO: CrearFormularioDto = {
  numero: 10,
  codigo: 'OCFIJ',
  nombre: 'Operativos de control fijos',
  colorFondo: '#A2C4C9',
  colorAcento: '#000000',
  colorNombre: 'Verde azulado',
  rolDueno: RolDepartamental.DMIP_OPERATIVOS,
  prefijo: 'OCF',
};

const armar = (
  opciones: {
    usados?: { numero: number; codigo: string }[];
    existente?: FormularioCompleto;
    usos?: number;
    prefijosEnUso?: { formularioId: number; prefijo: string }[];
  } = {},
) => {
  const {
    usados = [],
    existente = formularioCompleto(),
    usos = 0,
    prefijosEnUso = [],
  } = opciones;

  const numerosYCodigosUsados = jest.fn().mockResolvedValue(usados);
  const crearFormulario = jest.fn().mockResolvedValue(existente);
  const igualarAreas = jest.fn().mockResolvedValue(undefined);
  const sincronizarRolDueno = jest.fn().mockResolvedValue(undefined);
  const crearPrefijoGeneral = jest.fn().mockResolvedValue(undefined);
  const actualizarPrefijo = jest.fn().mockResolvedValue(undefined);
  const prefijosEnUsoFn = jest.fn().mockResolvedValue(prefijosEnUso);
  const actualizarFormulario = jest.fn().mockResolvedValue(undefined);
  const buscarPorCodigoIncluidosInactivos = jest
    .fn()
    .mockResolvedValue(existente);
  const contarOperativos = jest.fn().mockResolvedValue(usos);
  const ejecutarEnTransaccion = jest
    .fn()
    .mockImplementation((operacion: (cliente: unknown) => Promise<unknown>) =>
      operacion({}),
    );
  const registrar = jest.fn().mockResolvedValue(undefined);

  const servicio = new FormulariosAdminService(
    {
      numerosYCodigosUsados,
      crearFormulario,
      igualarAreas,
      sincronizarRolDueno,
      crearPrefijoGeneral,
      actualizarPrefijo,
      prefijosEnUso: prefijosEnUsoFn,
      actualizarFormulario,
      buscarPorCodigoIncluidosInactivos,
      contarOperativos,
      ejecutarEnTransaccion,
    } as unknown as FormulariosRepository,
    { registrar } as unknown as AuditoriaService,
    { log: jest.fn() } as unknown as LoggerService,
  );

  return {
    servicio,
    crearFormulario,
    igualarAreas,
    sincronizarRolDueno,
    crearPrefijoGeneral,
    actualizarPrefijo,
    actualizarFormulario,
    registrar,
  };
};

describe('FormulariosAdminService · alta', () => {
  it('rechaza un número ya usado con 409', async () => {
    const { servicio } = armar({ usados: [{ numero: 10, codigo: 'OTRO' }] });

    await expect(servicio.crear(NUEVO, 6)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Ya existe un formulario con el número 10.',
    });
  });

  it('rechaza un código ya usado (sin importar mayúsculas) con 409', async () => {
    const { servicio } = armar({ usados: [{ numero: 99, codigo: 'ocfij' }] });

    await expect(servicio.crear(NUEVO, 6)).rejects.toBeInstanceOf(
      ReglaNegocioError,
    );
  });

  it('rechaza un prefijo que ya usa otro formulario', async () => {
    const { servicio, crearFormulario } = armar({
      prefijosEnUso: [{ formularioId: 3, prefijo: 'ocf' }],
    });

    await expect(servicio.crear(NUEVO, 6)).rejects.toMatchObject({
      statusCode: 409,
      message:
        'El prefijo OCF ya lo usa otro formulario: los identificadores se confundirían.',
    });
    expect(crearFormulario).not.toHaveBeenCalled();
  });

  it('guarda el nombre en MAYÚSCULAS y el prefijo normalizado', async () => {
    const { servicio, crearFormulario, crearPrefijoGeneral } = armar();

    await servicio.crear(
      { ...NUEVO, nombre: ' control  fijo ', prefijo: ' ocf ' },
      6,
    );

    expect(crearFormulario).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'CONTROL FIJO' }),
      expect.anything(),
    );
    expect(crearPrefijoGeneral).toHaveBeenCalledWith(
      99,
      'OCF',
      expect.anything(),
    );
  });

  it('rechaza un color que no está en la paleta', async () => {
    const { servicio } = armar();

    await expect(
      servicio.crear(
        { ...NUEVO, colorFondo: '#123456', colorNombre: 'Inventado' },
        6,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('crea el formulario SIN áreas, con su rol dueño y su prefijo', async () => {
    const {
      servicio,
      crearFormulario,
      igualarAreas,
      sincronizarRolDueno,
      crearPrefijoGeneral,
      registrar,
    } = armar();

    await servicio.crear(NUEVO, 6);

    expect(crearFormulario).toHaveBeenCalled();
    expect(igualarAreas).not.toHaveBeenCalled();
    expect(sincronizarRolDueno).toHaveBeenCalled();
    expect(crearPrefijoGeneral).toHaveBeenCalled();
    expect(registrar).toHaveBeenCalled();
  });

  it('sugiere el número libre más bajo', async () => {
    const { servicio } = armar({
      usados: [
        { numero: 1, codigo: 'A' },
        { numero: 2, codigo: 'B' },
        { numero: 4, codigo: 'C' },
      ],
    });

    await expect(servicio.numeroLibre()).resolves.toBe(3);
  });
});

describe('FormulariosAdminService · prefijo al editar (2026-10-13)', () => {
  /** Como el formulario 8: numera solo por área, sin prefijo general. */
  const POR_AREA = formularioCompleto({
    prefijos: [
      {
        id: 84,
        formularioId: 99,
        prefijo: 'IG',
        areaAplica: AreaPersonal.GENERAL,
        esPredeterminado: false,
        esAdicional: false,
      },
      {
        id: 85,
        formularioId: 99,
        prefijo: 'IT',
        areaAplica: AreaPersonal.TECNICO,
        esPredeterminado: false,
        esAdicional: false,
      },
    ],
  });

  it('guardar con el mismo prefijo no toca la tabla de prefijos', async () => {
    const { servicio, actualizarPrefijo, registrar } = armar();

    await servicio.actualizar('OCFIJ', { prefijo: 'ocf' }, 6);

    expect(actualizarPrefijo).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('un prefijo nuevo actualiza la fila general por su id y queda en la traza', async () => {
    const { servicio, actualizarPrefijo, registrar } = armar();

    await servicio.actualizar('OCFIJ', { prefijo: 'OCX' }, 6);

    expect(actualizarPrefijo).toHaveBeenCalledWith(1, 'OCX', expect.anything());
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        cambios: [
          { campo: 'fpre_prefijo', valorAnterior: 'OCF', valorNuevo: 'OCX' },
        ],
      }),
      expect.anything(),
    );
  });

  it('rechaza con 409 un prefijo que ya usa otro formulario', async () => {
    const { servicio, actualizarPrefijo } = armar({
      prefijosEnUso: [
        { formularioId: 99, prefijo: 'OCF' },
        { formularioId: 3, prefijo: 'OCL' },
      ],
    });

    await expect(
      servicio.actualizar('OCFIJ', { prefijo: 'OCL' }, 6),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(actualizarPrefijo).not.toHaveBeenCalled();
  });

  it('un formulario que numera por área rechaza un prefijo distinto y acepta el mostrado', async () => {
    const { servicio, actualizarPrefijo } = armar({ existente: POR_AREA });

    await expect(
      servicio.actualizar('OCFIJ', { prefijo: 'XX' }, 6),
    ).rejects.toBeInstanceOf(ValidacionError);
    await servicio.actualizar('OCFIJ', { prefijo: 'IG' }, 6);
    expect(actualizarPrefijo).not.toHaveBeenCalled();
  });

  it('guarda el nombre editado en MAYÚSCULAS', async () => {
    const { servicio, actualizarFormulario } = armar();

    await servicio.actualizar(
      'OCFIJ',
      { nombre: 'operativos de control fijos' },
      6,
    );

    expect(actualizarFormulario).toHaveBeenCalledWith(
      99,
      { nombre: 'OPERATIVOS DE CONTROL FIJOS' },
      expect.anything(),
    );
  });
});

describe('FormulariosAdminService · edición y baja', () => {
  it('al cambiar el color exige los tres campos juntos', async () => {
    const { servicio } = armar();

    await expect(
      servicio.actualizar('OCFIJ', { colorFondo: '#A2C4C9' }, 6),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('da de baja poniendo activo en false y conserva el histórico', async () => {
    const { servicio, actualizarFormulario } = armar({ usos: 3 });

    const resultado = await servicio.darDeBaja('OCFIJ', 6);

    expect(actualizarFormulario).toHaveBeenCalledWith(
      99,
      { activo: false },
      expect.anything(),
    );
    expect(resultado.usosHistoricos).toBe(3);
  });
});

describe('FormulariosAdminService · tipo de transporte por defecto (2026-10-07)', () => {
  it('se edita y queda en la traza', async () => {
    const { servicio, actualizarFormulario } = armar();

    await servicio.actualizar(
      'OCFIJ',
      { tipoTransportePorDefecto: 'INICIO_Y_FIN' },
      6,
    );

    expect(actualizarFormulario).toHaveBeenCalledWith(
      99,
      { tipoTransporteDefecto: 'INICIO_Y_FIN' },
      expect.anything(),
    );
  });
});

describe('FormulariosAdminService · transporte requerido (2026-10-07)', () => {
  it('un formulario nuevo sin defecto explícito sugiere PROPIOS_MEDIOS', async () => {
    const { servicio, crearFormulario } = armar();

    await servicio.crear(NUEVO, 6);

    expect(crearFormulario).toHaveBeenCalledWith(
      expect.objectContaining({ tipoTransporteDefecto: 'PROPIOS_MEDIOS' }),
      expect.anything(),
    );
  });

  it('respeta el defecto que configura el administrador', async () => {
    const { servicio, crearFormulario } = armar();

    await servicio.crear({ ...NUEVO, tipoTransportePorDefecto: 'COMPLETO' }, 6);

    expect(crearFormulario).toHaveBeenCalledWith(
      expect.objectContaining({ tipoTransporteDefecto: 'COMPLETO' }),
      expect.anything(),
    );
  });
});
