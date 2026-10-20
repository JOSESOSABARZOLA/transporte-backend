/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Matriz consolidada
 * Archivo: matriz-consolidada.service.spec.ts
 * Responsabilidad: Verificar la composición, la evidencia y el conteo de consultas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import {
  EstadoCuadro,
  PoliticaVehiculo,
  RolDepartamental,
} from '@prisma/client';

import { RecursoNoEncontradoError } from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type { VentanaCargaService } from '../../configuracion/application/ventana-carga.service';
import type { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import type { CapacidadFlotaService } from '../../transporte/application/capacidad-flota.service';
import type {
  FormularioDeMatriz,
  MatrizRepository,
  OperativoDeMatriz,
} from '../infrastructure/matriz.repository';
import { aMatrizResponse } from '../presentation/dto/matriz.dto';
import { MatrizConsolidadaService } from './matriz-consolidada.service';

const JORNADA = new Date(Date.UTC(2026, 6, 31));

const CUADRO = {
  id: 9,
  fecha: JORNADA,
  ordenTrabajo: 'AMC-2026-JUL-31',
  nroSemana: 31,
  anioSemana: 2026,
  estado: EstadoCuadro.APROBADO,
};

const formulario = (
  numero: number,
  nombre: string,
  rolDueno: RolDepartamental = RolDepartamental.DMIP_OPERATIVOS,
  rolCompartido: RolDepartamental | null = null,
): FormularioDeMatriz =>
  ({
    id: numero,
    numero,
    codigo: `F${numero}`,
    nombre,
    colorFondo: '#EEEEEE',
    colorAcento: '#000000',
    colorNombre: 'gris',
    rolDueno,
    // Desde el 2026-08-25 la cabecera de sección nombra a TODOS los que participan, y
    // eso son filas. El acompañante aporta personal, que es el caso del formulario 6.
    roles: [
      { rol: rolDueno, acceso: 'ESCRITURA', cupo: null },
      ...(rolCompartido
        ? [{ rol: rolCompartido, acceso: 'APORTA', cupo: 1 }]
        : []),
    ],
    esPatrulla: false,
    politicaVehiculo: PoliticaVehiculo.REQUERIDO,
    orden: numero,
    areas: [],
  }) as unknown as FormularioDeMatriz;

const operativo = (
  id: number,
  formularioId: number,
  alertas: { codigo: string }[] = [],
): OperativoDeMatriz =>
  ({
    id,
    formularioId,
    identificador: `OP-00${id}`,
    secuencial: id,
    horaInicio: '08:00',
    horaFin: '12:00',
    esNocturno: false,
    estadoTransporte: 'PENDIENTE',
    observaciones: [],
    puntoLibre: null,
    tipoLibre: null,
    alertas,
    zonales: [],
    instituciones: [],
    personal: [],
    conductor: null,
    vehiculo: null,
    puntoEncuentro: null,
    tipoControl: null,
  }) as unknown as OperativoDeMatriz;

const armar = (
  opciones: {
    formularios?: FormularioDeMatriz[];
    operativos?: OperativoDeMatriz[];
    ventana?: { activo: boolean; abierta: boolean; horaCierre: string | null };
    flota?: {
      declarados: number;
      requeridos: number;
      hayAdvertencia: boolean;
    } | null;
    sinCuadro?: Error;
  } = {},
) => {
  const {
    formularios = [formulario(1, 'OPERATIVOS FIJOS')],
    operativos = [],
    ventana = { activo: true, abierta: false, horaCierre: '15:00' },
    flota = { declarados: 15, requeridos: 18, hayAdvertencia: true },
    sinCuadro,
  } = opciones;

  const listarFormularios = jest.fn().mockResolvedValue(formularios);
  const listarOperativos = jest.fn().mockResolvedValue(operativos);
  const obtenerEstado = jest.fn().mockResolvedValue(ventana);
  const verificarDemanda = jest.fn().mockResolvedValue({
    fecha: JORNADA,
    declarada: flota ? {} : null,
    vehiculosRequeridos: flota?.requeridos ?? 0,
    veredicto: flota
      ? {
          vehiculos: {
            declarados: flota.declarados,
            requeridos: flota.requeridos,
            excedente: flota.declarados - flota.requeridos,
            suficiente: !flota.hayAdvertencia,
          },
          conductores: {
            declarados: flota.declarados,
            requeridos: flota.requeridos,
            excedente: 0,
            suficiente: true,
          },
          hayAdvertencia: flota.hayAdvertencia,
          advertencia: flota.hayAdvertencia ? 'faltan vehículos' : null,
        }
      : null,
  });
  const obtenerPorFecha = jest
    .fn()
    .mockImplementation(() =>
      sinCuadro ? Promise.reject(sinCuadro) : Promise.resolve(CUADRO),
    );
  const log = jest.fn();

  const servicio = new MatrizConsolidadaService(
    {
      listarFormularios,
      listarOperativos,
      buscarCuadro: jest.fn().mockResolvedValue(CUADRO),
    } as unknown as MatrizRepository,
    { obtenerPorFecha } as unknown as CuadroDiarioService,
    { obtenerEstado } as unknown as VentanaCargaService,
    { verificarDemanda } as unknown as CapacidadFlotaService,
    { log } as unknown as LoggerService,
  );

  return {
    servicio,
    listarFormularios,
    listarOperativos,
    obtenerEstado,
    verificarDemanda,
    log,
  };
};

describe('MatrizConsolidadaService · composición', () => {
  it('caso 1 del plan · agrupa los formularios en secciones, con sus colores', async () => {
    const { servicio } = armar({
      formularios: [formulario(1, 'OPERATIVOS FIJOS'), formulario(2, 'PMO')],
      operativos: [operativo(10, 1), operativo(11, 1), operativo(12, 2)],
    });

    const matriz = await servicio.componer(JORNADA);

    expect(matriz.secciones).toHaveLength(2);
    expect(matriz.secciones[0].operativos).toHaveLength(2);
    expect(matriz.secciones[1].operativos).toHaveLength(1);
    expect(matriz.secciones[0].formulario.colorFondo).toBe('#EEEEEE');
  });

  it('la cabecera trae la fecha en lenguaje natural y los totales', async () => {
    const { servicio } = armar({
      operativos: [
        operativo(10, 1, [{ codigo: 'ALV-01' }, { codigo: 'ALV-02' }]),
        operativo(11, 1, [{ codigo: 'ALV-03' }]),
      ],
    });

    const matriz = await servicio.componer(JORNADA);

    expect(matriz.fechaNatural).toBe('viernes 31 de julio de 2026');
    expect(matriz.totales.operativos).toBe(2);
    expect(matriz.totales.alertas).toBe(3);
  });

  it('nombra al rol compartido junto al dueño', async () => {
    const { servicio } = armar({
      formularios: [
        formulario(
          6,
          'PATRULLA NOCTURNA',
          RolDepartamental.DMIP_INSPECCIONES,
          RolDepartamental.DMIT_INSTRUCTOR,
        ),
      ],
      operativos: [operativo(10, 6)],
    });

    const matriz = await servicio.componer(JORNADA);

    expect(matriz.secciones[0].responsable).toContain('Inspecciones');
    expect(matriz.secciones[0].responsable).toContain('Instrucción');
  });

  it('incorpora el indicador de flota de M-18', async () => {
    const { servicio } = armar();

    const matriz = await servicio.componer(JORNADA);

    expect(matriz.flota).toEqual({
      declarados: 15,
      requeridos: 18,
      hayAdvertencia: true,
    });
  });

  it('sin capacidad declarada, el indicador queda en nulo', async () => {
    const { servicio } = armar({ flota: null });

    expect((await servicio.componer(JORNADA)).flota).toBeNull();
  });

  it('una fecha sin jornada abierta produce 404: no es una matriz vacía', async () => {
    const sinJornada = new RecursoNoEncontradoError('no hay cuadro', {});
    const { servicio, listarOperativos } = armar({ sinCuadro: sinJornada });

    await expect(servicio.componer(JORNADA)).rejects.toBe(sinJornada);
    expect(listarOperativos).not.toHaveBeenCalled();
  });
});

describe('MatrizConsolidadaService · fila de evidencia (RN-53 y RN-54)', () => {
  it('caso 4 del plan · formulario sin carga y ventana vencida', async () => {
    const { servicio } = armar({
      formularios: [
        formulario(7, 'OPERATIVO DMIT', RolDepartamental.DMIT_INSTRUCTOR),
      ],
      ventana: { activo: true, abierta: false, horaCierre: '15:00' },
    });

    const matriz = await servicio.componer(JORNADA);
    const evidencia = matriz.secciones[0].evidencia;

    expect(evidencia?.leyenda).toContain('no fue ingresada');
    expect(evidencia?.responsable).toBe('DMIT · Instrucción');
    expect(evidencia?.horaCierre).toBe('15H00');
    expect(matriz.totales.formulariosSinCarga).toBe(1);
  });

  it('caso 5 del plan · formulario sin carga y ventana ABIERTA, sin evidencia', async () => {
    const { servicio } = armar({
      ventana: { activo: true, abierta: true, horaCierre: '15:00' },
    });

    const matriz = await servicio.componer(JORNADA);

    expect(matriz.secciones[0].evidencia).toBeNull();
    expect(matriz.totales.formulariosSinCarga).toBe(0);
  });

  it('con operativos cargados no se consulta siquiera la ventana', async () => {
    const { servicio, obtenerEstado } = armar({
      operativos: [operativo(10, 1)],
    });

    await servicio.componer(JORNADA);

    // Preguntar por los nueve cuando ocho tienen carga sería trabajo que nadie mira.
    expect(obtenerEstado).not.toHaveBeenCalled();
  });
});

describe('MatrizConsolidadaService · caso 7 · el número de consultas', () => {
  it('compone la matriz con TRES lecturas, sin una por fila', async () => {
    const { servicio, listarFormularios, listarOperativos, verificarDemanda } =
      armar({
        formularios: [
          formulario(1, 'UNO'),
          formulario(2, 'DOS'),
          formulario(3, 'TRES'),
        ],
        operativos: [
          operativo(10, 1),
          operativo(11, 1),
          operativo(12, 2),
          operativo(13, 3),
          operativo(14, 3),
        ],
      });

    await servicio.componer(JORNADA);

    expect(listarFormularios).toHaveBeenCalledTimes(1);
    expect(listarOperativos).toHaveBeenCalledTimes(1);
    expect(verificarDemanda).toHaveBeenCalledTimes(1);
  });

  it('el número de lecturas no crece con los operativos', async () => {
    const muchos = Array.from({ length: 50 }, (_, indice) =>
      operativo(indice + 1, 1),
    );
    const { servicio, listarOperativos } = armar({ operativos: muchos });

    await servicio.componer(JORNADA);

    expect(listarOperativos).toHaveBeenCalledTimes(1);
  });

  it('registra la duración de la composición, para que la regresión se note', async () => {
    const { servicio, log } = armar();

    await servicio.componer(JORNADA);

    expect(log).toHaveBeenCalledWith(
      'Matriz consolidada compuesta',
      expect.objectContaining({ duracionMs: expect.any(Number) as number }),
    );
  });
});

describe('MatrizConsolidadaService · exportación', () => {
  it('caso 8 del plan · devuelve un PDF con nombre por fecha', async () => {
    const { servicio } = armar({
      formularios: [formulario(1, 'UNO'), formulario(2, 'DOS')],
      operativos: [operativo(10, 1)],
    });

    const documento = await servicio.exportar(JORNADA);

    expect(documento.nombre).toBe('matriz-2026-07-31.pdf');
    // `%PDF` es la firma del formato: el documento es real, no un texto con extensión.
    expect(documento.contenido.subarray(0, 4).toString()).toBe('%PDF');
    expect(documento.contenido.byteLength).toBeGreaterThan(1000);
  });

  it('exporta también una jornada sin operativos, con sus evidencias', async () => {
    const { servicio } = armar({
      formularios: [formulario(1, 'UNO'), formulario(7, 'SIETE')],
    });

    const documento = await servicio.exportar(JORNADA);

    expect(documento.contenido.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('una jornada de cincuenta operativos produce varias páginas sin fallar', async () => {
    const muchos = Array.from({ length: 50 }, (_, indice) =>
      operativo(indice + 1, 1),
    );
    const { servicio } = armar({ operativos: muchos });

    const documento = await servicio.exportar(JORNADA);

    expect(documento.contenido.byteLength).toBeGreaterThan(2000);
  });
});

/*
  NOTAS EN LA MATRIZ (2026-10-19, plan «notas-jornada-matriz»). La Dirección ve el día entero: la
  COMPARTIDA va siempre completa, con su identificador y el operativo al que lleva.
*/
describe('MatrizConsolidadaService · notas de la celda Observaciones', () => {
  it('cada fila trae sus notas con autor, la COMPARTIDA completa y la más reciente primero', async () => {
    // Lo que la fila de pantalla lee además de lo que prueba este caso.
    const deFila = (base: OperativoDeMatriz) =>
      ({
        ...base,
        formulario: { politicaVehiculo: PoliticaVehiculo.REQUERIDO },
        tiposControl: [],
      }) as unknown as OperativoDeMatriz;
    const conNotas = {
      ...deFila(operativo(2, 1)),
      creadoPor: 14,
      creadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
      creadoEn: new Date('2026-07-31T13:00:00.000Z'),
      compartirCon: { id: 1, identificador: 'OP-001' },
      compartirSolicitadoPor: null,
      compartirSolicitadoEn: null,
      observaciones: [
        {
          id: 5,
          texto: 'Pruebas tecnicas 3',
          creadoPor: 99,
          creadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
          creadoEn: new Date('2026-07-31T13:40:00.000Z'),
        },
      ],
      autores: { 14: 'Persona Que Registra' },
    } as unknown as OperativoDeMatriz;
    const { servicio } = armar({
      formularios: [
        {
          ...formulario(1, 'OPERATIVOS FIJOS'),
          prefijos: [],
        } as unknown as FormularioDeMatriz,
      ],
      operativos: [deFila(operativo(1, 1)), conNotas],
    });

    const respuesta = aMatrizResponse(await servicio.componer(JORNADA));
    const fila = respuesta.secciones[0].filas.find((una) => una.id === 2);

    expect(
      fila?.notas.map((nota) => [nota.tipo, nota.texto, nota.autor]),
    ).toEqual([
      // Sin nombre para el 99: el rol en palabras.
      ['NOTA', 'Pruebas tecnicas 3', 'DMIP · Unidad de Operativos'],
      // Sin fecha de solicitud: la de creación (13:00), y el creador como autor.
      ['COMPARTIDA', 'Comparte con OP-001', 'Persona Que Registra'],
    ]);
    expect(fila?.notas[1].operativoRelacionadoId).toBe(1);
    expect(fila?.observaciones).toEqual(['Pruebas tecnicas 3']);
  });
});
