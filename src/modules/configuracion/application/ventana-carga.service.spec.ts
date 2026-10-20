/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: ventana-carga.service.spec.ts
 * Responsabilidad: Verificar los seis casos del plan sobre el estado y el cambio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * EL MOMENTO SE PASA COMO DATO. Ninguna prueba manipula el reloj del sistema: las
 * ventanas se evalúan contra un instante explícito. Una prueba que dependa de la hora
 * a la que se ejecuta falla sola dos veces al año, y por el peor motivo posible.
 */

import {
  AccionAuditoria,
  RolDepartamental,
  TipoVentana,
  type VentanaCarga,
} from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { VentanaCargaEvaluador } from '../../../common/auth/application/ventana-carga.evaluador';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { VentanasRepository } from '../infrastructure/ventanas.repository';
import { VentanaCargaService } from './ventana-carga.service';

const CLIENTE = { marca: 'transaccion' };

/** 2026-08-05 fue miércoles. Las horas son de Guayaquil, que es UTC-5. */
const A_LAS = (hora: string): Date =>
  new Date(`2026-08-05T${hora}:00.000-05:00`);

const ventana = (parcial: Partial<VentanaCarga>): VentanaCarga =>
  ({
    id: 1,
    rol: RolDepartamental.DMIP_OPERATIVOS,
    tipo: TipoVentana.DIARIO,
    diaApertura: null,
    horaApertura: null,
    diaCierre: null,
    horaCierre: '15:00',
    zonaHoraria: 'America/Guayaquil',
    mensajeCierre:
      'La ventana de carga de su departamento cerró a las 15H00. Vuelve a abrirse mañana.',
    activo: true,
    ...parcial,
  }) as VentanaCarga;

const SEMBRADAS = [
  ventana({ id: 1, rol: RolDepartamental.DMIP_OPERATIVOS }),
  ventana({ id: 2, rol: RolDepartamental.DMIP_INSPECCIONES }),
  ventana({ id: 3, rol: RolDepartamental.DMIT_INSTRUCTOR }),
  ventana({
    id: 4,
    rol: RolDepartamental.DAF,
    horaApertura: '15:00',
    horaCierre: '16:30',
    mensajeCierre:
      'La ventana de asignación de transporte va de 15H00 a 16H30.',
  }),
  ventana({
    id: 5,
    rol: RolDepartamental.DIRECTOR,
    horaCierre: null,
    activo: false,
    mensajeCierre: 'Sin restricción horaria.',
  }),
  ventana({
    id: 6,
    rol: RolDepartamental.ADMINISTRADOR_DMIP,
    horaCierre: null,
    activo: false,
    mensajeCierre: 'Sin restricción horaria.',
  }),
];

const armar = (filas: VentanaCarga[] = SEMBRADAS) => {
  const guardadas = [...filas];

  const listar = jest
    .fn()
    .mockImplementation(() => Promise.resolve([...guardadas]));
  const buscarPorRol = jest
    .fn()
    .mockImplementation((rol: RolDepartamental) =>
      Promise.resolve(guardadas.find((fila) => fila.rol === rol) ?? null),
    );
  const actualizar = jest
    .fn()
    .mockImplementation(
      (rol: RolDepartamental, cambios: Partial<VentanaCarga>) => {
        const indice = guardadas.findIndex((fila) => fila.rol === rol);
        guardadas[indice] = { ...guardadas[indice], ...cambios };
        return Promise.resolve(guardadas[indice]);
      },
    );
  const ejecutarEnTransaccion = jest
    .fn()
    .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
      operacion(CLIENTE),
    );

  const registrar = jest.fn().mockResolvedValue(undefined);
  const compararCambios = jest
    .fn()
    .mockImplementation(
      (anterior: Record<string, unknown>, nuevo: Record<string, unknown>) =>
        Object.entries(nuevo)
          .filter(([campo, valor]) => String(anterior[campo]) !== String(valor))
          .map(([campo, valor]) => ({
            campo,
            valorAnterior: String(anterior[campo]),
            valorNuevo: String(valor),
          })),
    );

  const servicio = new VentanaCargaService(
    {
      listar,
      buscarPorRol,
      actualizar,
      ejecutarEnTransaccion,
    } as unknown as VentanasRepository,
    new VentanaCargaEvaluador(),
    { registrar, compararCambios } as unknown as AuditoriaService,
  );

  return { servicio, listar, actualizar, registrar };
};

describe('VentanaCargaService · consulta del estado', () => {
  it('caso 1 del plan · a las 14H00 el rol departamental la tiene abierta', async () => {
    const { servicio } = armar();
    const estado = await servicio.obtenerEstado(
      RolDepartamental.DMIP_OPERATIVOS,
      A_LAS('14:00'),
    );

    expect(estado.abierta).toBe(true);
    expect(estado.horaCierre).toBe('15:00');
    expect(estado.mensaje).toContain('15H00');
  });

  it('caso 2 del plan · a las 15H30 está cerrada, con el aviso de reapertura', async () => {
    const { servicio } = armar();
    const estado = await servicio.obtenerEstado(
      RolDepartamental.DMIP_OPERATIVOS,
      A_LAS('15:30'),
    );

    expect(estado.abierta).toBe(false);
    expect(estado.mensaje).toContain('mañana');
  });

  it('caso 3 del plan · a las 15H30 la DAF la tiene abierta', async () => {
    const { servicio } = armar();
    const estado = await servicio.obtenerEstado(
      RolDepartamental.DAF,
      A_LAS('15:30'),
    );

    expect(estado.abierta).toBe(true);
  });

  it('caso 4 del plan · el resultado no depende de la zona del servidor', async () => {
    const { servicio } = armar();

    // El MISMO instante, escrito en dos husos distintos: 15H30 en Guayaquil son las
    // 22H30 en Madrid. La ventana se evalúa en la zona que declara, no en la del proceso.
    const enGuayaquil = await servicio.obtenerEstado(
      RolDepartamental.DMIP_OPERATIVOS,
      new Date('2026-08-05T15:30:00.000-05:00'),
    );
    const mismoInstante = await servicio.obtenerEstado(
      RolDepartamental.DMIP_OPERATIVOS,
      new Date('2026-08-05T22:30:00.000+02:00'),
    );

    expect(enGuayaquil.abierta).toBe(false);
    expect(mismoInstante.abierta).toBe(false);
    expect(mismoInstante.zonaHoraria).toBe('America/Guayaquil');
  });

  it('caso 6 del plan · una ventana desactivada no restringe el horario', async () => {
    const { servicio } = armar();

    const madrugada = await servicio.obtenerEstado(
      RolDepartamental.DIRECTOR,
      A_LAS('03:00'),
    );

    expect(madrugada.abierta).toBe(true);
    expect(madrugada.activo).toBe(false);
    expect(madrugada.mensaje).toContain('no tiene restricción horaria');
  });

  it('un rol sin ventana configurada tampoco queda restringido', async () => {
    const { servicio } = armar([]);
    const estado = await servicio.obtenerEstado(
      RolDepartamental.DAF,
      A_LAS('23:00'),
    );

    expect(estado.abierta).toBe(true);
    expect(estado.activo).toBe(false);
  });

  it('`puedeEscribir` responde lo mismo que el estado, para M-13', async () => {
    const { servicio } = armar();

    expect(
      await servicio.puedeEscribir(
        RolDepartamental.DMIP_OPERATIVOS,
        A_LAS('14:00'),
      ),
    ).toBe(true);
    expect(
      await servicio.puedeEscribir(
        RolDepartamental.DMIP_OPERATIVOS,
        A_LAS('15:30'),
      ),
    ).toBe(false);
  });

  describe('caché', () => {
    it('consulta la base una sola vez para varias lecturas', async () => {
      const { servicio, listar } = armar();

      await servicio.obtenerEstado(RolDepartamental.DAF, A_LAS('15:30'));
      await servicio.obtenerEstado(RolDepartamental.DIRECTOR, A_LAS('15:30'));
      await servicio.puedeEscribir(RolDepartamental.DAF, A_LAS('15:30'));

      expect(listar).toHaveBeenCalledTimes(1);
    });

    it('caso 5 del plan · tras cambiar la hora, el comportamiento cambia sin reiniciar', async () => {
      const { servicio } = armar();

      expect(
        await servicio.puedeEscribir(
          RolDepartamental.DMIP_OPERATIVOS,
          A_LAS('14:30'),
        ),
      ).toBe(true);

      await servicio.actualizar(
        RolDepartamental.DMIP_OPERATIVOS,
        { horaCierre: '14:00' },
        6,
      );

      expect(
        await servicio.puedeEscribir(
          RolDepartamental.DMIP_OPERATIVOS,
          A_LAS('14:30'),
        ),
      ).toBe(false);
    });
  });
});

describe('VentanaCargaService · administración', () => {
  it('rechaza una hora mal escrita sin tocar la base', async () => {
    const { servicio, actualizar } = armar();

    await expect(
      servicio.actualizar(
        RolDepartamental.DMIP_OPERATIVOS,
        { horaCierre: '25:00' },
        6,
      ),
    ).rejects.toBeInstanceOf(ValidacionError);
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('rechaza un rol sin ventana configurada con 404', async () => {
    const { servicio } = armar([]);

    await expect(
      servicio.actualizar(RolDepartamental.DAF, { horaCierre: '16:00' }, 6),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
  });

  it('audita el cambio dentro de la transacción, nombrando la columna', async () => {
    const { servicio, registrar } = armar();

    await servicio.actualizar(
      RolDepartamental.DMIP_OPERATIVOS,
      { horaCierre: '14:00' },
      6,
    );

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_ventana_carga',
        entidadId: 1,
        accion: AccionAuditoria.ACTUALIZAR,
        usuario: 6,
        cambios: [
          {
            campo: 'vcar_hora_cierre',
            valorAnterior: '15:00',
            valorNuevo: '14:00',
          },
        ],
      }),
      CLIENTE,
    );
  });

  it('no escribe ni audita cuando nada cambia', async () => {
    const { servicio, actualizar, registrar } = armar();

    const resultado = await servicio.actualizar(
      RolDepartamental.DMIP_OPERATIVOS,
      { horaCierre: '15:00' },
      6,
    );

    expect(actualizar).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
    expect(resultado.ventana.horaCierre).toBe('15:00');
  });

  /*
    PARAMETRIZACIÓN INDEPENDIENTE (2026-10-08). La pantalla solo parametriza; la coherencia entre
    ventanas la aplica el sistema en ejecución. Al guardar no se lee ninguna otra ventana —`listar`
    no se llama— ni `HORA_LIMITE_CUADRO`, y la respuesta ya no trae advertencias.
  */
  it('guarda DMIP con cierre 12:55 aunque la DAF abra a las 11:44, sin mirar otras ventanas', async () => {
    const dafTemprana = SEMBRADAS.map((fila) =>
      fila.rol === RolDepartamental.DAF
        ? { ...fila, horaApertura: '11:44', horaCierre: '11:50' }
        : fila,
    );
    const { servicio, actualizar, listar } = armar(dafTemprana);

    const resultado = await servicio.actualizar(
      RolDepartamental.DMIP_OPERATIVOS,
      { horaCierre: '12:55' },
      6,
    );

    expect(actualizar).toHaveBeenCalled();
    expect(resultado.ventana.horaCierre).toBe('12:55');
    expect(resultado).toEqual({ ventana: resultado.ventana });
    expect(listar).not.toHaveBeenCalled();
  });

  it.each([
    ['abre antes de que cierre el registro', '11:44', '11:50'],
    ['abre después del cierre del registro', '15:30', '16:30'],
    ['cierra después de la hora límite del cuadro', '15:00', '20:00'],
  ])(
    'guarda la DAF con cualquier horario válido (%s)',
    async (_caso, horaApertura, horaCierre) => {
      const { servicio, actualizar, listar } = armar();

      const resultado = await servicio.actualizar(
        RolDepartamental.DAF,
        { horaApertura, horaCierre },
        6,
      );

      expect(actualizar).toHaveBeenCalled();
      expect(resultado.ventana.horaApertura).toBe(horaApertura);
      expect(resultado.ventana.horaCierre).toBe(horaCierre);
      expect(listar).not.toHaveBeenCalled();
    },
  );

  it('mover el cierre de un departamento más allá de la apertura de la DAF también se guarda', async () => {
    const { servicio, actualizar } = armar();

    await servicio.actualizar(
      RolDepartamental.DMIP_OPERATIVOS,
      { horaCierre: '16:00' },
      6,
    );

    expect(actualizar).toHaveBeenCalled();
  });

  it('estado · el horario sale de las horas reales y el texto libre va como nota', async () => {
    const conTextoViejo = SEMBRADAS.map((fila) =>
      fila.rol === RolDepartamental.DAF
        ? { ...fila, mensajeCierre: 'Texto viejo: va de 09H00 a 10H00.' }
        : fila,
    );
    const { servicio } = armar(conTextoViejo);

    const estado = await servicio.obtenerEstado(
      RolDepartamental.DAF,
      A_LAS('14:00'),
    );
    expect(estado.abierta).toBe(false);
    expect(estado.horarioTexto).toBe(
      'La ventana de asignación de transporte abre a las 15H00, cuando cierra el registro de operativos, y cierra a las 16H30.',
    );
    expect(estado.motivoApertura).toBe(
      'cuando cierra el registro de operativos',
    );
    expect(estado.mensaje).toBe(estado.horarioTexto);
    expect(estado.mensaje).not.toContain('09H00');
    expect(estado.notaAdministrador).toBe('Texto viejo: va de 09H00 a 10H00.');
  });

  it('cambiar solo el mensaje se guarda tal cual', async () => {
    const { servicio } = armar();
    const resultado = await servicio.actualizar(
      RolDepartamental.DMIT_INSTRUCTOR,
      {
        horaCierre: '15:00',
        mensajeCierre: 'Otro mensaje de cierre distinto.',
      },
      6,
    );

    expect(resultado.ventana.mensajeCierre).toBe(
      'Otro mensaje de cierre distinto.',
    );
  });

  it('desactivar la ventana se guarda sin advertencias', async () => {
    const { servicio, actualizar } = armar();

    const resultado = await servicio.actualizar(
      RolDepartamental.DMIP_INSPECCIONES,
      { activo: false },
      6,
    );

    expect(actualizar).toHaveBeenCalled();
    expect(resultado).not.toHaveProperty('advertencias');
  });
});

/** 2026-10-07: el tipo manda y `activo` se deriva; el estado resuelve los marcadores. */
describe('VentanaCargaService · tipos y marcadores (2026-10-07)', () => {
  it('«sin restricción» escribe el tipo y deja la ventana inactiva', async () => {
    const { servicio, actualizar } = armar();

    await servicio.actualizar(
      RolDepartamental.DMIP_OPERATIVOS,
      { tipo: TipoVentana.SIN_RESTRICCION },
      6,
    );

    expect(actualizar).toHaveBeenCalledWith(
      RolDepartamental.DMIP_OPERATIVOS,
      expect.objectContaining({
        tipo: TipoVentana.SIN_RESTRICCION,
        activo: false,
      }),
      CLIENTE,
    );
  });

  it('volver a DIARIO la deja activa', async () => {
    const { servicio, actualizar } = armar([
      ventana({
        tipo: TipoVentana.SIN_RESTRICCION,
        activo: false,
        horaCierre: '15:00',
      }),
    ]);

    await servicio.actualizar(
      RolDepartamental.DMIP_OPERATIVOS,
      { tipo: TipoVentana.DIARIO },
      6,
    );

    expect(actualizar).toHaveBeenCalledWith(
      RolDepartamental.DMIP_OPERATIVOS,
      expect.objectContaining({ tipo: TipoVentana.DIARIO, activo: true }),
      CLIENTE,
    );
  });

  it('rechaza un cierre que no es posterior a la apertura, sin tocar la base', async () => {
    const { servicio, actualizar } = armar();

    await expect(
      servicio.actualizar(
        RolDepartamental.DMIP_OPERATIVOS,
        { horaApertura: '16:00' },
        6,
      ),
    ).rejects.toThrow('La hora de cierre debe ser posterior a la de apertura.');
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('con la ventana cerrada, el estado muestra el mensaje con {cierre} resuelto', async () => {
    const { servicio } = armar([
      ventana({
        horaCierre: '15:00',
        mensajeCierre: 'Cerró a las {cierre}. Vuelve mañana.',
      }),
    ]);

    const estado = await servicio.obtenerEstado(
      RolDepartamental.DMIP_OPERATIVOS,
      A_LAS('16:00'),
    );

    expect(estado.abierta).toBe(false);
    expect(estado.mensaje).toBe('Cerró a las 15H00. Vuelve mañana.');
  });

  it('si el mensaje dice una hora que no es, el funcionario lee la hora real', async () => {
    const { servicio } = armar([
      ventana({
        horaCierre: '15:00',
        mensajeCierre: 'Cerró a las 18H25. Vuelve mañana.',
      }),
    ]);

    const estado = await servicio.obtenerEstado(
      RolDepartamental.DMIP_OPERATIVOS,
      A_LAS('16:00'),
    );

    expect(estado.mensaje).toContain('15H00');
    expect(estado.mensaje).not.toContain('18H25');
  });
});
