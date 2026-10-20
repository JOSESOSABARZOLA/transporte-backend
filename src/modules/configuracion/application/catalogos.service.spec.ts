/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: catalogos.service.spec.ts
 * Responsabilidad: Verificar RN-16, RN-17, RN-18, RF-058, el aislamiento entre formularios y la traza.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * CADA FORMULARIO CON SU CONFIGURACIÓN PROPIA (2026-10-13). El repositorio simulado guarda las
 * filas de DOS formularios en memoria —INSP (8) y PMO (2)— y responde como la base: así se puede
 * comprobar que lo que se crea, edita o desactiva en uno no aparece ni cambia en el otro.
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
import {
  MOTIVO_CON_PUNTOS,
  MOTIVO_USADO,
} from './politicas/eliminacion-catalogo';

const CLIENTE = { marca: 'transaccion' };

/** Zonas de la ciudad (`t_zonal`). */
const ZONAS: Zonal[] = [
  {
    id: 1,
    codigo: 'DMQ',
    nombre: 'DMQ',
    esDmq: true,
    orden: 1,
    activo: true,
    sector: null,
  },
  {
    id: 2,
    codigo: 'EUGENIO_ESPEJO',
    nombre: 'Zonal Eugenio Espejo',
    esDmq: false,
    orden: 2,
    activo: true,
    sector: null,
  },
  {
    id: 3,
    codigo: 'LA_DELICIA',
    nombre: 'Zonal La Delicia',
    esDmq: false,
    orden: 3,
    activo: true,
    sector: null,
  },
  {
    id: 4,
    codigo: 'RETIRADA',
    nombre: 'Zona Retirada',
    esDmq: false,
    orden: 4,
    activo: false,
    sector: null,
  },
];

const INSP = {
  id: 8,
  codigo: 'INSP',
  numero: 8,
  nombre: 'INSPECCIONES',
  capturaLibrePunto: false,
  capturaLibreTipo: true,
  tipoTransporteDefecto: 'SOLO_INICIO',
};
const PMO = { ...INSP, id: 2, codigo: 'PMO', numero: 2, nombre: 'PMO' };

interface FilaZonal {
  id: number;
  formularioId: number;
  zonaId: number;
  nombre: string;
  activo: boolean;
  orden: number;
}
interface FilaPunto {
  id: number;
  formularioId: number;
  zonalId: number;
  nombre: string;
  activo: boolean;
}
interface FilaTipo {
  id: number;
  formularioId: number;
  nombre: string;
  activo: boolean;
}
interface FilaInstitucion {
  id: number;
  formularioId: number;
  sigla: string;
  nombre: string;
  activo: boolean;
}

interface Opciones {
  /** Operativos que usan cada valor, por id (o por `zona:<formulario>:<zona>` en zonales). */
  usos?: Record<string, number>;
  puntoManual?: boolean;
  zonalesInactivas?: number[];
}

const armar = (opciones: Opciones = {}) => {
  const { usos = {}, puntoManual = false, zonalesInactivas = [] } = opciones;

  const bd = {
    zonales: [
      { id: 11, formularioId: 8, zonaId: 1, nombre: 'DMQ', orden: 1 },
      {
        id: 12,
        formularioId: 8,
        zonaId: 2,
        nombre: 'Zonal Eugenio Espejo',
        orden: 2,
      },
      {
        id: 21,
        formularioId: 2,
        zonaId: 2,
        nombre: 'Zonal Eugenio Espejo',
        orden: 2,
      },
    ].map((z) => ({
      ...z,
      activo: !zonalesInactivas.includes(z.id),
    })) as FilaZonal[],
    puntos: [
      { id: 101, formularioId: 8, zonalId: 2, nombre: 'HCAM', activo: true },
      { id: 102, formularioId: 8, zonalId: 2, nombre: 'Tejar', activo: false },
      { id: 201, formularioId: 2, zonalId: 2, nombre: 'HCAM', activo: true },
    ] as FilaPunto[],
    tipos: [
      { id: 301, formularioId: 8, nombre: 'CONTROL DE OBRAS', activo: true },
      { id: 302, formularioId: 2, nombre: 'CONTROL PMO', activo: true },
    ] as FilaTipo[],
    instituciones: [
      {
        id: 401,
        formularioId: 8,
        sigla: 'AMC',
        nombre: 'Agencia Metropolitana de Control',
        activo: true,
      },
    ] as FilaInstitucion[],
  };

  const conZona = (fila: FilaZonal) => ({
    ...fila,
    zona: ZONAS.find((z) => z.id === fila.zonaId) as Zonal,
  });
  const usosDe = (clave: string) => usos[clave] ?? 0;

  // Las funciones que se pasan a expect() se conservan aparte del objeto (regla unbound-method).
  const registrar = jest.fn().mockResolvedValue(undefined);
  const crearZonalDeFormulario = jest.fn(
    (datos: Omit<FilaZonal, 'id' | 'activo'>) => {
      const fila = { id: 90, activo: true, ...datos };
      bd.zonales.push(fila);
      return Promise.resolve(fila);
    },
  );
  const actualizarZonalDeFormulario = jest.fn(
    (id: number, datos: Partial<FilaZonal>) => {
      const fila = bd.zonales.find((z) => z.id === id) as FilaZonal;
      Object.assign(
        fila,
        Object.fromEntries(
          Object.entries(datos).filter(([, v]) => v !== undefined),
        ),
      );
      return Promise.resolve({ ...fila });
    },
  );
  const eliminarZonalDeFormulario = jest.fn((id: number) => {
    bd.zonales = bd.zonales.filter((z) => z.id !== id);
    return Promise.resolve();
  });
  const crearPunto = jest.fn((datos: Omit<FilaPunto, 'id' | 'activo'>) => {
    const fila = { id: 150, activo: true, ...datos };
    bd.puntos.push(fila);
    return Promise.resolve(fila);
  });
  const actualizarPunto = jest.fn((id: number, datos: Partial<FilaPunto>) => {
    const fila = bd.puntos.find((p) => p.id === id) as FilaPunto;
    Object.assign(
      fila,
      Object.fromEntries(
        Object.entries(datos).filter(([, v]) => v !== undefined),
      ),
    );
    return Promise.resolve({ ...fila });
  });
  const crearTipoControl = jest.fn((nombre: string, formularioId: number) => {
    const fila = { id: 350, nombre, formularioId, activo: true };
    bd.tipos.push(fila);
    return Promise.resolve(fila);
  });
  const actualizarTipoControl = jest.fn(
    (id: number, datos: Partial<FilaTipo>) => {
      const fila = bd.tipos.find((t) => t.id === id) as FilaTipo;
      Object.assign(
        fila,
        Object.fromEntries(
          Object.entries(datos).filter(([, v]) => v !== undefined),
        ),
      );
      return Promise.resolve({ ...fila });
    },
  );
  const crearInstitucion = jest.fn(
    (datos: Omit<FilaInstitucion, 'id' | 'activo'>) => {
      const fila = { id: 450, activo: true, ...datos };
      bd.instituciones.push(fila);
      return Promise.resolve(fila);
    },
  );
  const eliminarTipoControl = jest.fn().mockResolvedValue(undefined);
  const puntosActivosDeZonalDeFormulario = jest.fn(
    (formularioId: number, zonaId: number) =>
      Promise.resolve(
        bd.puntos.filter(
          (p) =>
            p.formularioId === formularioId && p.zonalId === zonaId && p.activo,
        ),
      ),
  );
  const contarOperativosDeFormularioConZona = jest.fn(
    (formularioId: number, zonaId: number) =>
      Promise.resolve(usosDe(`zona:${formularioId}:${zonaId}`)),
  );
  const zonalesDeFormulario = jest.fn((formularioId: number) =>
    Promise.resolve(
      bd.zonales
        .filter((z) => z.formularioId === formularioId && z.activo)
        .map((z) => ({ ...conZona(z).zona, nombre: z.nombre })),
    ),
  );

  const repositorio = {
    listarZonales: jest.fn().mockResolvedValue(ZONAS),
    zonalesDelFormulario: jest.fn((formularioId: number) =>
      Promise.resolve(
        bd.zonales.filter((z) => z.formularioId === formularioId).map(conZona),
      ),
    ),
    buscarZonalDeFormulario: jest.fn((formularioId: number, zonaId: number) => {
      const fila = bd.zonales.find(
        (z) => z.formularioId === formularioId && z.zonaId === zonaId,
      );
      return Promise.resolve(fila ? conZona({ ...fila }) : null);
    }),
    buscarZona: jest.fn((id: number) =>
      Promise.resolve(ZONAS.find((z) => z.id === id) ?? null),
    ),
    zonasDisponibles: jest.fn((formularioId: number) =>
      Promise.resolve(
        ZONAS.filter(
          (z) =>
            z.activo &&
            !bd.zonales.some(
              (f) => f.formularioId === formularioId && f.zonaId === z.id,
            ),
        ),
      ),
    ),
    nombresDeZonalesDeFormulario: jest.fn((formularioId: number) =>
      Promise.resolve(
        bd.zonales.filter((z) => z.formularioId === formularioId),
      ),
    ),
    crearZonalDeFormulario,
    actualizarZonalDeFormulario,
    eliminarZonalDeFormulario,
    contarOperativosDeFormularioConZona,
    operativosPorZonaDeFormulario: jest.fn((formularioId: number) =>
      Promise.resolve(
        new Map(
          ZONAS.map((z) => [z.id, usosDe(`zona:${formularioId}:${z.id}`)]),
        ),
      ),
    ),
    puntosPorZonaDeFormulario: jest.fn((formularioId: number) => {
      const contar = (soloActivos: boolean) =>
        new Map(
          ZONAS.map((z) => [
            z.id,
            bd.puntos.filter(
              (p) =>
                p.formularioId === formularioId &&
                p.zonalId === z.id &&
                (!soloActivos || p.activo),
            ).length,
          ]),
        );
      return Promise.resolve({ todos: contar(false), activos: contar(true) });
    }),
    puntosActivosDeZonalDeFormulario,
    zonalesDeFormulario,
    catalogosDeFormulario: jest.fn().mockResolvedValue({
      puntos: [],
      tiposControl: [],
      instituciones: [],
    }),
    catalogosDeFormularioConInactivos: jest.fn((formularioId: number) =>
      Promise.resolve({
        puntos: [],
        tiposControl: bd.tipos
          .filter((t) => t.formularioId === formularioId)
          .map((t) => ({
            ...t,
            _count: {
              operativos: 0,
              operativosMultiples: usosDe(String(t.id)),
            },
          })),
        instituciones: [],
      }),
    ),
    puntosDeFormularioYZonal: jest.fn().mockResolvedValue([]),
    nombresDePuntosDeFormularioYZonal: jest.fn(
      (formularioId: number, zonalId: number) =>
        Promise.resolve(
          bd.puntos.filter(
            (p) => p.formularioId === formularioId && p.zonalId === zonalId,
          ),
        ),
    ),
    nombresDeTiposControlDeFormulario: jest.fn((formularioId: number) =>
      Promise.resolve(bd.tipos.filter((t) => t.formularioId === formularioId)),
    ),
    siglasDeInstitucionesDeFormulario: jest.fn((formularioId: number) =>
      Promise.resolve(
        bd.instituciones.filter((i) => i.formularioId === formularioId),
      ),
    ),
    buscarPunto: jest.fn((id: number) =>
      Promise.resolve(bd.puntos.find((p) => p.id === id) ?? null),
    ),
    buscarTipoControl: jest.fn((id: number) =>
      Promise.resolve(bd.tipos.find((t) => t.id === id) ?? null),
    ),
    buscarInstitucion: jest.fn((id: number) =>
      Promise.resolve(bd.instituciones.find((i) => i.id === id) ?? null),
    ),
    crearPunto,
    actualizarPunto,
    crearTipoControl,
    actualizarTipoControl,
    crearInstitucion,
    actualizarInstitucion: jest.fn(),
    eliminarPunto: jest.fn().mockResolvedValue(undefined),
    eliminarTipoControl,
    eliminarInstitucion: jest.fn().mockResolvedValue(undefined),
    contarOperativosConPunto: jest.fn((id: number) =>
      Promise.resolve(usosDe(String(id))),
    ),
    contarOperativosConTipoControl: jest.fn((id: number) =>
      Promise.resolve(usosDe(String(id))),
    ),
    contarOperativosConInstitucion: jest.fn((id: number) =>
      Promise.resolve(usosDe(String(id))),
    ),
    ejecutarEnTransaccion: jest
      .fn()
      .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
        operacion(CLIENTE),
      ),
  } as unknown as CatalogosRepository;

  const formularios = {
    obtenerDefinicion: jest.fn((codigo: string) => {
      const formulario = [INSP, PMO].find((f) => f.codigo === codigo);
      if (!formulario) {
        return Promise.reject(
          new RecursoNoEncontradoError(`No existe el formulario ${codigo}.`),
        );
      }
      return Promise.resolve({ ...formulario, puntoManual });
    }),
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
    bd,
    servicio: new CatalogosService(repositorio, formularios, auditoria),
    registrar,
    crearZonalDeFormulario,
    actualizarZonalDeFormulario,
    eliminarZonalDeFormulario,
    crearPunto,
    actualizarPunto,
    crearTipoControl,
    actualizarTipoControl,
    crearInstitucion,
    eliminarTipoControl,
    puntosActivosDeZonalDeFormulario,
    contarOperativosDeFormularioConZona,
    zonalesDeFormulario,
  };
};

const capturar = async (promesa: Promise<unknown>): Promise<unknown> => {
  try {
    await promesa;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un rechazo.');
};

describe('CatalogosService · consulta', () => {
  it('las zonales de administración son SOLO las del formulario, con sus conteos en él', async () => {
    const { servicio } = armar({ usos: { 'zona:8:2': 5, 'zona:2:2': 9 } });

    const zonales = await servicio.listarZonalesAdmin('INSP');

    expect(zonales.map((z) => [z.id, z.zonalFormularioId, z.nombre])).toEqual([
      [1, 11, 'DMQ'],
      [2, 12, 'Zonal Eugenio Espejo'],
    ]);
    const espejo = zonales[1];
    expect(espejo).toEqual(
      expect.objectContaining({
        usos: 5,
        puntos: 2,
        puntosActivos: 1,
        puedeEliminar: false,
        motivoNoEliminar: MOTIVO_USADO,
      }),
    );
    // El DMQ del formulario no tiene puntos ni usos: se puede borrar (la zona de la ciudad queda).
    expect(zonales[0].puedeEliminar).toBe(true);
  });

  it('las zonas disponibles para el alta son las vigentes que el formulario aún no tiene', async () => {
    const { servicio } = armar();

    expect((await servicio.zonasDisponibles('INSP')).map((z) => z.id)).toEqual([
      3,
    ]);
    expect((await servicio.zonasDisponibles('PMO')).map((z) => z.id)).toEqual([
      1, 3,
    ]);
  });

  it('la administración trae usos y si se puede eliminar, sin copias en otros formularios', async () => {
    const { servicio } = armar({ usos: { '301': 2 } });

    const catalogos = await servicio.obtenerCatalogosAdmin('INSP');

    expect(catalogos.tiposControl).toEqual([
      expect.objectContaining({
        id: 301,
        usos: 2,
        puedeEliminar: false,
        motivoNoEliminar: MOTIVO_USADO,
      }),
    ]);
    expect(catalogos.tiposControl[0]).not.toHaveProperty('tambienEn');
  });

  it('RN-18 · el registro recibe las zonales del formulario con el id de la zona y su nombre propio', async () => {
    const { servicio, zonalesDeFormulario } = armar();

    const catalogos = await servicio.obtenerCatalogos('PMO');

    expect(zonalesDeFormulario).toHaveBeenCalledWith(2);
    expect(catalogos.zonales.map((z) => [z.id, z.nombre])).toEqual([
      [2, 'Zonal Eugenio Espejo'],
    ]);
    expect(catalogos.capturaLibreTipo).toBe(true);
    expect(catalogos.tipoTransportePorDefecto).toBe('SOLO_INICIO');
  });

  it('RN-17 · pedir los puntos de una zonal que el formulario NO tiene es 404', async () => {
    const { servicio } = armar();

    expect(await capturar(servicio.obtenerPuntos('PMO', 1))).toBeInstanceOf(
      RecursoNoEncontradoError,
    );
  });
});

describe('CatalogosService · cada formulario con su configuración propia (2026-10-13)', () => {
  it('un tipo creado en el formulario 8 no aparece en el 2', async () => {
    const { servicio, bd } = armar();

    await servicio.crearTipoControl('INSP', { nombre: 'control nuevo' }, 1);

    expect(
      bd.tipos.filter((t) => t.formularioId === 8).map((t) => t.nombre),
    ).toContain('CONTROL NUEVO');
    expect(
      bd.tipos.filter((t) => t.formularioId === 2).map((t) => t.nombre),
    ).toEqual(['CONTROL PMO']);
  });

  it('el mismo nombre se permite en otro formulario y se rechaza en el mismo', async () => {
    const { servicio } = armar();

    await expect(
      servicio.crearTipoControl('PMO', { nombre: 'Control de obras' }, 1),
    ).resolves.toEqual(expect.objectContaining({ formularioId: 2 }));

    const fallo = await capturar(
      servicio.crearTipoControl('INSP', { nombre: 'Contról de Obras' }, 1),
    );
    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).message).toContain(
      'en este formulario',
    );
  });

  it('un punto repetido en la misma zonal de OTRO formulario se permite; en el mismo, 409', async () => {
    const { servicio, crearPunto } = armar();

    await servicio.crearPunto('PMO', { nombre: 'Tejar', zonalId: 2 }, 1);
    expect(crearPunto).toHaveBeenCalledWith(
      { nombre: 'Tejar', zonalId: 2, formularioId: 2 },
      CLIENTE,
    );

    expect(
      await capturar(
        servicio.crearPunto('INSP', { nombre: 'hcam', zonalId: 2 }, 1),
      ),
    ).toBeInstanceOf(ReglaNegocioError);
  });

  it('la sigla se repite en otro formulario pero no en el mismo', async () => {
    const { servicio } = armar();

    await expect(
      servicio.crearInstitucion(
        'PMO',
        { sigla: 'AMC', nombre: 'Agencia Metropolitana de Control' },
        1,
      ),
    ).resolves.toEqual(expect.objectContaining({ formularioId: 2 }));

    expect(
      await capturar(
        servicio.crearInstitucion(
          'INSP',
          { sigla: 'amc', nombre: 'Otra agencia' },
          1,
        ),
      ),
    ).toBeInstanceOf(ReglaNegocioError);
  });

  it('editar un tipo indicando un formulario que no es el suyo es 404 y no escribe', async () => {
    const { servicio, actualizarTipoControl } = armar();

    const fallo = await capturar(
      servicio.actualizarTipoControl('PMO', 301, { nombre: 'OTRO' }, 1),
    );

    expect(fallo).toBeInstanceOf(RecursoNoEncontradoError);
    expect(actualizarTipoControl).not.toHaveBeenCalled();
  });

  it('desactivar o eliminar un punto o una institución de otro formulario es 404', async () => {
    const { servicio } = armar();

    expect(
      await capturar(servicio.desactivarPunto('PMO', 101, 1)),
    ).toBeInstanceOf(RecursoNoEncontradoError);
    expect(
      await capturar(servicio.eliminarInstitucion('PMO', 401, 1)),
    ).toBeInstanceOf(RecursoNoEncontradoError);
    expect(
      await capturar(servicio.actualizarZonal('PMO', 1, { nombre: 'X' }, 1)),
    ).toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('renombrar la zonal en el formulario 8 cambia SOLO su fila: la del 2 conserva su nombre', async () => {
    const { servicio, bd, actualizarZonalDeFormulario } = armar();

    const zonal = await servicio.actualizarZonal(
      'INSP',
      2,
      { nombre: 'ZONAL NORTE CENTRO' },
      1,
    );

    expect(actualizarZonalDeFormulario).toHaveBeenCalledWith(
      12,
      { nombre: 'Zonal Norte Centro', activo: undefined },
      CLIENTE,
    );
    expect(zonal).toEqual(
      expect.objectContaining({ id: 2, nombre: 'Zonal Norte Centro' }),
    );
    expect(bd.zonales.find((z) => z.id === 21)?.nombre).toBe(
      'Zonal Eugenio Espejo',
    );
  });

  it('desactivar la zonal en el 8 arrastra SOLO sus puntos del 8; el 2 queda intacto', async () => {
    const { servicio, bd, puntosActivosDeZonalDeFormulario } = armar();

    const baja = await servicio.desactivarZonal('INSP', 2, 1);

    expect(puntosActivosDeZonalDeFormulario).toHaveBeenCalledWith(8, 2);
    expect(baja.registro.activo).toBe(false);
    expect(baja.mensaje).toContain('1 punto de encuentro');
    expect(bd.puntos.find((p) => p.id === 101)?.activo).toBe(false);
    expect(bd.puntos.find((p) => p.id === 201)?.activo).toBe(true);
    expect(bd.zonales.find((z) => z.id === 21)?.activo).toBe(true);
  });

  it('desactivar una zonal ya inactiva no vuelve a escribir', async () => {
    const { servicio, registrar } = armar({ zonalesInactivas: [12] });

    const baja = await servicio.desactivarZonal('INSP', 2, 1);

    expect(baja.mensaje).toContain('ya estaba fuera de uso');
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe('CatalogosService · alta de zonal del formulario', () => {
  it('exige una zona de la ciudad que el formulario no tenga, y guarda el nombre en formato título', async () => {
    const { servicio, crearZonalDeFormulario, registrar } = armar();

    const creada = await servicio.crearZonal(
      'INSP',
      { zonaId: 3, nombre: 'ZONAL LA DELICIA' },
      7,
    );

    expect(crearZonalDeFormulario).toHaveBeenCalledWith(
      { formularioId: 8, zonaId: 3, nombre: 'Zonal La Delicia', orden: 3 },
      CLIENTE,
    );
    expect(creada).toEqual(
      expect.objectContaining({
        id: 3,
        zonalFormularioId: 90,
        puntos: 0,
        puedeEliminar: true,
      }),
    );
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_zonal_formulario',
        accion: AccionAuditoria.CREAR,
        usuario: 7,
      }),
      CLIENTE,
    );
  });

  it('una zona que el formulario ya tiene es 409, aunque cambie el nombre', async () => {
    const { servicio, crearZonalDeFormulario } = armar();

    const fallo = await capturar(
      servicio.crearZonal('INSP', { zonaId: 2, nombre: 'Zonal Norte' }, 1),
    );

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect(crearZonalDeFormulario).not.toHaveBeenCalled();
  });

  it('el nombre no se repite en el formulario, pero sí en otro', async () => {
    const { servicio } = armar();

    expect(
      await capturar(
        servicio.crearZonal('INSP', { zonaId: 3, nombre: 'dmq' }, 1),
      ),
    ).toBeInstanceOf(ReglaNegocioError);

    await expect(
      servicio.crearZonal('PMO', { zonaId: 3, nombre: 'DMQ' }, 1),
    ).resolves.toEqual(expect.objectContaining({ id: 3 }));
  });

  it('una zona inexistente es 404 y una fuera de uso es 400', async () => {
    const { servicio } = armar();

    expect(
      await capturar(
        servicio.crearZonal('INSP', { zonaId: 99, nombre: 'Zonal X' }, 1),
      ),
    ).toBeInstanceOf(RecursoNoEncontradoError);
    expect(
      await capturar(
        servicio.crearZonal('INSP', { zonaId: 4, nombre: 'Zonal X' }, 1),
      ),
    ).toBeInstanceOf(ValidacionError);
  });
});

describe('CatalogosService · eliminar (baja física), contado en SU formulario', () => {
  it('la zonal se juzga con los operativos de ESE formulario', async () => {
    // La zona 1 tiene usos en el formulario 2, no en el 8: en el 8 se puede borrar.
    const {
      servicio,
      eliminarZonalDeFormulario,
      contarOperativosDeFormularioConZona,
    } = armar({ usos: { 'zona:2:1': 4 } });

    const respuesta = await servicio.eliminarZonal('INSP', 1, 1);

    expect(contarOperativosDeFormularioConZona).toHaveBeenCalledWith(8, 1);
    expect(eliminarZonalDeFormulario).toHaveBeenCalledWith(11, CLIENTE);
    expect(respuesta.id).toBe(1);
  });

  it('una zonal con puntos en el formulario no se borra (409)', async () => {
    const { servicio, eliminarZonalDeFormulario } = armar();

    const fallo = await capturar(servicio.eliminarZonal('INSP', 2, 1));

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).message).toContain(MOTIVO_CON_PUNTOS);
    expect(eliminarZonalDeFormulario).not.toHaveBeenCalled();
  });

  it('un tipo usado no se borra; uno sin uso sí, con su traza', async () => {
    const { servicio, eliminarTipoControl, registrar } = armar({
      usos: { '302': 1 },
    });

    expect(
      await capturar(servicio.eliminarTipoControl('PMO', 302, 1)),
    ).toBeInstanceOf(ReglaNegocioError);

    await servicio.eliminarTipoControl('INSP', 301, 1);
    expect(eliminarTipoControl).toHaveBeenCalledWith(301, CLIENTE);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_tipo_control',
        accion: AccionAuditoria.ELIMINAR,
      }),
      CLIENTE,
    );
  });
});

describe('CatalogosService · puntos y zonal vigente', () => {
  it('no se crea un punto en una zonal desactivada del formulario', async () => {
    const { servicio, crearPunto } = armar({ zonalesInactivas: [12] });

    expect(
      await capturar(
        servicio.crearPunto('INSP', { nombre: 'Nuevo', zonalId: 2 }, 1),
      ),
    ).toBeInstanceOf(ValidacionError);
    expect(crearPunto).not.toHaveBeenCalled();
  });

  it('no se mueve un punto a una zonal que su formulario no tiene', async () => {
    const { servicio } = armar();

    expect(
      await capturar(servicio.actualizarPunto('INSP', 101, { zonalId: 3 }, 1)),
    ).toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('un punto NO se reactiva mientras su zonal está desactivada', async () => {
    const { servicio, actualizarPunto } = armar({ zonalesInactivas: [12] });

    expect(
      await capturar(
        servicio.actualizarPunto('INSP', 102, { activo: true }, 1),
      ),
    ).toBeInstanceOf(ValidacionError);
    expect(actualizarPunto).not.toHaveBeenCalled();
  });

  it('comprueba el duplicado también al mover el punto de zonal', async () => {
    const { servicio, bd } = armar();
    bd.zonales.push({
      id: 13,
      formularioId: 8,
      zonaId: 3,
      nombre: 'Zonal La Delicia',
      activo: true,
      orden: 3,
    });
    bd.puntos.push({
      id: 103,
      formularioId: 8,
      zonalId: 3,
      nombre: 'HCAM',
      activo: true,
    });

    expect(
      await capturar(servicio.actualizarPunto('INSP', 101, { zonalId: 3 }, 1)),
    ).toBeInstanceOf(ReglaNegocioError);
  });
});

describe('CatalogosService · tipos de control y bajas lógicas', () => {
  it('crear y renombrar un tipo lo guarda en MAYÚSCULAS (2026-10-13)', async () => {
    const { servicio, crearTipoControl, actualizarTipoControl } = armar();

    await servicio.crearTipoControl('INSP', { nombre: 'reinspección' }, 1);
    expect(crearTipoControl).toHaveBeenCalledWith('REINSPECCIÓN', 8, CLIENTE);

    await servicio.actualizarTipoControl(
      'INSP',
      301,
      { nombre: 'control de ruido' },
      1,
    );
    expect(actualizarTipoControl).toHaveBeenCalledWith(
      301,
      { nombre: 'CONTROL DE RUIDO', activo: undefined },
      CLIENTE,
    );
  });

  it('no escribe ni audita cuando nada cambia', async () => {
    const { servicio, actualizarTipoControl, registrar } = armar();

    await servicio.actualizarTipoControl(
      'INSP',
      301,
      { nombre: 'control de obras' },
      1,
    );

    expect(actualizarTipoControl).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('RF-058 · un tipo usado se desactiva, no se borra, y lo explica', async () => {
    const { servicio } = armar({ usos: { '301': 1 } });

    const baja = await servicio.desactivarTipoControl('INSP', 301, 1);

    expect(baja.registro.activo).toBe(false);
    expect(baja.mensaje).toContain('1 operativo anterior');
  });

  it('repetir la baja no vuelve a escribir ni a auditar', async () => {
    const { servicio, registrar } = armar();

    const baja = await servicio.desactivarPunto('INSP', 102, 1);

    expect(baja.mensaje).toContain('ya estaba fuera de uso');
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe('AGREGAR punto al catálogo desde el registro (Unidad de Operativos)', () => {
  it('validarPuntoDeRegistro devuelve el nombre recortado, sin escribir', async () => {
    const { servicio, crearPunto } = armar({ puntoManual: true });

    await expect(
      servicio.validarPuntoDeRegistro('INSP', {
        nombre: '  Parque Central  ',
        zonalId: 2,
      }),
    ).resolves.toBe('Parque Central');
    expect(crearPunto).not.toHaveBeenCalled();
  });

  it('validarPuntoDeRegistro rechaza si el formulario no lo permite', async () => {
    const { servicio } = armar();

    expect(
      await capturar(
        servicio.validarPuntoDeRegistro('INSP', { nombre: 'Uno', zonalId: 2 }),
      ),
    ).toBeInstanceOf(ValidacionError);
  });

  it('validarPuntoDeRegistro rechaza una zonal que el formulario no tiene', async () => {
    const { servicio } = armar({ puntoManual: true });

    expect(
      await capturar(
        servicio.validarPuntoDeRegistro('PMO', { nombre: 'Uno', zonalId: 1 }),
      ),
    ).toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('crearPuntoEnTransaccion crea el punto en su formulario y deja traza con el cliente recibido', async () => {
    const { servicio, crearPunto, registrar } = armar();
    const otroCliente = { marca: 'registro' };

    await servicio.crearPuntoEnTransaccion(
      otroCliente as never,
      { nombre: ' Nuevo ', zonalId: 2, formularioId: 8 },
      5,
    );

    expect(crearPunto).toHaveBeenCalledWith(
      { nombre: 'Nuevo', zonalId: 2, formularioId: 8 },
      otroCliente,
    );
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_punto_encuentro',
        accion: AccionAuditoria.CREAR,
        usuario: 5,
      }),
      otroCliente,
    );
  });
});
