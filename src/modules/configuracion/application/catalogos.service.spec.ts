/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: catalogos.service.spec.ts
 * Responsabilidad: Verificar RN-16, RN-17, RN-18, RF-058 y la traza de administración.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { AccionAuditoria, type Zonal } from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { CatalogosRepository } from '../infrastructure/catalogos.repository';
import { CatalogosService } from './catalogos.service';
import type { FormulariosService } from './formularios.service';

const CLIENTE = { marca: 'transaccion' };

const ZONALES = [
  { id: 1, codigo: 'DMQ', nombre: 'DMQ', esDmq: true, orden: 1, activo: true },
  {
    id: 2,
    codigo: 'EUGENIO_ESPEJO',
    nombre: 'Zonal Eugenio Espejo',
    esDmq: false,
    orden: 2,
    activo: true,
  },
] as Zonal[];

const FORMULARIO = {
  id: 8,
  codigo: 'INSP',
  nombre: 'INSPECCIONES',
  capturaLibrePunto: false,
  capturaLibreTipo: true,
};

interface Opciones {
  puntos?: { id: number; nombre: string }[];
  tipos?: { id: number; nombre: string }[];
  instituciones?: { id: number; sigla: string }[];
  usos?: number;
  activo?: boolean;
  /** Puntos vigentes de la zonal, para la baja en cascada. */
  puntosDeZonal?: { id: number; nombre: string }[];
  /** Si el formulario permite agregar un punto al catálogo desde el registro (1-4). */
  puntoManual?: boolean;
}

const armar = (opciones: Opciones = {}) => {
  const {
    puntos = [],
    tipos = [],
    instituciones = [],
    usos = 0,
    activo = true,
    puntosDeZonal = [],
    puntoManual = false,
  } = opciones;

  const crearPunto = jest
    .fn()
    .mockImplementation((datos: { nombre: string; zonalId: number }) =>
      Promise.resolve({ id: 100, activo: true, ...datos }),
    );
  const actualizarPunto = jest
    .fn()
    .mockImplementation((id: number, datos: Record<string, unknown>) =>
      Promise.resolve({ id, nombre: 'Punto', zonalId: 2, activo, ...datos }),
    );
  const crearTipoControl = jest
    .fn()
    .mockImplementation((nombre: string, formularioId: number) =>
      Promise.resolve({ id: 200, nombre, formularioId, activo: true }),
    );
  const actualizarTipoControl = jest
    .fn()
    .mockImplementation((id: number, datos: Record<string, unknown>) =>
      Promise.resolve({ id, nombre: 'Tipo', activo, ...datos }),
    );
  const crearInstitucion = jest
    .fn()
    .mockImplementation((datos: { sigla: string; nombre: string }) =>
      Promise.resolve({ id: 300, activo: true, ...datos }),
    );
  const actualizarInstitucion = jest
    .fn()
    .mockImplementation((id: number, datos: Record<string, unknown>) =>
      Promise.resolve({
        id,
        sigla: 'AMC',
        nombre: 'Agencia',
        activo,
        ...datos,
      }),
    );

  // Las funciones simuladas que se pasan a expect() se conservan aparte del objeto:
  // tomarlas como `repositorio.metodo` las desligaría de su objeto.
  const puntosDeFormularioYZonal = jest.fn().mockResolvedValue([]);
  const registrar = jest.fn().mockResolvedValue(undefined);

  // Cada punto e institución pertenece a UN formulario (2026-09-29): la unicidad se
  // comprueba contra los del mismo formulario, no contra un catálogo global.
  const nombresDePuntosDeFormularioYZonal = jest.fn().mockResolvedValue(puntos);
  const siglasDeInstitucionesDeFormulario = jest
    .fn()
    .mockResolvedValue(instituciones);

  // Aparte del objeto para pasarla a expect() sin desligarla (regla unbound-method).
  const catalogosDeFormularioConInactivos = jest.fn().mockResolvedValue({
    puntos: [],
    tiposControl: [
      { id: 1, nombre: 'Vigente', activo: true, formularios: [] },
      { id: 2, nombre: 'Retirado', activo: false, formularios: [] },
    ],
    instituciones: [],
  });

  const listarZonales = jest.fn().mockResolvedValue(ZONALES);
  // El formulario de la prueba solo llega a la zonal DMQ: es donde tiene puntos.
  const zonalesDeFormulario = jest.fn().mockResolvedValue([ZONALES[0]]);

  const crearZonal = jest
    .fn()
    .mockImplementation(
      (datos: { codigo: string; nombre: string; orden: number }) =>
        Promise.resolve({ id: 99, esDmq: false, activo: true, ...datos }),
    );
  const actualizarZonal = jest
    .fn()
    .mockImplementation((id: number, datos: Record<string, unknown>) =>
      Promise.resolve({
        id,
        codigo: 'EUGENIO_ESPEJO',
        nombre: 'Zonal Eugenio Espejo',
        esDmq: false,
        orden: 2,
        activo: true,
        ...datos,
      }),
    );

  const repositorio = {
    listarZonales,
    zonalesDeFormulario,
    buscarZonal: jest
      .fn()
      .mockImplementation((id: number) =>
        Promise.resolve(ZONALES.find((z) => z.id === id) ?? null),
      ),
    catalogosDeFormulario: jest
      .fn()
      .mockResolvedValue({ puntos: [], tiposControl: [], instituciones: [] }),
    catalogosDeFormularioConInactivos,
    puntosDeFormularioYZonal,
    nombresDePuntosDeFormularioYZonal,
    nombresDeTiposControlDeFormulario: jest.fn().mockResolvedValue(tipos),
    siglasDeInstitucionesDeFormulario,
    buscarPunto: jest.fn().mockResolvedValue({
      id: 10,
      nombre: 'Punto',
      zonalId: 2,
      formularioId: 8,
      activo,
    }),
    buscarTipoControl: jest
      .fn()
      .mockResolvedValue({ id: 20, nombre: 'Tipo', formularioId: 6, activo }),
    buscarInstitucion: jest.fn().mockResolvedValue({
      id: 30,
      sigla: 'AMC',
      nombre: 'Agencia',
      formularioId: 8,
      activo,
    }),
    crearPunto,
    actualizarPunto,
    crearTipoControl,
    actualizarTipoControl,
    crearInstitucion,
    actualizarInstitucion,
    contarOperativosConPunto: jest.fn().mockResolvedValue(usos),
    contarOperativosConTipoControl: jest.fn().mockResolvedValue(usos),
    contarOperativosConInstitucion: jest.fn().mockResolvedValue(usos),
    contarOperativosConZonal: jest.fn().mockResolvedValue(usos),
    contarPuntosDeZonal: jest.fn().mockResolvedValue(puntosDeZonal.length),
    eliminarZonal: jest.fn().mockResolvedValue(undefined),
    eliminarPunto: jest.fn().mockResolvedValue(undefined),
    eliminarTipoControl: jest.fn().mockResolvedValue(undefined),
    eliminarInstitucion: jest.fn().mockResolvedValue(undefined),
    puntosActivosDeZonal: jest.fn().mockResolvedValue(puntosDeZonal),
    crearZonal,
    actualizarZonal,
    nombresDeZonales: jest
      .fn()
      .mockResolvedValue(ZONALES.map((z) => ({ id: z.id, nombre: z.nombre }))),
    codigosDeZonales: jest.fn().mockResolvedValue(ZONALES.map((z) => z.codigo)),
    maxOrdenZonal: jest.fn().mockResolvedValue(2),
    ejecutarEnTransaccion: jest
      .fn()
      .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
        operacion(CLIENTE),
      ),
  } as unknown as CatalogosRepository;

  const formularios = {
    obtenerDefinicion: jest
      .fn()
      .mockResolvedValue({ ...FORMULARIO, puntoManual }),
    verificarExisten: jest.fn().mockResolvedValue([]),
    describir: jest.fn().mockResolvedValue(
      new Map([
        [1, '1 (FIJOS)'],
        [5, '5 (REACD)'],
      ]),
    ),
  } as unknown as FormulariosService;

  const auditoria = {
    registrar,
    compararCambios: jest
      .fn()
      .mockImplementation(
        (anterior: Record<string, unknown>, nuevo: Record<string, unknown>) =>
          Object.entries(nuevo)
            .filter(
              ([campo, valor]) => String(anterior[campo]) !== String(valor),
            )
            .map(([campo, valor]) => ({
              campo,
              valorAnterior: String(anterior[campo]),
              valorNuevo: String(valor),
            })),
      ),
  } as unknown as AuditoriaService;

  return {
    catalogosDeFormularioConInactivos,
    servicio: new CatalogosService(repositorio, formularios, auditoria),
    repositorio,
    formularios,
    registrar,
    crearPunto,
    actualizarPunto,
    crearTipoControl,
    crearInstitucion,
    puntosDeFormularioYZonal,
    nombresDePuntosDeFormularioYZonal,
    listarZonales,
    zonalesDeFormulario,
    crearZonal,
    actualizarZonal,
  };
};

describe('CatalogosService · consulta', () => {
  /** La lista completa sigue existiendo: la administración la necesita entera. */
  it('el catálogo de zonales de administración devuelve las once', async () => {
    const { servicio } = armar();
    expect(await servicio.listarZonales()).toHaveLength(2);
  });

  it('RN-16 · un formulario sin delimitación devuelve catálogos vacíos, no el catálogo completo', async () => {
    const { servicio } = armar();
    const catalogos = await servicio.obtenerCatalogos('INSP');

    expect(catalogos.puntos).toEqual([]);
    expect(catalogos.tiposControl).toEqual([]);
    expect(catalogos.instituciones).toEqual([]);
  });

  /**
   * PV-36. El camino operativo filtra lo vigente; el de administración trae también lo
   * desactivado, para poder reactivarlo. Son dos consultas distintas del repositorio, y
   * ésta comprueba que la administración usa la que incluye inactivos.
   */
  it('la administración incluye los desactivados, con su bandera activo', async () => {
    const { servicio, catalogosDeFormularioConInactivos } = armar();

    const catalogos = await servicio.obtenerCatalogosAdmin('INSP');

    expect(catalogosDeFormularioConInactivos).toHaveBeenCalled();
    expect(catalogos.tiposControl).toEqual([
      expect.objectContaining({ nombre: 'Vigente', activo: true }),
      expect.objectContaining({ nombre: 'Retirado', activo: false }),
    ]);
  });

  /**
   * ESTA PRUEBA AFIRMABA LO CONTRARIO HASTA EL 2026-09-02.
   *
   * Se llamaba «caso 6 del plan · sin puntos mapeados la zonal sigue apareciendo» y
   * comprobaba que las dos zonales viajaban aunque el formulario no tuviera ningún
   * punto. El negocio decidió que cada formulario maneja sus zonales, y el motivo es
   * que el punto de encuentro es obligatorio y no hay captura libre: una zonal sin
   * puntos no daba una lista vacía, daba un registro imposible de completar.
   */
  it('cada formulario ofrece solo las zonales donde tiene puntos', async () => {
    const { servicio, listarZonales, zonalesDeFormulario } = armar();
    const catalogos = await servicio.obtenerCatalogos('INSP');

    expect(catalogos.zonales).toEqual([ZONALES[0]]);
    expect(zonalesDeFormulario).toHaveBeenCalled();
    // La lista completa es de administración: no se usa para armar los catálogos.
    expect(listarZonales).not.toHaveBeenCalled();
  });

  /** RN-20 es propiedad de cada catálogo: separada en dos banderas el 2026-08-11. */
  it('RN-20 · informa qué catálogo ofrece la captura libre', async () => {
    const { servicio } = armar();
    const catalogos = await servicio.obtenerCatalogos('INSP');

    expect(catalogos.capturaLibreTipo).toBe(true);
    // El insumo aprobado no ofrece ADICIONALES en el punto de ningún formulario.
    expect(catalogos.capturaLibrePunto).toBe(false);
  });

  it('RN-17 · los puntos se piden por formulario y zonal', async () => {
    const { servicio, puntosDeFormularioYZonal } = armar();
    await servicio.obtenerPuntos('INSP', 2);

    expect(puntosDeFormularioYZonal).toHaveBeenCalledWith(8, 2);
  });

  it('una zonal inexistente produce 404', async () => {
    const { servicio } = armar();
    await expect(servicio.obtenerPuntos('INSP', 99)).rejects.toBeInstanceOf(
      RecursoNoEncontradoError,
    );
  });
});

describe('CatalogosService · alta', () => {
  it('crea el punto y lo audita dentro de la transacción', async () => {
    const { servicio, registrar } = armar();

    await servicio.crearPunto(
      { nombre: '  Plaza Grande  ', zonalId: 2, formularioId: 8 },
      6,
    );

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_punto_encuentro',
        entidadId: 100,
        accion: AccionAuditoria.CREAR,
        usuario: 6,
      }),
      CLIENTE,
    );
  });

  it('recorta los espacios del nombre y lo escribe con su formulario', async () => {
    const { servicio, crearPunto } = armar();
    await servicio.crearPunto(
      { nombre: '  Plaza Grande  ', zonalId: 2, formularioId: 8 },
      6,
    );

    // Cada punto pertenece a UN formulario (2026-09-29): el `formularioId` va en la fila,
    // sin tabla puente ni vinculación aparte.
    expect(crearPunto).toHaveBeenCalledWith(
      { nombre: 'Plaza Grande', zonalId: 2, formularioId: 8 },
      CLIENTE,
    );
  });

  it('rechaza crear en un formulario inexistente', async () => {
    const { servicio, formularios } = armar();
    (formularios.verificarExisten as jest.Mock).mockResolvedValue([99]);

    await expect(
      servicio.crearPunto(
        { nombre: 'Plaza Grande', zonalId: 2, formularioId: 99 },
        6,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('rechaza el punto duplicado aunque cambien mayúsculas y acentos', async () => {
    const { servicio, crearPunto } = armar({
      puntos: [{ id: 1, nombre: 'Plaza Grande' }],
    });

    const fallo: unknown = await servicio
      .crearPunto({ nombre: 'PLAZA GRANDE', zonalId: 2, formularioId: 8 }, 6)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('Plaza Grande');
    expect(crearPunto).not.toHaveBeenCalled();
  });

  it('rechaza el tipo de control duplicado por acentos', async () => {
    const { servicio } = armar({
      tipos: [{ id: 1, nombre: 'CONTROL DE EMISIÓN DE RUIDO' }],
    });

    await expect(
      servicio.crearTipoControl(
        { nombre: 'Control de emision de ruido', formularioId: 1 },
        6,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('admite un tipo de control que no choca con ninguno', async () => {
    const { servicio, crearTipoControl } = armar({
      tipos: [{ id: 1, nombre: 'CONTROL DE RUIDO' }],
    });

    await servicio.crearTipoControl(
      { nombre: 'Control de humo', formularioId: 1 },
      6,
    );
    expect(crearTipoControl).toHaveBeenCalledWith(
      'Control de humo',
      1,
      CLIENTE,
    );
  });

  it('rechaza la institución con sigla ya registrada en el formulario', async () => {
    const { servicio } = armar({ instituciones: [{ id: 1, sigla: 'AMC' }] });

    await expect(
      servicio.crearInstitucion(
        { sigla: 'amc', nombre: 'Agencia', formularioId: 8 },
        6,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('crea la institución con su formulario, sin tabla puente', async () => {
    const { servicio, crearInstitucion } = armar();

    await servicio.crearInstitucion(
      { sigla: 'ANT', nombre: 'Agencia Nacional de Tránsito', formularioId: 8 },
      6,
    );

    expect(crearInstitucion).toHaveBeenCalledWith(
      {
        sigla: 'ANT',
        nombre: 'Agencia Nacional de Tránsito',
        formularioId: 8,
      },
      CLIENTE,
    );
  });
});

describe('CatalogosService · modificación', () => {
  it('no escribe ni audita cuando nada cambia', async () => {
    const { servicio, actualizarPunto, registrar } = armar();

    await servicio.actualizarPunto(10, { nombre: 'Punto' }, 6);

    expect(actualizarPunto).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('audita el cambio de nombre con el valor anterior y el nuevo', async () => {
    const { servicio, registrar } = armar();

    await servicio.actualizarPunto(10, { nombre: 'Punto renombrado' }, 6);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_punto_encuentro',
        accion: AccionAuditoria.ACTUALIZAR,
        // La traza nombra la COLUMNA, no la propiedad del modelo.
        cambios: [
          {
            campo: 'pcto_nombre',
            valorAnterior: 'Punto',
            valorNuevo: 'Punto renombrado',
          },
        ],
      }),
      CLIENTE,
    );
  });

  it('un identificador inexistente produce 404', async () => {
    const { servicio, repositorio } = armar();
    (repositorio.buscarPunto as jest.Mock).mockResolvedValue(null);

    await expect(
      servicio.actualizarPunto(999, { nombre: 'Otro' }, 6),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('comprueba el duplicado también al mover el punto de zonal', async () => {
    // `uq_punto_nombre_zonal` es compuesto: la misma denominación en la zonal de
    // destino infringe la restricción igual que un renombrado.
    const { servicio, actualizarPunto } = armar({
      puntos: [{ id: 99, nombre: 'Punto' }],
    });

    await expect(
      servicio.actualizarPunto(10, { zonalId: 1 }, 6),
    ).rejects.toBeInstanceOf(ValidacionError);
    expect(actualizarPunto).not.toHaveBeenCalled();
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CATÁLOGOS POR FORMULARIO (2026-09-29). Se retiró la re-delimitación (L-07) y la tabla
 * puente: cada punto e institución PERTENECE a un formulario (columna `form_id` propia),
 * como los tipos de control desde el 2026-09-07. Ya no hay `formularioIds`, ni
 * `redelimitarPunto`, ni comprobación de retirar un formulario que ya usa el valor: mover
 * un valor de formulario dejó de existir como operación.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('CatalogosService · catálogos por formulario (2026-09-29)', () => {
  it('la unicidad del punto se comprueba dentro de su formulario y zonal', async () => {
    const { servicio, nombresDePuntosDeFormularioYZonal } = armar();

    await servicio.actualizarPunto(10, { nombre: 'Otro nombre' }, 6);

    // buscarPunto devuelve formularioId 8; el renombrado se coteja contra ese formulario.
    expect(nombresDePuntosDeFormularioYZonal).toHaveBeenCalledWith(8, 2);
  });

  it('actualizar el punto no arrastra ninguna re-delimitación', async () => {
    const { servicio, actualizarPunto } = armar();

    await servicio.actualizarPunto(10, { nombre: 'Punto renombrado' }, 6);

    // Solo se escribe la fila del catálogo: nombre, zonal y estado.
    expect(actualizarPunto).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ nombre: 'Punto renombrado' }),
      CLIENTE,
    );
  });
});

describe('CatalogosService · baja lógica (RF-058)', () => {
  it('caso 7 del plan · un tipo usado en cuadros históricos se desactiva, no se borra', async () => {
    const { servicio, registrar } = armar({ usos: 12 });

    const baja = await servicio.desactivarTipoControl(20, 6);

    expect(baja.registro.activo).toBe(false);
    expect(baja.usosHistoricos).toBe(12);
    expect(baja.mensaje).toContain('12 operativos anteriores');
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: AccionAuditoria.ELIMINAR }),
      CLIENTE,
    );
  });

  it('un valor sin uso TAMPOCO se borra', async () => {
    const { servicio } = armar({ usos: 0 });

    const baja = await servicio.desactivarPunto(10, 6);

    expect(baja.registro.activo).toBe(false);
    expect(baja.mensaje).toContain('no se eliminan');
  });

  it('concuerda el singular cuando hay un solo uso', async () => {
    const { servicio } = armar({ usos: 1 });
    const baja = await servicio.desactivarInstitucion(30, 6);

    expect(baja.mensaje).toContain('1 operativo anterior.');
  });

  it('repetir la baja no vuelve a escribir ni a auditar', async () => {
    const { servicio, registrar, actualizarPunto } = armar({ activo: false });

    const baja = await servicio.desactivarPunto(10, 6);

    expect(baja.mensaje).toContain('ya estaba fuera de uso');
    expect(actualizarPunto).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe('CatalogosService · zonales', () => {
  it('crear autogenera el código del nombre: mayúsculas, sin tildes, con guion bajo', async () => {
    const { servicio, crearZonal } = armar();

    await servicio.crearZonal({ nombre: 'La Concepción Norte' }, 6);

    expect(crearZonal).toHaveBeenCalledWith(
      expect.objectContaining({
        codigo: 'LA_CONCEPCION_NORTE',
        nombre: 'La Concepción Norte',
        esDmq: false,
      }),
      expect.anything(),
    );
  });

  it('crear pone el orden al final: siguiente al mayor existente', async () => {
    const { servicio, crearZonal } = armar();

    await servicio.crearZonal({ nombre: 'Zona Nueva' }, 6);

    // maxOrdenZonal está mockeado en 2, así que la nueva es la 3.
    expect(crearZonal).toHaveBeenCalledWith(
      expect.objectContaining({ orden: 3 }),
      expect.anything(),
    );
  });

  it('crear deja traza de alta', async () => {
    const { servicio, registrar } = armar();

    await servicio.crearZonal({ nombre: 'Zona Nueva' }, 6);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_zonal',
        accion: AccionAuditoria.CREAR,
        usuario: 6,
      }),
      expect.anything(),
    );
  });

  it('crear rechaza un nombre ya usado, sin distinguir tildes ni mayúsculas', async () => {
    const { servicio, crearZonal } = armar();

    await expect(
      servicio.crearZonal({ nombre: 'zonal eugenio espejo' }, 6),
    ).rejects.toBeInstanceOf(ValidacionError);
    expect(crearZonal).not.toHaveBeenCalled();
  });

  it('crear desempata el código cuando el derivado ya existe', async () => {
    const { servicio, crearZonal, repositorio } = armar();
    // El código EUGENIO_ESPEJO ya está tomado; un nombre que derive en él debe desempatarse.
    (repositorio.codigosDeZonales as jest.Mock).mockResolvedValueOnce([
      'EUGENIO_ESPEJO',
    ]);

    await servicio.crearZonal({ nombre: 'Eugenio Espejo' }, 6);

    expect(crearZonal).toHaveBeenCalledWith(
      expect.objectContaining({ codigo: 'EUGENIO_ESPEJO_2' }),
      expect.anything(),
    );
  });

  it('actualizar cambia el nombre y lo audita', async () => {
    const { servicio, actualizarZonal, registrar } = armar();

    await servicio.actualizarZonal(2, { nombre: 'Zonal Norte' }, 6);

    expect(actualizarZonal).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ nombre: 'Zonal Norte' }),
      expect.anything(),
    );
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_zonal',
        accion: AccionAuditoria.ACTUALIZAR,
      }),
      expect.anything(),
    );
  });

  it('actualizar con activo:true reactiva una zonal desactivada', async () => {
    const { servicio, actualizarZonal, repositorio } = armar();
    // Se parte de una zonal desactivada para ver el cambio de estado a vigente.
    (repositorio.buscarZonal as jest.Mock).mockResolvedValue({
      id: 2,
      codigo: 'EUGENIO_ESPEJO',
      nombre: 'Zonal Eugenio Espejo',
      esDmq: false,
      orden: 2,
      activo: false,
    });

    await servicio.actualizarZonal(2, { activo: true }, 6);

    expect(actualizarZonal).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ activo: true }),
      expect.anything(),
    );
  });

  it('actualizar una zonal inexistente lanza no encontrado', async () => {
    const { servicio } = armar();

    await expect(
      servicio.actualizarZonal(999, { nombre: 'X' }, 6),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('desactivar es baja lógica (RF-058) y explica cuántos operativos la usan', async () => {
    const { servicio, actualizarZonal } = armar({ usos: 4 });

    const baja = await servicio.desactivarZonal(2, 6);

    expect(actualizarZonal).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ activo: false }),
      expect.anything(),
    );
    expect(baja.usosHistoricos).toBe(4);
    expect(baja.mensaje).toContain('4 operativos');
  });

  it('desactivar una zonal arrastra la baja de sus puntos de encuentro', async () => {
    const { servicio, actualizarZonal, actualizarPunto } = armar({
      puntosDeZonal: [
        { id: 10, nombre: 'AMC Matriz' },
        { id: 11, nombre: 'HCAM' },
      ],
    });

    const baja = await servicio.desactivarZonal(2, 6);

    // La zonal y sus dos puntos quedan inactivos en la misma operación.
    expect(actualizarZonal).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ activo: false }),
      expect.anything(),
    );
    expect(actualizarPunto).toHaveBeenCalledWith(
      10,
      { activo: false },
      expect.anything(),
    );
    expect(actualizarPunto).toHaveBeenCalledWith(
      11,
      { activo: false },
      expect.anything(),
    );
    expect(baja.mensaje).toContain('2 puntos de encuentro');
  });

  it('reactivar la zonal NO reactiva sus puntos: cada uno se reactiva aparte', async () => {
    const { servicio, actualizarPunto, repositorio } = armar();
    (repositorio.buscarZonal as jest.Mock).mockResolvedValue({
      id: 2,
      codigo: 'EUGENIO_ESPEJO',
      nombre: 'Zonal Eugenio Espejo',
      esDmq: false,
      orden: 2,
      activo: false,
    });

    await servicio.actualizarZonal(2, { activo: true }, 6);

    expect(actualizarPunto).not.toHaveBeenCalled();
  });

  it('un punto NO se reactiva mientras su zonal está desactivada', async () => {
    // El punto (id 10) está inactivo y su zonal (id 2) también.
    const { servicio, actualizarPunto, repositorio } = armar({ activo: false });
    (repositorio.buscarZonal as jest.Mock).mockResolvedValue({
      id: 2,
      codigo: 'EUGENIO_ESPEJO',
      nombre: 'Zonal Eugenio Espejo',
      esDmq: false,
      orden: 2,
      activo: false,
    });

    await expect(
      servicio.actualizarPunto(10, { activo: true }, 6),
    ).rejects.toBeInstanceOf(ValidacionError);
    expect(actualizarPunto).not.toHaveBeenCalled();
  });

  it('con la zonal ya vigente, el punto sí se puede reactivar', async () => {
    // Punto inactivo, pero su zonal (id 2) está activa por omisión en el arnés.
    const { servicio, actualizarPunto } = armar({ activo: false });

    await servicio.actualizarPunto(10, { activo: true }, 6);

    expect(actualizarPunto).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ activo: true }),
      expect.anything(),
    );
  });

  it('desactivar una zonal ya inactiva no vuelve a escribir', async () => {
    const { servicio, actualizarZonal, registrar, repositorio } = armar();
    (repositorio.buscarZonal as jest.Mock).mockResolvedValue({
      id: 2,
      codigo: 'EUGENIO_ESPEJO',
      nombre: 'Zonal Eugenio Espejo',
      esDmq: false,
      orden: 2,
      activo: false,
    });

    const baja = await servicio.desactivarZonal(2, 6);

    expect(baja.mensaje).toContain('ya estaba fuera de uso');
    expect(actualizarZonal).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe('ELIMINAR (baja física), y solo lo que nunca se usó', () => {
  // El borrado deja traza (`registrar`) dentro de la transacción; un bloqueo lanza ANTES de
  // escribir, así que `registrar` es la señal de que la fila se borró de verdad.
  it('un tipo de control SIN uso se borra de verdad, con su traza', async () => {
    const { servicio, registrar } = armar({ usos: 0 });

    const resultado = await servicio.eliminarTipoControl(20, 7);

    expect(registrar).toHaveBeenCalled();
    expect(resultado.mensaje).toContain('se eliminó definitivamente');
  });

  it('un tipo de control USADO no se borra: 409 y no toca la base', async () => {
    const { servicio, registrar } = armar({ usos: 3 });

    await expect(servicio.eliminarTipoControl(20, 7)).rejects.toBeInstanceOf(
      ReglaNegocioError,
    );
    expect(registrar).not.toHaveBeenCalled();
  });

  it('una zonal CON puntos no se borra: primero hay que quitarlos (409)', async () => {
    const { servicio, registrar } = armar({
      usos: 0,
      puntosDeZonal: [{ id: 1, nombre: 'AMC Norte' }],
    });

    await expect(servicio.eliminarZonal(2, 7)).rejects.toBeInstanceOf(
      ReglaNegocioError,
    );
    expect(registrar).not.toHaveBeenCalled();
  });

  it('una zonal sin puntos ni uso se borra, con su traza', async () => {
    const { servicio, registrar } = armar({ usos: 0, puntosDeZonal: [] });

    const resultado = await servicio.eliminarZonal(2, 7);

    expect(registrar).toHaveBeenCalled();
    expect(resultado.mensaje).toContain('se eliminó definitivamente');
  });
});

describe('AGREGAR punto al catálogo desde el registro (Unidad de Operativos)', () => {
  it('validarPuntoDeRegistro: con el formulario que lo permite devuelve el nombre recortado, sin escribir', async () => {
    const { servicio, crearPunto } = armar({
      puntoManual: true,
    });

    const nombre = await servicio.validarPuntoDeRegistro('FIJOS', {
      nombre: '  Plaza Nueva  ',
      zonalId: 2,
    });

    expect(nombre).toBe('Plaza Nueva');
    // Solo valida: la escritura la hace `crearPuntoEnTransaccion`, dentro de la transacción del registro.
    expect(crearPunto).not.toHaveBeenCalled();
  });

  it('validarPuntoDeRegistro: si el formulario NO lo permite, rechaza', async () => {
    const { servicio } = armar({ puntoManual: false });

    await expect(
      servicio.validarPuntoDeRegistro('INSP', {
        nombre: 'Plaza Nueva',
        zonalId: 2,
      }),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('validarPuntoDeRegistro: si el nombre ya existe en la zonal, rechaza', async () => {
    const { servicio } = armar({
      puntoManual: true,
      puntos: [{ id: 5, nombre: 'Plaza Nueva' }],
    });

    await expect(
      servicio.validarPuntoDeRegistro('FIJOS', {
        nombre: 'plaza nueva',
        zonalId: 2,
      }),
    ).rejects.toBeInstanceOf(ValidacionError);
  });

  it('crearPuntoEnTransaccion: crea el punto en su formulario y deja traza, con el cliente recibido', async () => {
    const { servicio, crearPunto, registrar } = armar({
      puntoManual: true,
    });
    const cliente = { marca: 'tx-del-registro' } as never;

    const punto = await servicio.crearPuntoEnTransaccion(
      cliente,
      { nombre: 'Plaza Nueva', zonalId: 2, formularioId: 8 },
      6,
    );

    expect(punto.id).toBe(100);
    // El `formularioId` viaja en la propia fila: sin tabla puente ni vinculación aparte.
    expect(crearPunto).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre: 'Plaza Nueva',
        zonalId: 2,
        formularioId: 8,
      }),
      cliente,
    );
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_punto_encuentro',
        entidadId: 100,
        accion: AccionAuditoria.CREAR,
        usuario: 6,
      }),
      cliente,
    );
  });
});
