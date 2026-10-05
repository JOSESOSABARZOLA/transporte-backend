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
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  FormulariosRepository,
  type FormularioCompleto,
} from '../infrastructure/formularios.repository';
import { AreasFormularioService } from './areas-formulario.service';
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

/** El cuerpo de un alta válida. Color de la paleta, un área, un prefijo. */
const NUEVO: CrearFormularioDto = {
  numero: 10,
  codigo: 'OCFIJ',
  nombre: 'Operativos de control fijos',
  colorFondo: '#A2C4C9',
  colorAcento: '#000000',
  colorNombre: 'Verde azulado',
  rolDueno: RolDepartamental.DMIP_OPERATIVOS,
  prefijo: 'OCF',
  areas: [AreaPersonal.OPERATIVOS],
};

const armar = (
  opciones: {
    usados?: { numero: number; codigo: string }[];
    existente?: FormularioCompleto;
    usos?: number;
  } = {},
) => {
  const { usados = [], existente = formularioCompleto(), usos = 0 } = opciones;

  const numerosYCodigosUsados = jest.fn().mockResolvedValue(usados);
  const crearFormulario = jest.fn().mockResolvedValue(existente);
  const igualarAreas = jest.fn().mockResolvedValue(undefined);
  const sincronizarRolDueno = jest.fn().mockResolvedValue(undefined);
  const fijarPrefijoPredeterminado = jest.fn().mockResolvedValue(undefined);
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
  const reemplazar = jest.fn().mockResolvedValue(undefined);

  const servicio = new FormulariosAdminService(
    {
      numerosYCodigosUsados,
      crearFormulario,
      igualarAreas,
      sincronizarRolDueno,
      fijarPrefijoPredeterminado,
      actualizarFormulario,
      buscarPorCodigoIncluidosInactivos,
      contarOperativos,
      ejecutarEnTransaccion,
    } as unknown as FormulariosRepository,
    { reemplazar } as unknown as AreasFormularioService,
    { registrar } as unknown as AuditoriaService,
    { log: jest.fn() } as unknown as LoggerService,
  );

  return {
    servicio,
    crearFormulario,
    igualarAreas,
    sincronizarRolDueno,
    fijarPrefijoPredeterminado,
    actualizarFormulario,
    reemplazar,
    registrar,
  };
};

describe('FormulariosAdminService · alta', () => {
  it('rechaza un número ya usado', async () => {
    const { servicio } = armar({ usados: [{ numero: 10, codigo: 'OTRO' }] });

    await expect(servicio.crear(NUEVO, 6)).rejects.toBeInstanceOf(
      ValidacionError,
    );
  });

  it('rechaza un código ya usado (sin importar mayúsculas)', async () => {
    const { servicio } = armar({ usados: [{ numero: 99, codigo: 'ocfij' }] });

    await expect(servicio.crear(NUEVO, 6)).rejects.toBeInstanceOf(
      ValidacionError,
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

  it('crea el formulario con sus áreas, su rol dueño y su prefijo', async () => {
    const {
      servicio,
      crearFormulario,
      igualarAreas,
      sincronizarRolDueno,
      fijarPrefijoPredeterminado,
      registrar,
    } = armar();

    await servicio.crear(NUEVO, 6);

    expect(crearFormulario).toHaveBeenCalled();
    expect(igualarAreas).toHaveBeenCalled();
    expect(sincronizarRolDueno).toHaveBeenCalled();
    expect(fijarPrefijoPredeterminado).toHaveBeenCalled();
    expect(registrar).toHaveBeenCalled();
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
