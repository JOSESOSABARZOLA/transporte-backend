/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · ocupación por tramos
 * Archivo: tramos-desde-asignacion-clasica.logica.spec.ts
 * Responsabilidad: Fijar que el paso a tramos solo lee en modo reporte, escribe con traza y es idempotente.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-14
 */
import {
  ejecutarTramosClasicos,
  leerOpciones,
  type ClienteTramosClasicos,
} from './tramos-desde-asignacion-clasica.logica';

const FECHA = new Date(Date.UTC(2026, 9, 15));

interface OperativoFalso {
  id: number;
  identificador: string;
  horaInicio: string;
  horaFin: string;
  tipoTransporte: string;
  conductorId: number;
  vehiculoId: number;
  cuadro: { fecha: Date };
  zonales: { zonalId: number }[];
  _count: { tramos: number };
}

/** Una base en memoria: aplicar «asigna» los tramos y el operativo deja de salir en la consulta. */
function baseFalsa(operativos: OperativoFalso[]) {
  const pendientes = [...operativos];
  const creados: Record<string, unknown>[] = [];
  const trazas: Record<string, unknown>[] = [];
  const borrados: number[] = [];
  const transaccion = jest.fn();
  const tx = {
    tramoTransporte: {
      deleteMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { operativoId: number } }) => {
          borrados.push(where.operativoId);
          return Promise.resolve({ count: 0 });
        }),
      createMany: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown>[] }) => {
          creados.push(...data);
          for (const fila of data) {
            const i = pendientes.findIndex((o) => o.id === fila.operativoId);
            if (i >= 0) pendientes.splice(i, 1);
          }
          return Promise.resolve({ count: data.length });
        }),
    },
    auditoria: {
      createMany: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown>[] }) => {
          trazas.push(...data);
          return Promise.resolve({ count: data.length });
        }),
    },
  };
  const db = {
    operativo: {
      findMany: jest
        .fn()
        .mockImplementation(() => Promise.resolve([...pendientes])),
    },
    parametroPolitica: {
      findMany: jest.fn().mockResolvedValue([
        { clave: 'DAF_DURACION_TRAMO_MIN', valor: '30' },
        { clave: 'DAF_DURACION_DEJAR_MIN', valor: '20' },
      ]),
    },
    usuario: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
    $transaction: transaccion.mockImplementation(
      (operacion: (cliente: typeof tx) => Promise<unknown>) => operacion(tx),
    ),
  } as unknown as ClienteTramosClasicos;
  return { db, creados, trazas, borrados, transaccion };
}

const operativo = (
  id: number,
  cambios: Partial<OperativoFalso> = {},
): OperativoFalso => ({
  id,
  identificador: `OCPMO-00${id}`,
  horaInicio: '08:00',
  horaFin: '16:00',
  tipoTransporte: 'INICIO_Y_FIN',
  conductorId: 7,
  vehiculoId: 80,
  cuadro: { fecha: FECHA },
  zonales: [{ zonalId: 3 }],
  _count: { tramos: 0 },
  ...cambios,
});

describe('tramos desde la asignación clásica', () => {
  it('sin --aplicar solo reporta: no abre transacción ni escribe', async () => {
    const { db, transaccion } = baseFalsa([operativo(1)]);
    const salida: string[] = [];

    const resultado = await ejecutarTramosClasicos(
      db,
      leerOpciones([]),
      (texto) => salida.push(texto),
    );

    expect(resultado).toBeNull();
    expect(transaccion).not.toHaveBeenCalled();
    expect(salida.join('\n')).toContain('Operativos asignados sin tramos: 1');
    // Dejar con su parámetro propio (20) y retirar con el general (30).
    expect(salida.join('\n')).toContain(
      'DEJAR 08:00-08:20, RETIRAR 15:30-16:00',
    );
  });

  it('con --aplicar crea los tramos con ese conductor y vehículo, con su traza', async () => {
    const { db, creados, trazas, borrados } = baseFalsa([
      operativo(1, { _count: { tramos: 1 } }),
    ]);

    const aplicados = await ejecutarTramosClasicos(
      db,
      leerOpciones(['--aplicar', '--usuario=1']),
      () => undefined,
    );

    expect(aplicados).toBe(1);
    // Los tramos sin conductor que tuviera se reemplazan.
    expect(borrados).toEqual([1]);
    expect(creados).toEqual([
      expect.objectContaining({
        tipo: 'DEJAR',
        conductorId: 7,
        vehiculoId: 80,
      }),
      expect.objectContaining({
        tipo: 'RETIRAR',
        conductorId: 7,
        vehiculoId: 80,
      }),
    ]);
    expect(trazas.length).toBeGreaterThan(0);
    expect(
      trazas.every(
        (t) =>
          String(t.correlacion).startsWith('tramos-clasicos-') &&
          t.rol === 'ADMINISTRADOR',
      ),
    ).toBe(true);
  });

  it('es idempotente: la segunda corrida no encuentra nada que aplicar', async () => {
    const { db } = baseFalsa([operativo(1)]);
    await ejecutarTramosClasicos(
      db,
      leerOpciones(['--aplicar', '--usuario=1']),
      () => undefined,
    );
    const salida: string[] = [];

    const segunda = await ejecutarTramosClasicos(
      db,
      leerOpciones(['--aplicar', '--usuario=1']),
      (texto) => salida.push(texto),
    );

    expect(segunda).toBeNull();
    expect(salida).toContain('Nada que aplicar.');
  });

  it('un operativo de propios medios con conductor se reporta como «requiere decisión» y no se toca', async () => {
    const { db, creados } = baseFalsa([
      operativo(1, { tipoTransporte: 'PROPIOS_MEDIOS' }),
    ]);
    const salida: string[] = [];

    await ejecutarTramosClasicos(
      db,
      leerOpciones(['--aplicar', '--usuario=1']),
      (texto) => salida.push(texto),
    );

    expect(creados).toEqual([]);
    expect(salida.join('\n')).toContain('Requieren decisión');
    expect(salida.join('\n')).toContain('OCPMO-001');
  });

  it('para aplicar exige quién firma la traza', async () => {
    const { db } = baseFalsa([operativo(1)]);

    await expect(
      ejecutarTramosClasicos(db, leerOpciones(['--aplicar']), () => undefined),
    ).rejects.toThrow('--usuario');
  });
});
