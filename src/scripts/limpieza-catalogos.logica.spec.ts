/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: limpieza-catalogos.logica.spec.ts
 * Responsabilidad: Fijar que la limpieza de catálogos solo lee en modo reporte y es idempotente.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-13
 */
import {
  type ClienteLimpieza,
  ejecutarLimpieza,
  esZonalSospechosa,
  leerOpciones,
  planificarLimpieza,
} from './limpieza-catalogos.logica';

interface PuntoFalso {
  id: number;
  nombre: string;
  activo: boolean;
  formularioId: number;
  operativos: number;
}
interface ZonalFalsa {
  id: number;
  codigo: string;
  nombre: string;
  esDmq: boolean;
  activo: boolean;
  fichas: number;
  puntos: PuntoFalso[];
}

/** Una base en memoria: las lecturas leen los arreglos y las escrituras los modifican. */
function baseFalsa(datos: {
  zonales: ZonalFalsa[];
  /** Zonales de formulario; `null` = la tabla aún no existe (migración sin aplicar). */
  zonalesFormulario?:
    | { id: number; formularioId: number; zonaId: number; nombre: string }[]
    | null;
  tipos: { id: number; formularioId: number; nombre: string }[];
  instituciones: {
    id: number;
    formularioId: number;
    sigla: string;
    nombre: string;
  }[];
}) {
  const conteo = (z: ZonalFalsa) => ({
    operativos: 0,
    funcionarios: z.fichas,
    ubicaciones: 0,
    tramosDesde: 0,
    tramosHacia: 0,
    trasladosDesde: 0,
    trasladosHacia: 0,
    talleres: 0,
  });
  const escrituras = {
    tipoUpdate: jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: number };
        data: { nombre: string };
      }) => {
        const t = datos.tipos.find((x) => x.id === where.id);
        if (t) t.nombre = data.nombre;
        return Promise.resolve(t);
      },
    ),
    institucionUpdate: jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: number };
        data: { nombre?: string; sigla?: string };
      }) => {
        const i = datos.instituciones.find((x) => x.id === where.id);
        if (i && data.nombre !== undefined) i.nombre = data.nombre;
        if (i && data.sigla !== undefined) i.sigla = data.sigla;
        return Promise.resolve(i);
      },
    ),
    puntoDeleteMany: jest.fn(({ where }: { where: { zonalId: number } }) => {
      const z = datos.zonales.find((x) => x.id === where.zonalId);
      if (z) z.puntos = [];
      return Promise.resolve({ count: 0 });
    }),
    zonalDelete: jest.fn(({ where }: { where: { id: number } }) => {
      datos.zonales = datos.zonales.filter((x) => x.id !== where.id);
      return Promise.resolve({});
    }),
    zonalUpdate: jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: number };
        data: { nombre: string };
      }) => {
        const z = datos.zonales.find((x) => x.id === where.id);
        if (z) z.nombre = data.nombre;
        return Promise.resolve(z);
      },
    ),
    zofoUpdate: jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: number };
        data: { nombre: string };
      }) => {
        const z = (datos.zonalesFormulario ?? []).find(
          (x) => x.id === where.id,
        );
        if (z) z.nombre = data.nombre;
        return Promise.resolve(z);
      },
    ),
    zofoDeleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    auditoria: jest.fn(() => Promise.resolve({})),
    operativosUpdate: jest.fn(() => Promise.resolve({ count: 2 })),
    fichasUpdate: jest.fn(() => Promise.resolve({ count: 0 })),
  };
  const tx = {
    tipoControl: { update: escrituras.tipoUpdate },
    institucion: { update: escrituras.institucionUpdate },
    puntoEncuentro: { deleteMany: escrituras.puntoDeleteMany },
    zonal: {
      delete: escrituras.zonalDelete,
      update: escrituras.zonalUpdate,
      findUnique: jest.fn(() => Promise.resolve(null)),
    },
    zonalFormulario: {
      update: escrituras.zofoUpdate,
      deleteMany: escrituras.zofoDeleteMany,
      upsert: jest.fn(),
    },
    auditoria: { create: escrituras.auditoria },
    operativo: {
      findMany: jest.fn(() => Promise.resolve([{ id: 501 }, { id: 502 }])),
      updateMany: escrituras.operativosUpdate,
    },
    operativoZonal: {
      findMany: jest.fn(() => Promise.resolve([])),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    funcionario: { updateMany: escrituras.fichasUpdate },
    ubicacionFlota: { updateMany: jest.fn() },
    tramoTransporte: { updateMany: jest.fn() },
    disponibilidad: { updateMany: jest.fn() },
  };
  const transaccion = jest.fn((fn: (cliente: typeof tx) => Promise<unknown>) =>
    fn(tx),
  );

  const leerZonalesFormulario = jest.fn(() =>
    Promise.resolve(datos.zonalesFormulario ?? []),
  );
  const db = {
    $transaction: transaccion,
    $queryRaw: jest.fn(() =>
      Promise.resolve([{ existe: datos.zonalesFormulario !== null }]),
    ),
    zonalFormulario: { findMany: leerZonalesFormulario },
    zonal: {
      findMany: jest.fn(() =>
        Promise.resolve(
          datos.zonales.map((z) => ({
            ...z,
            _count: conteo(z),
            puntos: z.puntos.map((p) => ({
              ...p,
              formulario: { numero: p.formularioId },
              _count: { operativos: p.operativos },
            })),
          })),
        ),
      ),
    },
    tipoControl: { findMany: jest.fn(() => Promise.resolve(datos.tipos)) },
    institucion: {
      findMany: jest.fn(() => Promise.resolve(datos.instituciones)),
    },
    usuario: { findUnique: jest.fn(() => Promise.resolve({ id: 1 })) },
  } as unknown as ClienteLimpieza;

  return { db, escrituras, transaccion, leerZonalesFormulario };
}

const PUNTO = (id: number, formularioId = 1, operativos = 0): PuntoFalso => ({
  id,
  nombre: `Punto ${id}`,
  activo: false,
  formularioId,
  operativos,
});

const datosDeDesarrollo = () => ({
  zonales: [
    {
      id: 1,
      codigo: 'EUGENIO_ESPEJO',
      nombre: 'Zonal Eugenio Espejo',
      esDmq: false,
      activo: true,
      fichas: 3,
      puntos: [],
    },
    {
      id: 11,
      codigo: 'DMQ',
      nombre: 'DMQ',
      esDmq: true,
      activo: true,
      fichas: 0,
      puntos: [],
    },
    {
      id: 212,
      codigo: 'HOSPITAL_CARLOS_ANDRADE_MARIN',
      nombre: 'HOSPITAL CARLOS ANDRADE MARIN',
      esDmq: false,
      activo: false,
      fichas: 0,
      puntos: [PUNTO(723)],
    },
    {
      id: 214,
      codigo: 'PATRULLA_MOVIL_2',
      nombre: 'PATRULLA MOVIL 2',
      esDmq: false,
      activo: false,
      fichas: 2,
      puntos: [PUNTO(728, 3)],
    },
  ],
  tipos: [
    { id: 9, formularioId: 4, nombre: 'Alertas ECU 911' },
    { id: 10, formularioId: 4, nombre: 'CONTROL LIBADORES' },
    { id: 15, formularioId: 7, nombre: 'Quito en Control' },
    { id: 16, formularioId: 7, nombre: 'QUITO EN CONTROL' },
  ],
  instituciones: [
    { id: 1, formularioId: 1, sigla: 'AMC', nombre: 'AMC' },
    { id: 2, formularioId: 1, sigla: 'CACMQ', nombre: 'CACMQ' },
    { id: 3, formularioId: 7, sigla: 'EMGIRS', nombre: 'EMGIRS' },
    {
      id: 4,
      formularioId: 7,
      sigla: 'Cuerpo de Bomberos de Quito',
      nombre: 'Cuerpo de Bomberos de Quito',
    },
    { id: 5, formularioId: 9, sigla: 'CBQ', nombre: 'Bomberos' },
    {
      id: 6,
      formularioId: 1,
      sigla: 'Secretaría de Seguridad',
      nombre: 'Secretaría de Seguridad',
    },
    // Sin sigla decidida por negocio: no se toca.
    { id: 7, formularioId: 7, sigla: 'Migración', nombre: 'Migración' },
  ],
  zonalesFormulario: [
    { id: 1, formularioId: 1, zonaId: 1, nombre: 'Zonal Eugenio Espejo' },
    { id: 2, formularioId: 2, zonaId: 1, nombre: 'ZONAL EUGENIO ESPEJO' },
  ] as
    | { id: number; formularioId: number; zonaId: number; nombre: string }[]
    | null,
});

const silencio = () => undefined;

describe('esZonalSospechosa', () => {
  it('marca el nombre de un lugar en mayúsculas, no las zonales ni el DMQ', () => {
    expect(esZonalSospechosa({ nombre: 'CAJA DEL SEGURO', esDmq: false })).toBe(
      true,
    );
    expect(
      esZonalSospechosa({ nombre: 'Zonal La Delicia', esDmq: false }),
    ).toBe(false);
    expect(esZonalSospechosa({ nombre: 'ZONAL NORTE', esDmq: false })).toBe(
      false,
    );
    expect(esZonalSospechosa({ nombre: 'DMQ', esDmq: true })).toBe(false);
  });
});

describe('planificarLimpieza', () => {
  it('propone eliminar lo que nunca se usó y deja «requiere decisión» lo usado sin destino', async () => {
    const { db } = baseFalsa(datosDeDesarrollo());
    const plan = await planificarLimpieza(db);

    expect(plan.zonales.map((z) => [z.id, z.accion])).toEqual([
      [212, 'ELIMINAR'],
      [214, 'REQUIERE_DECISION'],
    ]);
  });

  it('pasa los tipos a mayúsculas y salta el que chocaría con el único del formulario', async () => {
    const { db } = baseFalsa(datosDeDesarrollo());
    const plan = await planificarLimpieza(db);

    expect(plan.tipos).toEqual([
      {
        id: 9,
        formularioId: 4,
        anterior: 'Alertas ECU 911',
        nuevo: 'ALERTAS ECU 911',
      },
    ]);
    expect(plan.tiposSaltados.map((s) => s.id)).toEqual([15]);
  });

  it('carga solo lo decidido por negocio: denominaciones donde repiten la sigla y siglas cortas', async () => {
    const { db } = baseFalsa(datosDeDesarrollo());
    const plan = await planificarLimpieza(db);

    expect(plan.instituciones.map((i) => [i.id, i.campo, i.nuevo])).toEqual([
      [1, 'nombre', 'Agencia Metropolitana de Control'],
      [2, 'nombre', 'Cuerpo de Agentes de Control Metropolitano de Quito'],
      [
        3,
        'nombre',
        'Empresa Pública Metropolitana de Gestión Integral de Residuos Sólidos',
      ],
      [4, 'sigla', 'CBQ'],
      [6, 'sigla', 'SS'],
    ]);
  });

  it('salta la sigla corta que chocaría con otra del mismo formulario', async () => {
    const datos = datosDeDesarrollo();
    datos.instituciones.push({
      id: 8,
      formularioId: 7,
      sigla: 'CBQ',
      nombre: 'Bomberos',
    });
    const { db } = baseFalsa(datos);
    const plan = await planificarLimpieza(db);

    expect(plan.institucionesSaltadas.map((s) => [s.id, s.campo])).toEqual([
      [4, 'sigla'],
    ]);
  });

  it('pasa a formato título las zonales DE CADA FORMULARIO, sin tocar la de otro', async () => {
    const { db } = baseFalsa(datosDeDesarrollo());
    const plan = await planificarLimpieza(db);

    expect(plan.zonalesTituloPendiente).toBe(false);
    expect(plan.zonalesTitulo).toEqual([
      {
        id: 2,
        formularioId: 2,
        anterior: 'ZONAL EUGENIO ESPEJO',
        nuevo: 'Zonal Eugenio Espejo',
      },
    ]);
  });

  it('antes de la migración la parte d) queda pendiente y no lee la tabla', async () => {
    const datos = { ...datosDeDesarrollo(), zonalesFormulario: null };
    const { db, leerZonalesFormulario } = baseFalsa(datos);
    const plan = await planificarLimpieza(db);

    expect(plan.zonalesTituloPendiente).toBe(true);
    expect(plan.zonalesTitulo).toEqual([]);
    expect(leerZonalesFormulario).not.toHaveBeenCalled();
  });
});

describe('ejecutarLimpieza', () => {
  it('en modo REPORTE no llama a ninguna escritura ni abre transacción', async () => {
    const { db, escrituras, transaccion } = baseFalsa(datosDeDesarrollo());

    const resumen = await ejecutarLimpieza(
      db,
      leerOpciones(['--incluir-zonales']),
      silencio,
    );

    expect(resumen).toBeNull();
    expect(transaccion).not.toHaveBeenCalled();
    for (const escritura of Object.values(escrituras)) {
      expect(escritura).not.toHaveBeenCalled();
    }
  });

  it('sin --incluir-zonales aplica tipos e instituciones pero no toca zonales', async () => {
    const { db, escrituras } = baseFalsa(datosDeDesarrollo());

    const resumen = await ejecutarLimpieza(
      db,
      leerOpciones(['--aplicar', '--usuario=1']),
      silencio,
    );

    expect(resumen).toEqual(
      expect.objectContaining({
        tipos: 1,
        instituciones: 5,
        zonalesEliminadas: 0,
        zonalesRenombradas: 0,
      }),
    );
    expect(escrituras.zonalDelete).not.toHaveBeenCalled();
    expect(escrituras.puntoDeleteMany).not.toHaveBeenCalled();
    expect(escrituras.zofoUpdate).not.toHaveBeenCalled();
    expect(escrituras.institucionUpdate).toHaveBeenCalledWith({
      where: { id: 6 },
      data: { sigla: 'SS' },
    });
  });

  it('con --incluir-zonales elimina la que nunca se usó y NO toca la usada sin destino', async () => {
    const { db, escrituras } = baseFalsa(datosDeDesarrollo());

    await ejecutarLimpieza(
      db,
      leerOpciones(['--aplicar', '--incluir-zonales', '--usuario=1']),
      silencio,
    );

    expect(escrituras.zonalDelete).toHaveBeenCalledTimes(1);
    expect(escrituras.zonalDelete).toHaveBeenCalledWith({ where: { id: 212 } });
    // Sus zonales de formulario se borran con ella; la zonal de formulario 2 pasa a título.
    expect(escrituras.zofoDeleteMany).toHaveBeenCalledWith({
      where: { zonaId: 212 },
    });
    expect(escrituras.zofoUpdate).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { nombre: 'Zonal Eugenio Espejo' },
    });
  });

  it('fusiona la zonal usada que tiene destino: sus operativos pasan al punto equivalente', async () => {
    const datos = datosDeDesarrollo();
    datos.zonales[0].puntos = [
      {
        id: 87,
        nombre: 'KFC - Caja del Seguro',
        activo: true,
        formularioId: 1,
        operativos: 0,
      },
    ];
    datos.zonales.push({
      id: 213,
      codigo: 'CAJA_DEL_SEGURO',
      nombre: 'CAJA DEL SEGURO',
      esDmq: false,
      activo: false,
      fichas: 0,
      puntos: [PUNTO(724, 1, 2)],
    });
    const { db, escrituras } = baseFalsa(datos);

    const resumen = await ejecutarLimpieza(
      db,
      leerOpciones(['--aplicar', '--incluir-zonales', '--usuario=1']),
      silencio,
    );

    expect(resumen?.zonalesFusionadas).toBe(1);
    expect(escrituras.operativosUpdate).toHaveBeenCalledWith({
      where: { puntoEncuentroId: 724 },
      data: { puntoEncuentroId: 87 },
    });
    expect(escrituras.fichasUpdate).toHaveBeenCalledWith({
      where: { zonalId: 213 },
      data: { zonalId: 1 },
    });
    expect(escrituras.zonalDelete).toHaveBeenCalledWith({ where: { id: 213 } });
  });

  it('es idempotente: la segunda corrida no encuentra nada que aplicar', async () => {
    const { db, transaccion } = baseFalsa(datosDeDesarrollo());
    const opciones = leerOpciones([
      '--aplicar',
      '--incluir-zonales',
      '--usuario=1',
    ]);

    await ejecutarLimpieza(db, opciones, silencio);
    const segunda = await ejecutarLimpieza(db, opciones, silencio);

    expect(segunda).toBeNull();
    expect(transaccion).toHaveBeenCalledTimes(1);
  });

  it('aplicar exige el usuario que firma la traza', async () => {
    const { db, transaccion } = baseFalsa(datosDeDesarrollo());

    await expect(
      ejecutarLimpieza(db, leerOpciones(['--aplicar']), silencio),
    ).rejects.toThrow('--usuario=<id>');
    expect(transaccion).not.toHaveBeenCalled();
  });
});
