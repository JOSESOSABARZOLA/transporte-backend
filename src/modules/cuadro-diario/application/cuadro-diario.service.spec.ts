/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Cuadro diario
 * Archivo: cuadro-diario.service.spec.ts
 * Responsabilidad: Verificar la apertura, el avance por ventanas, el cierre y la reapertura.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import {
  AccionAuditoria,
  EstadoCuadro,
  RolDepartamental,
  type CuadroDiario,
} from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type { VentanaCargaService } from '../../configuracion/application/ventana-carga.service';
import type { HistorialJornadaService } from '../../talento-operativo/application/historial-jornada.service';
import type {
  CuadroDiarioRepository,
  OperativoSinAporte,
  OperativoSinTransporte,
} from '../infrastructure/cuadro-diario.repository';
import { CuadroDiarioService } from './cuadro-diario.service';

const CLIENTE = { marca: 'transaccion' };
const dia = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);
const MIERCOLES = dia('2026-08-05');

const cuadro = (parcial: Partial<CuadroDiario> = {}): CuadroDiario =>
  ({
    id: 1,
    fecha: MIERCOLES,
    ordenTrabajo: 'OT-PRUEBA-001',
    nroSemana: 32,
    anioSemana: 2026,
    estado: EstadoCuadro.BORRADOR,
    cerradoPor: null,
    cerradoEn: null,
    reaperturas: 0,
    creadoEn: new Date(),
    ...parcial,
  }) as CuadroDiario;

const armar = (
  opciones: {
    existente?: CuadroDiario | null;
    departamentalAbierta?: boolean;
    transporteAbierta?: boolean;
    ventanasActivas?: boolean;
    pendientes?: OperativoSinTransporte[];
    /** Patrullas compartidas sin el aporte del departamento que lo pone. */
    sinAporte?: OperativoSinAporte[];
  } = {},
) => {
  const {
    existente = null,
    departamentalAbierta = false,
    transporteAbierta = false,
    ventanasActivas = true,
    pendientes = [],
    sinAporte = [],
  } = opciones;

  let guardado = existente;

  const crear = jest.fn().mockImplementation((datos: Partial<CuadroDiario>) => {
    guardado = cuadro(datos);
    return Promise.resolve(guardado);
  });

  const actualizarEstado = jest
    .fn()
    .mockImplementation((_fecha: Date, datos: Partial<CuadroDiario>) => {
      guardado = { ...(guardado as CuadroDiario), ...datos };
      return Promise.resolve(guardado);
    });

  const registrar = jest.fn().mockResolvedValue(undefined);
  const consolidarJornada = jest.fn().mockResolvedValue({ personas: 0 });
  const log = jest.fn();
  const warn = jest.fn();

  // Se devuelven ventanas ACTIVAS: lo que se está probando aquí es el horario, no la
  // desactivación. El caso de la ventana desactivada tiene su propia prueba.
  const obtenerEstado = jest.fn().mockImplementation((rol: RolDepartamental) =>
    Promise.resolve({
      rol,
      activo: ventanasActivas,
      abierta:
        rol === RolDepartamental.DAF ? transporteAbierta : departamentalAbierta,
    }),
  );

  const servicio = new CuadroDiarioService(
    {
      buscarPorFecha: jest
        .fn()
        .mockImplementation(() => Promise.resolve(guardado)),
      crear,
      actualizarEstado,
      operativosConCondicionantePendiente: jest
        .fn()
        .mockResolvedValue(pendientes),
      operativosSinAporteCompartido: jest.fn().mockResolvedValue(sinAporte),
      contarOperativos: jest.fn().mockResolvedValue(3),
      ejecutarEnTransaccion: jest
        .fn()
        .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
          operacion(CLIENTE),
        ),
    } as unknown as CuadroDiarioRepository,
    { obtenerEstado } as unknown as VentanaCargaService,
    { consolidarJornada } as unknown as HistorialJornadaService,
    { registrar } as unknown as AuditoriaService,
    { log, warn } as unknown as LoggerService,
  );

  return { servicio, crear, actualizarEstado, registrar, consolidarJornada };
};

describe('CuadroDiarioService · apertura', () => {
  it('abre la jornada con su semana ISO derivada', async () => {
    const { servicio, crear } = armar();

    await servicio.abrir(MIERCOLES, 6);

    expect(crear).toHaveBeenCalledWith(
      {
        fecha: MIERCOLES,
        ordenTrabajo: 'AMC-2026-08-05',
        nroSemana: 32,
        anioSemana: 2026,
      },
      CLIENTE,
    );
  });

  it('caso 1 del plan · dos cuadros para la misma fecha se rechazan', async () => {
    const { servicio, crear } = armar({ existente: cuadro() });

    const fallo: unknown = await servicio
      .abrir(MIERCOLES, 6)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('OT-PRUEBA-001');
    expect(crear).not.toHaveBeenCalled();
  });

  /**
   * PV-28, resuelto el 2026-08-07. Antes llegaba como dato de entrada; ahora lo compone
   * el sistema y **quien abre la jornada no puede equivocarse al escribirlo**.
   */
  it('la orden de trabajo se genera con el formato AMC-AAAA-MM-DD', async () => {
    const { servicio, crear } = armar();

    await servicio.abrir(dia('2026-12-31'), 6);

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ ordenTrabajo: 'AMC-2026-12-31' }),
      CLIENTE,
    );
  });

  it('se lee en UTC: no imprime el día anterior', async () => {
    // `cuad_fecha` es una fecha de calendario. Leerla con los captadores locales daría
    // el día anterior en Quito, que está en UTC−5, y el código encabeza la matriz que
    // firma la Dirección.
    const { servicio, crear } = armar();

    await servicio.abrir(dia('2026-01-01'), 6);

    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({ ordenTrabajo: 'AMC-2026-01-01' }),
      CLIENTE,
    );
  });

  it('audita la apertura dentro de la transacción', async () => {
    const { servicio, registrar } = armar();

    await servicio.abrir(MIERCOLES, 6);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_cuadro_diario',
        accion: AccionAuditoria.CREAR,
        usuario: 6,
      }),
      CLIENTE,
    );
  });
});

/**
 * REGLA DEL 2026-08-11 · LA JORNADA SE ABRE SOLA AL REGISTRAR EL PRIMER OPERATIVO.
 *
 * Las fechas de estas pruebas son deliberadamente lejanas y no `MIERCOLES`: la regla
 * compara contra el día de HOY, así que una fecha cercana convertiría el resultado en
 * algo que depende de cuándo se ejecute la suite.
 */
describe('CuadroDiarioService · apertura automática al registrar', () => {
  const FUTURO = dia('2099-12-31');
  const PASADO = dia('2020-01-01');

  it('abre la jornada cuando todavía no existe', async () => {
    const { servicio, crear, registrar } = armar();

    const jornada = await servicio.asegurarParaRegistro(FUTURO, 3);

    expect(jornada.ordenTrabajo).toBe('AMC-2099-12-31');
    expect(crear).toHaveBeenCalledTimes(1);
    // Queda como autor quien registró, no el administrador: es lo único que permite
    // saber después quién abrió la jornada.
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_cuadro_diario',
        accion: AccionAuditoria.CREAR,
        usuario: 3,
      }),
      CLIENTE,
    );
  });

  it('devuelve la existente sin volver a abrirla', async () => {
    const { servicio, crear } = armar({ existente: cuadro() });

    const jornada = await servicio.asegurarParaRegistro(MIERCOLES, 3);

    expect(jornada.ordenTrabajo).toBe('OT-PRUEBA-001');
    expect(crear).not.toHaveBeenCalled();
  });

  it('una jornada cerrada sigue rechazando la escritura', async () => {
    // La apertura automática no debilita RN-58: solo cubre el caso de que no exista.
    const { servicio, crear } = armar({
      existente: cuadro({ estado: EstadoCuadro.CERRADO }),
    });

    await expect(
      servicio.asegurarParaRegistro(MIERCOLES, 3),
    ).rejects.toBeInstanceOf(ReglaNegocioError);
    expect(crear).not.toHaveBeenCalled();
  });

  it('no abre una jornada del pasado', async () => {
    const { servicio, crear } = armar();

    await expect(
      servicio.asegurarParaRegistro(PASADO, 3),
    ).rejects.toBeInstanceOf(ValidacionError);
    expect(crear).not.toHaveBeenCalled();
  });

  it('el mensaje del pasado nombra el día, para que se vea el error de fecha', async () => {
    const { servicio } = armar();

    const fallo = await servicio
      .asegurarParaRegistro(PASADO, 3)
      .catch((error: unknown) => error);

    expect((fallo as ValidacionError).message).toContain('2020-01-01');
  });
});

describe('CuadroDiarioService · el estado sigue a las ventanas', () => {
  it('con la ventana departamental abierta se queda en borrador', async () => {
    const { servicio, actualizarEstado } = armar({
      existente: cuadro(),
      departamentalAbierta: true,
    });

    const resultado = await servicio.sincronizarConVentanas(MIERCOLES);

    expect(resultado.estado).toBe(EstadoCuadro.BORRADOR);
    expect(actualizarEstado).not.toHaveBeenCalled();
  });

  it('cerrada la departamental y abierta la de transporte, pasa a EN_TRANSPORTE', async () => {
    const { servicio } = armar({
      existente: cuadro(),
      transporteAbierta: true,
    });

    const resultado = await servicio.sincronizarConVentanas(MIERCOLES);

    expect(resultado.estado).toBe(EstadoCuadro.EN_TRANSPORTE);
  });

  it('con las dos ventanas vencidas llega hasta APROBADO, sin saltarse EN_TRANSPORTE', async () => {
    const { servicio, actualizarEstado } = armar({ existente: cuadro() });

    const resultado = await servicio.sincronizarConVentanas(MIERCOLES);

    expect(resultado.estado).toBe(EstadoCuadro.APROBADO);
    // Dos escalones, uno por llamada: INV-03 se respeta también aquí.
    expect(actualizarEstado).toHaveBeenCalledTimes(2);
  });

  it('una ventana DESACTIVADA no retiene el cuadro, aunque deje escribir', async () => {
    // M-08: la ventana desactivada significa «sin restricción horaria», y su evaluador
    // devuelve que se puede escribir siempre. Si eso retuviera la jornada, desactivar
    // la ventana de la DAF dejaría el cuadro sin poder llegar nunca a APROBADO y la
    // Dirección no podría cerrarlo.
    const { servicio } = armar({
      existente: cuadro(),
      departamentalAbierta: true,
      transporteAbierta: true,
      ventanasActivas: false,
    });

    const resultado = await servicio.sincronizarConVentanas(MIERCOLES);

    expect(resultado.estado).toBe(EstadoCuadro.APROBADO);
  });

  it('nunca retrocede: un cuadro aprobado no vuelve a borrador', async () => {
    const { servicio, actualizarEstado } = armar({
      existente: cuadro({ estado: EstadoCuadro.APROBADO }),
      departamentalAbierta: true,
    });

    const resultado = await servicio.sincronizarConVentanas(MIERCOLES);

    expect(resultado.estado).toBe(EstadoCuadro.APROBADO);
    expect(actualizarEstado).not.toHaveBeenCalled();
  });

  it('un cuadro cerrado no se toca', async () => {
    const { servicio, actualizarEstado } = armar({
      existente: cuadro({ estado: EstadoCuadro.CERRADO }),
    });

    const resultado = await servicio.sincronizarConVentanas(MIERCOLES);

    expect(resultado.estado).toBe(EstadoCuadro.CERRADO);
    expect(actualizarEstado).not.toHaveBeenCalled();
  });

  it('la sincronización nunca cierra por su cuenta', async () => {
    const { servicio } = armar({
      existente: cuadro({ estado: EstadoCuadro.APROBADO }),
    });

    const resultado = await servicio.sincronizarConVentanas(MIERCOLES);

    expect(resultado.estado).toBe(EstadoCuadro.APROBADO);
  });

  it('caso 4 del plan · avanzar salteándose un estado se rechaza', async () => {
    const { servicio } = armar({ existente: cuadro() });

    await expect(
      servicio.avanzar(MIERCOLES, EstadoCuadro.CERRADO),
    ).rejects.toBeInstanceOf(ReglaNegocioError);
  });
});

describe('CuadroDiarioService · cierre', () => {
  it('caso 7 del plan · el cierre consolida el historial DESPUÉS de confirmar', async () => {
    const { servicio, registrar, consolidarJornada } = armar({
      existente: cuadro({ estado: EstadoCuadro.APROBADO }),
    });

    const cerrado = await servicio.cerrar(MIERCOLES, 5);

    expect(cerrado.estado).toBe(EstadoCuadro.CERRADO);
    expect(cerrado.cerradoPor).toBe(5);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: AccionAuditoria.CERRAR }),
      CLIENTE,
    );
    expect(consolidarJornada).toHaveBeenCalledWith(MIERCOLES);
  });

  it('caso 6 del plan · no cierra si queda un nocturno sin conductor', async () => {
    const { servicio, consolidarJornada } = armar({
      existente: cuadro({ estado: EstadoCuadro.APROBADO }),
      pendientes: [
        { identificador: 'ICNECU-001', horaInicio: '20:00', horaFin: '02:00' },
      ],
    });

    const fallo: unknown = await servicio
      .cerrar(MIERCOLES, 5)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).message).toContain('ICNECU-001');
    expect((fallo as ReglaNegocioError).message).toContain('sin conductor');
    expect(consolidarJornada).not.toHaveBeenCalled();
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * EL MÍNIMO DEL CUPO COMPARTIDO · decidido por el negocio el 2026-08-25.
   *
   * En la patrulla ECU el DMIT aporta **de una a dos** personas. El máximo lo aplica
   * `composicion-personal.ts` al asignar; el mínimo se exige aquí, al cerrar, porque
   * aplicarlo al asignar rechazaría siempre a la primera persona (PV-29).
   *
   * ES UNA PUERTA QUE SE CIERRA, no un aviso: se prueba que **impide cerrar** y que no
   * consolida la jornada. Si un día alguien la degradara a advertencia, esta prueba cae.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  it('no cierra si una patrulla compartida se quedó sin el aporte del otro departamento', async () => {
    const { servicio, consolidarJornada } = armar({
      existente: cuadro({ estado: EstadoCuadro.APROBADO }),
      sinAporte: [
        {
          identificador: 'ICECU-001',
          formularioNombre: 'PATRULLA ECU DIURNA',
          rolCompartido: RolDepartamental.DMIT_INSTRUCTOR,
        },
      ],
    });

    const fallo: unknown = await servicio
      .cerrar(MIERCOLES, 5)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).message).toContain('ICECU-001');
    expect((fallo as ReglaNegocioError).message).toContain(
      'PATRULLA ECU DIURNA',
    );
    expect(consolidarJornada).not.toHaveBeenCalled();
  });

  /**
   * EL MENSAJE DICE A QUIÉN LLAMAR, y por eso lleva el departamento.
   *
   * La Dirección no puede resolver esto por su cuenta: quien tiene que asignar es el
   * departamento que aporta. Un «falta personal» a secas la dejaría mirando el cuadro
   * sin saber a qué extensión marcar.
   */
  it('el aviso nombra al departamento que tiene que poner la persona', async () => {
    const { servicio } = armar({
      existente: cuadro({ estado: EstadoCuadro.APROBADO }),
      sinAporte: [
        {
          identificador: 'ICECU-001',
          formularioNombre: 'PATRULLA ECU DIURNA',
          rolCompartido: RolDepartamental.DMIT_INSTRUCTOR,
        },
      ],
    });

    const fallo: unknown = await servicio
      .cerrar(MIERCOLES, 5)
      .catch((error: unknown) => error);

    expect((fallo as ReglaNegocioError).message).toContain('DMIT_INSTRUCTOR');
    expect((fallo as ReglaNegocioError).code).toBe(
      CODIGOS_ERROR.APORTE_COMPARTIDO_PENDIENTE,
    );
  });

  /**
   * Los siete formularios sin rol compartido no entran en la consulta, así que un cuadro
   * corriente cierra igual que antes del cambio. Es la prueba de que esto no le añade
   * una condición a quien no la pidió.
   */
  it('un cuadro sin formularios compartidos cierra igual que antes', async () => {
    const { servicio, consolidarJornada } = armar({
      existente: cuadro({ estado: EstadoCuadro.APROBADO }),
      sinAporte: [],
    });

    const cerrado = await servicio.cerrar(MIERCOLES, 5);

    expect(cerrado.estado).toBe(EstadoCuadro.CERRADO);
    expect(consolidarJornada).toHaveBeenCalled();
  });

  it('el mensaje enumera todos los operativos que faltan', async () => {
    const { servicio } = armar({
      existente: cuadro({ estado: EstadoCuadro.APROBADO }),
      pendientes: [
        { identificador: 'ICNECU-001', horaInicio: '20:00', horaFin: '02:00' },
        { identificador: 'ICNECU-002', horaInicio: '21:00', horaFin: '03:00' },
      ],
    });

    const fallo: unknown = await servicio
      .cerrar(MIERCOLES, 5)
      .catch((error: unknown) => error);

    const mensaje = (fallo as ReglaNegocioError).message;
    expect(mensaje).toContain('2 operativos');
    expect(mensaje).toContain('ICNECU-001');
    expect(mensaje).toContain('ICNECU-002');
  });

  it('no cierra mientras la ventana departamental siga abierta', async () => {
    const { servicio } = armar({
      existente: cuadro(),
      departamentalAbierta: true,
    });

    const fallo: unknown = await servicio
      .cerrar(MIERCOLES, 5)
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).message).toContain(
      'carga departamental',
    );
  });

  it('no cierra dos veces', async () => {
    const { servicio } = armar({
      existente: cuadro({ estado: EstadoCuadro.CERRADO }),
    });

    await expect(servicio.cerrar(MIERCOLES, 5)).rejects.toBeInstanceOf(
      ReglaNegocioError,
    );
  });

  it('una fecha sin cuadro produce 404', async () => {
    const { servicio } = armar();

    await expect(servicio.cerrar(MIERCOLES, 5)).rejects.toBeInstanceOf(
      RecursoNoEncontradoError,
    );
  });
});

describe('CuadroDiarioService · reapertura', () => {
  it('caso 9 del plan · vuelve a APROBADO y sube el contador', async () => {
    const { servicio, registrar } = armar({
      existente: cuadro({
        estado: EstadoCuadro.CERRADO,
        cerradoPor: 5,
        cerradoEn: new Date(),
        reaperturas: 0,
      }),
    });

    const reabierto = await servicio.reabrir(MIERCOLES, 5);

    expect(reabierto.estado).toBe(EstadoCuadro.APROBADO);
    expect(reabierto.reaperturas).toBe(1);
    expect(reabierto.cerradoPor).toBeNull();
    expect(reabierto.cerradoEn).toBeNull();
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: AccionAuditoria.REABRIR }),
      CLIENTE,
    );
  });

  it('no se reabre lo que no está cerrado', async () => {
    const { servicio } = armar({
      existente: cuadro({ estado: EstadoCuadro.APROBADO }),
    });

    await expect(servicio.reabrir(MIERCOLES, 5)).rejects.toBeInstanceOf(
      ReglaNegocioError,
    );
  });
});

describe('CuadroDiarioService · puedeEscribir (RN-58)', () => {
  it('caso 5 del plan · un cuadro cerrado no admite escritura', async () => {
    const { servicio } = armar({
      existente: cuadro({ estado: EstadoCuadro.CERRADO }),
    });

    expect(await servicio.puedeEscribir(MIERCOLES)).toBe(false);

    const fallo: unknown = await servicio
      .exigirEscritura(MIERCOLES)
      .catch((error: unknown) => error);

    expect((fallo as ReglaNegocioError).code).toBe('CUADRO_CERRADO');
  });

  it('los tres estados anteriores sí admiten escritura', async () => {
    for (const estado of [
      EstadoCuadro.BORRADOR,
      EstadoCuadro.EN_TRANSPORTE,
      EstadoCuadro.APROBADO,
    ]) {
      const { servicio } = armar({ existente: cuadro({ estado }) });
      expect(await servicio.puedeEscribir(MIERCOLES)).toBe(true);
    }
  });

  it('una jornada que nadie abrió NO admite escritura', async () => {
    const { servicio } = armar();
    expect(await servicio.puedeEscribir(MIERCOLES)).toBe(false);
  });
});
