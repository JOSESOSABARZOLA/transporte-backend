/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: transporte.integracion-spec.ts
 * Responsabilidad: Verificar la asignación de transporte y la administración de la flota
 *                  contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06 · reescrita el 2026-10-15
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS CUATRO NIVELES DE LA RESTRICCIÓN DE LA DAF SOLO SE VEN AQUÍ.
 *
 * El primero es la ruta, el segundo el contrato, el tercero `forbidNonWhitelisted` y el
 * cuarto el servicio. Los cuatro son atravesados por una petición HTTP real.
 *
 * REESCRITA EL 2026-10-15. La suite no corría desde septiembre: su fixture registraba los
 * operativos por `POST /operativos` con el horario del operativo (retirado por RN-66, que lo
 * pasó a cada persona) y con puntos e instituciones compartidos entre formularios (hoy son de
 * UN formulario). Los operativos se crean ahora directamente en la base, como en
 * `jornada.integracion-spec.ts`: lo que se prueba aquí es el transporte, no el registro.
 *
 * Y el comportamiento cambió a propósito el 2026-10-14: la ocupación sale SOLO de los tramos
 * (`t_tramo_transporte`) y `t_operativo.cond_id/vehi_id` es un reflejo. `PATCH
 * /transporte/operativos/:id` delega en `asignarBloque` (mismas reglas que «Planificar el
 * día»), así que un «dejar y retirar» deja al conductor libre entre sus dos tramos.
 *
 * Las ventanas de carga se desactivan mientras corre, salvo en el caso 10, que las
 * necesita cerradas para comprobar el 423.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccesoFormulario,
  AreaPersonal,
  EstadoDisponibilidad,
  EstadoTransporte,
  PoliticaVehiculo,
  RolDepartamental,
  TipoContrato,
  TipoTransporte,
  TipoVentana,
  type VentanaCarga,
} from '@prisma/client';
import type { Server } from 'node:http';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { correlacionMiddleware } from '../src/common/interceptors/correlacion.middleware';
import { LoggerService } from '../src/common/logger/logger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { como } from './identidad-de-prueba';

const PREFIJO = 'PRUEBA_M17';
/** Prefijo de placa de la suite: formato AAA-9999 (D4) y fácil de limpiar. */
const PLACA = 'QZA-17';
const API = '/api/v1';

const OPERATIVOS_ROL = '1';
const DAF = '4';
const DIRECTOR = '5';
const ADMINISTRADOR = '9';

const FECHA = '2026-12-02';

interface TransporteRespuesta {
  id: number;
  identificador: string;
  estadoTransporte: EstadoTransporte;
  conductor: { id: number; nombreCompleto: string } | null;
  vehiculo: { id: number; placa: string } | null;
  asignadoEn: string | null;
}

interface ErrorRespuesta {
  codigo: string;
  mensaje: string;
  detalles?: { motivos?: { codigo: string }[] };
}

describe('Asignación de transporte · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ventanasIniciales: VentanaCarga[] = [];

  let formularioNormal = 0;
  let formularioPropiosMedios = 0;
  let cuadroId = 0;
  let funcionarioId = 0;
  let conductor = 0;
  let otroConductor = 0;
  let conductorDeVacaciones = 0;
  let conductorDeTramos = 0;
  let vehiculo = 0;
  let segundoVehiculo = 0;
  let vehiculoEnTaller = 0;
  let vehiculoDeTramos = 0;
  let operativoNormal = 0;
  let operativoSegundo = 0;
  let operativoPropiosMedios = 0;
  let secuencial = 0;

  const servidor = (): Server => app.getHttpServer() as Server;

  const asignar = (
    usuario: string,
    operativoId: number,
    cuerpo: Record<string, unknown>,
  ) =>
    request(servidor())
      .patch(`${API}/transporte/operativos/${operativoId}`)
      .set(como(usuario))
      .send(cuerpo);

  const desasignar = (operativoId: number) =>
    request(servidor())
      .patch(`${API}/transporte/operativos/${operativoId}/desasignar`)
      .set(como(DAF));

  const motivosDe = (cuerpo: unknown): string[] =>
    ((cuerpo as ErrorRespuesta).detalles?.motivos ?? []).map((m) => m.codigo);

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication({ bufferLogs: true });
    app.use(correlacionMiddleware);
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter(app.get(LoggerService)));
    await app.init();

    prisma = app.get(PrismaService);

    await limpiar();

    ventanasIniciales = await prisma.ventanaCarga.findMany();
    await prisma.ventanaCarga.updateMany({ data: { activo: false } });

    formularioNormal = await crearFormulario(
      2,
      'PMO',
      PoliticaVehiculo.REQUERIDO,
    );
    formularioPropiosMedios = await crearFormulario(
      1,
      'REACCION',
      PoliticaVehiculo.NO_APLICA,
    );

    vehiculo = await crearVehiculo('01', 'camioneta');
    // Una placa por operativo que se cruza: RN-DAF-01 impide la misma placa con dos
    // conductores a la vez.
    segundoVehiculo = await crearVehiculo('02', 'segunda');
    vehiculoEnTaller = await crearVehiculo('03', 'en taller');
    vehiculoDeTramos = await crearVehiculo('04', 'de los tramos');

    conductor = await crearConductor('0201', 'PRIMERO', vehiculo);
    otroConductor = await crearConductor('0202', 'SEGUNDO', null);
    conductorDeVacaciones = await crearConductor('0203', 'AUSENTE', null);
    conductorDeTramos = await crearConductor('0204', 'TRAMOS', null);

    await prisma.disponibilidad.create({
      data: {
        conductorId: conductorDeVacaciones,
        estado: EstadoDisponibilidad.VACACIONES,
        desde: new Date(`${FECHA}T00:00:00.000Z`),
        hasta: new Date('2026-12-20T00:00:00.000Z'),
        registradoPor: 6,
      },
    });

    await prisma.disponibilidad.create({
      data: {
        vehiculoId: vehiculoEnTaller,
        estado: EstadoDisponibilidad.MANTENIMIENTO,
        desde: new Date(`${FECHA}T00:00:00.000Z`),
        hasta: new Date('2026-12-15T00:00:00.000Z'),
        registradoPor: 6,
      },
    });

    cuadroId = (
      await prisma.cuadroDiario.create({
        data: {
          fecha: new Date(`${FECHA}T00:00:00.000Z`),
          ordenTrabajo: `${PREFIJO}-OT-001`,
          nroSemana: 49,
          anioSemana: 2026,
        },
      })
    ).id;

    funcionarioId = (
      await prisma.funcionario.create({
        data: {
          cedula: '8888880301',
          apellidos: `${PREFIJO}_PERSONA`,
          nombres: 'UNO',
          area: AreaPersonal.GENERAL,
          tipoContrato: TipoContrato.NOMBRAMIENTO,
          direccion: RolDepartamental.DMIP_OPERATIVOS,
        },
      })
    ).id;

    operativoNormal = await crearOperativo(formularioNormal, '08:00', '12:00');
    operativoSegundo = await crearOperativo(formularioNormal, '10:00', '16:00');
    operativoPropiosMedios = await crearOperativo(
      formularioPropiosMedios,
      '08:00',
      '12:00',
    );
  });

  afterAll(async () => {
    await limpiar();

    // Se repone la fila ENTERA, no solo `activo`: el caso 10 cambia el horario de la DAF a
    // 00H00-00H30, y `ventanas-carga.integracion-spec.ts` —que corre después— valida su
    // apertura contra ese cierre y respondía 400.
    for (const original of ventanasIniciales) {
      await prisma.ventanaCarga.update({
        where: { rol: original.rol },
        data: {
          tipo: original.tipo,
          diaApertura: original.diaApertura,
          horaApertura: original.horaApertura,
          diaCierre: original.diaCierre,
          horaCierre: original.horaCierre,
          mensajeCierre: original.mensajeCierre,
          activo: original.activo,
        },
      });
    }
    await prisma.ventanaCarga.deleteMany({
      where: { rol: { notIn: ventanasIniciales.map((v) => v.rol) } },
    });
    await app.close();
  });

  const limpiar = async (): Promise<void> => {
    // Los tramos referencian conductor y vehículo con Restrict: se van con su operativo
    // (Cascade) al borrar el cuadro, y los que queden sueltos se borran antes.
    await prisma.tramoTransporte.deleteMany({
      where: {
        OR: [
          { vehiculo: { placa: { startsWith: PLACA } } },
          { conductor: { nombreCompleto: { startsWith: PREFIJO } } },
        ],
      },
    });
    await prisma.cuadroDiario.deleteMany({
      where: { ordenTrabajo: { startsWith: PREFIJO } },
    });
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
    await prisma.funcionario.deleteMany({
      where: { apellidos: { startsWith: PREFIJO } },
    });
    await prisma.disponibilidad.deleteMany({
      where: {
        OR: [
          { conductor: { nombreCompleto: { startsWith: PREFIJO } } },
          { vehiculo: { placa: { startsWith: PLACA } } },
        ],
      },
    });
    await prisma.conductor.deleteMany({
      where: { nombreCompleto: { startsWith: PREFIJO } },
    });
    await prisma.vehiculo.deleteMany({
      where: { placa: { startsWith: PLACA } },
    });
  };

  const crearFormulario = async (
    numero: number,
    sufijo: string,
    politicaVehiculo: PoliticaVehiculo,
  ): Promise<number> => {
    const formulario = await prisma.formulario.create({
      data: {
        numero,
        codigo: `${PREFIJO}_${sufijo}`,
        nombre: `FORMULARIO ${sufijo}`,
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno: RolDepartamental.DMIP_OPERATIVOS,
        politicaVehiculo,
        orden: numero,
        prefijos: {
          create: [{ prefijo: sufijo.slice(0, 3), esPredeterminado: true }],
        },
        areas: { create: [{ area: AreaPersonal.GENERAL }] },
        roles: {
          create: [
            {
              rol: RolDepartamental.DMIP_OPERATIVOS,
              acceso: AccesoFormulario.ESCRITURA,
            },
          ],
        },
      },
    });
    return formulario.id;
  };

  const crearVehiculo = async (
    sufijo: string,
    descripcion: string,
  ): Promise<number> =>
    (
      await prisma.vehiculo.create({
        data: {
          placa: `${PLACA}${sufijo}`,
          descripcion: `${PREFIJO} ${descripcion}`,
          asientos: 8,
        },
      })
    ).id;

  const crearConductor = async (
    sufijo: string,
    nombre: string,
    vehiculoHabitualId: number | null,
  ): Promise<number> => {
    const creado = await prisma.conductor.create({
      data: {
        cedula: `888888${sufijo}`,
        nombreCompleto: `${PREFIJO} ${nombre}`,
        licenciaTipo: 'E',
        vehiculoHabitualId,
      },
    });
    return creado.id;
  };

  /** Un operativo de la jornada, creado en la base: aquí se prueba el transporte. */
  const crearOperativo = async (
    formularioId: number,
    horaInicio: string,
    horaFin: string,
    tipoTransporte: TipoTransporte = TipoTransporte.COMPLETO,
  ): Promise<number> => {
    secuencial += 1;
    const [hi, mi] = horaInicio.split(':').map(Number);
    const [hf, mf] = horaFin.split(':').map(Number);
    const duracion = (hf * 60 + mf - (hi * 60 + mi)) / 60;
    const creado = await prisma.operativo.create({
      data: {
        cuadroId,
        formularioId,
        identificador: `${PREFIJO}-${String(secuencial).padStart(3, '0')}`,
        secuencial,
        horaInicio,
        horaFin,
        esNocturno: false,
        cruzaMedianoche: false,
        duracionHoras: duracion,
        puntoLibre: 'Punto de prueba',
        tipoLibre: 'Tipo de prueba',
        tipoTransporte,
        creadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
        creadoPor: 1,
        modificadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
        modificadoPor: 1,
        personal: {
          create: [
            {
              funcionarioId,
              asignadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
              horaInicio,
              horaFin,
            },
          ],
        },
      },
    });
    return creado.id;
  };

  describe('nivel 1 · la ruta', () => {
    it('caso 3 · un rol departamental no entra en el endpoint de transporte', async () => {
      const respuesta = await asignar(OPERATIVOS_ROL, operativoNormal, {
        conductorId: conductor,
        vehiculoId: vehiculo,
      }).expect(403);

      expect((respuesta.body as ErrorRespuesta).codigo).toBe(
        'PERMISO_INSUFICIENTE',
      );
    });

    it('caso 4 · la DAF no puede crear operativos', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/operativos`)
        .set(como(DAF))
        .send({
          cuadroFecha: FECHA,
          formularioCodigo: `${PREFIJO}_PMO`,
          zonalesIds: [1],
          puntoEncuentroId: 1,
          tipoControlId: 1,
          institucionesIds: [1],
        })
        .expect(403);

      expect((respuesta.body as ErrorRespuesta).codigo).toBe(
        'PERMISO_INSUFICIENTE',
      );
    });

    it('ni retirar personal, ni editar el operativo', async () => {
      await request(servidor())
        .patch(`${API}/operativos/${operativoNormal}`)
        .set(como(DAF))
        .send({ version: 1, horaFin: '18:00' })
        .expect(403);

      await request(servidor())
        .delete(`${API}/operativos/${operativoNormal}?version=1`)
        .set(como(DAF))
        .expect(403);
    });

    it('sin identidad responde 401', async () => {
      await request(servidor())
        .patch(`${API}/transporte/operativos/${operativoNormal}`)
        .send({ conductorId: conductor, vehiculoId: vehiculo })
        .expect(401);
    });
  });

  describe('niveles 2 y 3 · el contrato y la validación', () => {
    it('caso 2 · enviar horaInicio además de los dos campos responde 400 con la lista', async () => {
      const respuesta = await asignar(DAF, operativoNormal, {
        conductorId: conductor,
        vehiculoId: vehiculo,
        horaInicio: '06:00',
      }).expect(400);

      const cuerpo = respuesta.body as ErrorRespuesta;
      expect(cuerpo.codigo).toBe('CAMPOS_NO_PERMITIDOS');
      expect(cuerpo.mensaje).toContain('horaInicio');
    });

    it('cualquier otro campo del operativo se rechaza igual', async () => {
      for (const campo of [
        { observaciones: 'nada' },
        { puntoEncuentroId: 1 },
        { estadoTransporte: EstadoTransporte.ASIGNADO },
        { version: 1 },
      ]) {
        const respuesta = await asignar(DAF, operativoNormal, {
          conductorId: conductor,
          vehiculoId: vehiculo,
          ...campo,
        }).expect(400);

        expect((respuesta.body as ErrorRespuesta).codigo).toBe(
          'CAMPOS_NO_PERMITIDOS',
        );
      }
    });

    it('faltando uno de los dos campos, tampoco pasa', async () => {
      await asignar(DAF, operativoNormal, { conductorId: conductor }).expect(
        400,
      );
      await asignar(DAF, operativoNormal, { vehiculoId: vehiculo }).expect(400);
    });
  });

  describe('nivel 4 · el servicio', () => {
    it('caso 1 · asigna conductor y vehículo por tramos, y el operativo lo refleja', async () => {
      const respuesta = await asignar(DAF, operativoNormal, {
        conductorId: conductor,
        vehiculoId: vehiculo,
      }).expect(200);

      const resultado = respuesta.body as TransporteRespuesta;
      expect(resultado.estadoTransporte).toBe(EstadoTransporte.ASIGNADO);
      expect(resultado.conductor?.id).toBe(conductor);
      expect(resultado.vehiculo?.placa).toBe(`${PLACA}01`);
      expect(resultado.asignadoEn).not.toBeNull();

      // La ocupación vive en los tramos (2026-10-14): uno COMPLETO, con los dos.
      const tramos = await prisma.tramoTransporte.findMany({
        where: { operativoId: operativoNormal },
      });
      expect(tramos).toHaveLength(1);
      expect(tramos[0]).toMatchObject({
        conductorId: conductor,
        vehiculoId: vehiculo,
      });
    });

    it('caso 11 · NINGUNA otra columna del operativo cambia', async () => {
      const antes = await prisma.operativo.findUniqueOrThrow({
        where: { id: operativoSegundo },
      });

      await asignar(DAF, operativoSegundo, {
        conductorId: otroConductor,
        vehiculoId: segundoVehiculo,
      }).expect(200);

      const despues = await prisma.operativo.findUniqueOrThrow({
        where: { id: operativoSegundo },
      });

      // Las cuatro que refleja la DAF, más las alertas (proyección derivada) y
      // `actualizadoEn` (Prisma la mantiene con `@updatedAt`). El resto, idéntico.
      const permitidas = new Set([
        'conductorId',
        'vehiculoId',
        'estadoTransporte',
        'asignadoEn',
        'alertas',
        'alertaActiva',
        'actualizadoEn',
      ]);

      for (const columna of Object.keys(antes)) {
        if (permitidas.has(columna)) continue;

        expect({
          columna,
          valor: JSON.stringify(despues[columna as keyof typeof despues]),
        }).toEqual({
          columna,
          valor: JSON.stringify(antes[columna as keyof typeof antes]),
        });
      }

      expect(despues.version).toBe(antes.version);
      expect(despues.modificadoPorRol).toBe(antes.modificadoPorRol);
    });

    it('la asignación queda auditada en el tramo y en el reflejo del operativo', async () => {
      const deTramos = await prisma.auditoria.findMany({
        where: { operativoId: operativoSegundo, entidad: 't_tramo_transporte' },
      });
      expect(deTramos.map((traza) => traza.campo)).toEqual(
        expect.arrayContaining(['cond_id', 'vehi_id']),
      );

      const delOperativo = await prisma.auditoria.findMany({
        where: { operativoId: operativoSegundo, entidad: 't_operativo' },
        orderBy: { id: 'asc' },
      });
      const campos = delOperativo.map((traza) => traza.campo);
      expect(campos).toContain('cond_id');
      expect(campos).toContain('vehi_id');
      expect(campos).toContain('oper_estado_transporte');
      expect(delOperativo.at(-1)?.rol).toBe(RolDepartamental.DAF);
    });
  });

  describe('las reglas del conductor', () => {
    it('caso 5 · un conductor de vacaciones no se asigna', async () => {
      const id = await crearOperativo(formularioNormal, '18:00', '20:00');

      const respuesta = await asignar(DAF, id, {
        conductorId: conductorDeVacaciones,
        vehiculoId: vehiculo,
      }).expect(409);

      // Desde que la ruta clásica delega en `asignarBloque` (2026-10-14), la ausencia es
      // un motivo duro de la política de tramos, el mismo que ve «Planificar el día».
      const cuerpo = respuesta.body as ErrorRespuesta;
      expect(cuerpo.codigo).toBe('ASIGNACION_NO_VIABLE');
      expect(motivosDe(cuerpo)).toContain('CONDUCTOR_AUSENTE');
    });

    it('caso 7 · VAL-21 · el conductor comprometido en horario cruzado se rechaza', async () => {
      // `otroConductor` ya conduce el operativo de 10H00 a 16H00.
      const respuesta = await asignar(DAF, operativoNormal, {
        conductorId: otroConductor,
        vehiculoId: vehiculo,
      }).expect(409);

      expect(motivosDe(respuesta.body)).toContain('SOLAPAMIENTO');
    });

    it('un vehículo en mantenimiento no se asigna', async () => {
      const respuesta = await asignar(DAF, operativoNormal, {
        conductorId: conductor,
        vehiculoId: vehiculoEnTaller,
      }).expect(409);

      expect(
        (respuesta.body as ErrorRespuesta).mensaje.toLowerCase(),
      ).toContain('mantenimiento');
    });

    it('un conductor inexistente responde 404', async () => {
      await asignar(DAF, operativoNormal, {
        conductorId: 999999,
        vehiculoId: vehiculo,
      }).expect(404);
    });
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LA OCUPACIÓN SALE DE LOS TRAMOS (2026-10-14).
   *
   * Un «dejar y retirar» de 08H00 a 16H00 ocupa al conductor en sus dos tramos (08H00-08H30
   * y 15H30-16H00) y lo deja libre entre ellos. Antes, la ruta clásica leía `t_operativo` y lo
   * daba por ocupado las ocho horas. Contra la base, porque el hueco es la suma de lo que
   * quedó escrito en `t_tramo_transporte`, no de lo que la política calcula en memoria.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  describe('ocupación por tramos', () => {
    let dejarYRetirar = 0;

    it('«dejar y retirar» genera dos tramos asignados', async () => {
      dejarYRetirar = await crearOperativo(
        formularioNormal,
        '08:00',
        '16:00',
        TipoTransporte.INICIO_Y_FIN,
      );

      await asignar(DAF, dejarYRetirar, {
        conductorId: conductorDeTramos,
        vehiculoId: vehiculoDeTramos,
      }).expect(200);

      const tramos = await prisma.tramoTransporte.findMany({
        where: { operativoId: dejarYRetirar },
        orderBy: { horaInicio: 'asc' },
      });
      expect(tramos.map((t) => t.tipo)).toEqual(['DEJAR', 'RETIRAR']);
      expect(tramos.every((t) => t.conductorId === conductorDeTramos)).toBe(
        true,
      );
    });

    it('el conductor queda libre entre sus dos tramos', async () => {
      const intermedio = await crearOperativo(
        formularioNormal,
        '11:00',
        '13:00',
      );

      await asignar(DAF, intermedio, {
        conductorId: conductorDeTramos,
        vehiculoId: vehiculoDeTramos,
      }).expect(200);
    });

    it('pero no en lo que se cruza con un tramo', async () => {
      const temprano = await crearOperativo(formularioNormal, '08:00', '09:00');

      const respuesta = await asignar(DAF, temprano, {
        conductorId: conductorDeTramos,
        vehiculoId: vehiculoDeTramos,
      }).expect(409);

      expect(motivosDe(respuesta.body)).toContain('SOLAPAMIENTO');
    });

    it('el hueco entre sus tramos se puede consultar', async () => {
      const respuesta = await request(servidor())
        .get(
          `${API}/transporte/conductores/${conductorDeTramos}/huecos-libres?fecha=${FECHA}`,
        )
        .set(como(DAF))
        .expect(200);

      expect(respuesta.body).toBeDefined();
    });
  });

  describe('evaluar una placa para el bloque (sustitución de flota)', () => {
    it('devuelve la flota con su veredicto: en taller y ocupada son DURO', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/transporte/evaluar/vehiculos`)
        .set(como(DAF))
        .send({
          fecha: FECHA,
          operativoIds: [operativoNormal],
          conductorId: conductor,
        })
        .expect(200);

      const cuerpo = respuesta.body as {
        vehiculos: {
          vehiculoId: number;
          estado: string;
          motivos: { codigo: string }[];
        }[];
      };
      const de = (id: number) =>
        cuerpo.vehiculos.find((v) => v.vehiculoId === id);

      expect(de(vehiculoEnTaller)?.estado).toBe('DURO');
      expect(de(vehiculoEnTaller)?.motivos.map((m) => m.codigo)).toContain(
        'VEHICULO_EN_TALLER',
      );
      // La segunda placa la usa otro conductor de 10H00 a 16H00 (RN-DAF-01).
      expect(de(segundoVehiculo)?.estado).toBe('DURO');
      expect(de(segundoVehiculo)?.motivos.map((m) => m.codigo)).toContain(
        'PLACA_OCUPADA',
      );
    });
  });

  describe('propios medios y política de vehículo', () => {
    it('INV-13 · el formulario que no habilita vehículo rechaza la asignación', async () => {
      const respuesta = await asignar(DAF, operativoPropiosMedios, {
        conductorId: conductor,
        vehiculoId: vehiculo,
      }).expect(409);

      expect((respuesta.body as ErrorRespuesta).mensaje).toContain(
        'propios medios',
      );
    });

    it('caso 8 · propios medios deja el operativo sin conductor ni vehículo', async () => {
      const respuesta = await request(servidor())
        .patch(
          `${API}/transporte/operativos/${operativoPropiosMedios}/propios-medios`,
        )
        .set(como(DAF))
        .expect(200);

      const resultado = respuesta.body as TransporteRespuesta;
      expect(resultado.estadoTransporte).toBe(EstadoTransporte.PROPIOS_MEDIOS);
      expect(resultado.conductor).toBeNull();
      expect(resultado.vehiculo).toBeNull();

      const guardado = await prisma.operativo.findUniqueOrThrow({
        where: { id: operativoPropiosMedios },
      });
      expect(guardado.conductorId).toBeNull();
      expect(guardado.vehiculoId).toBeNull();
      expect(guardado.asignadoEn).toBeNull();
    });

    /**
     * `ck_operativo_transporte` exige que `PENDIENTE` lleve conductor Y vehículo nulos, y esa
     * restricción solo existe en PostgreSQL: por eso esta prueba vive aquí.
     */
    it('P-07 · desasignar devuelve el operativo a PENDIENTE y libera sus tramos', async () => {
      const respuesta = await desasignar(operativoSegundo).expect(200);

      const resultado = respuesta.body as TransporteRespuesta;
      expect(resultado.estadoTransporte).toBe(EstadoTransporte.PENDIENTE);
      expect(resultado.conductor).toBeNull();
      expect(resultado.vehiculo).toBeNull();

      const guardado = await prisma.operativo.findUniqueOrThrow({
        where: { id: operativoSegundo },
      });
      expect(guardado.conductorId).toBeNull();
      expect(guardado.vehiculoId).toBeNull();

      const tramos = await prisma.tramoTransporte.findMany({
        where: { operativoId: operativoSegundo },
      });
      expect(tramos.every((t) => t.conductorId === null)).toBe(true);
    });

    it('P-07 · la desasignación queda auditada', async () => {
      const trazas = await prisma.auditoria.findMany({
        where: {
          operativoId: operativoSegundo,
          campo: 'oper_estado_transporte',
        },
        orderBy: { id: 'desc' },
        take: 1,
      });

      expect(trazas[0]?.valorNuevo).toBe(EstadoTransporte.PENDIENTE);
      expect(trazas[0]?.rol).toBe(RolDepartamental.DAF);
    });

    it('un rol departamental no puede desasignar', async () => {
      await request(servidor())
        .patch(`${API}/transporte/operativos/${operativoNormal}/desasignar`)
        .set(como(OPERATIVOS_ROL))
        .expect(403);
    });

    it('un rol departamental no puede declarar propios medios', async () => {
      await request(servidor())
        .patch(`${API}/transporte/operativos/${operativoNormal}/propios-medios`)
        .set(como(OPERATIVOS_ROL))
        .expect(403);
    });
  });

  describe('la consulta de la DAF', () => {
    it('los pendientes excluyen los formularios que no habilitan vehículo', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/transporte/pendientes/${FECHA}`)
        .set(como(DAF))
        .expect(200);

      const pendientes = respuesta.body as {
        id: number;
        estadoTransporte: EstadoTransporte;
      }[];

      expect(pendientes.length).toBeGreaterThan(0);
      expect(
        pendientes.some((fila) => fila.id === operativoPropiosMedios),
      ).toBe(false);
      expect(
        pendientes.every(
          (fila) => fila.estadoTransporte === EstadoTransporte.PENDIENTE,
        ),
      ).toBe(true);
    });

    it('la Dirección también los consulta', async () => {
      await request(servidor())
        .get(`${API}/transporte/pendientes/${FECHA}`)
        .set(como(DIRECTOR))
        .expect(200);
    });

    it('un rol departamental no', async () => {
      await request(servidor())
        .get(`${API}/transporte/pendientes/${FECHA}`)
        .set(como(OPERATIVOS_ROL))
        .expect(403);
    });

    it('caso 9 · el desplegable propone la placa del vehículo habitual', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/transporte/conductores?fecha=${FECHA}`)
        .set(como(DAF))
        .expect(200);

      const conductores = respuesta.body as {
        id: number;
        vehiculoHabitual: { id: number; placa: string } | null;
      }[];

      const primero = conductores.find((fila) => fila.id === conductor);
      expect(primero?.vehiculoHabitual?.placa).toBe(`${PLACA}01`);
    });

    it('RN-45 · el desplegable excluye al conductor de vacaciones', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/transporte/conductores?fecha=${FECHA}`)
        .set(como(DAF))
        .expect(200);

      const conductores = respuesta.body as { id: number }[];
      expect(
        conductores.some((fila) => fila.id === conductorDeVacaciones),
      ).toBe(false);
    });

    it('una fecha mal escrita responde 400', async () => {
      await request(servidor())
        .get(`${API}/transporte/pendientes/02-12-2026`)
        .set(como(DAF))
        .expect(400);
    });
  });

  describe('caso 10 · la ventana de la DAF', () => {
    it('fuera de su ventana, la asignación responde 423', async () => {
      // Se activa la ventana de la DAF con un horario ya vencido: 00H00 a 00H30.
      await prisma.ventanaCarga.upsert({
        where: { rol: RolDepartamental.DAF },
        update: {
          activo: true,
          horaApertura: '00:00',
          horaCierre: '00:30',
          tipo: TipoVentana.DIARIO,
        },
        create: {
          rol: RolDepartamental.DAF,
          tipo: TipoVentana.DIARIO,
          horaApertura: '00:00',
          horaCierre: '00:30',
          mensajeCierre: 'La ventana de transporte está cerrada.',
          activo: true,
        },
      });

      try {
        const respuesta = await asignar(DAF, operativoNormal, {
          conductorId: conductor,
          vehiculoId: vehiculo,
        }).expect(423);

        expect((respuesta.body as ErrorRespuesta).codigo).toBe(
          'VENTANA_CARGA_CERRADA',
        );

        // La consulta NO se restringe por ventana: la Dirección revisa a cualquier hora.
        await request(servidor())
          .get(`${API}/transporte/pendientes/${FECHA}`)
          .set(como(DAF))
          .expect(200);
      } finally {
        await prisma.ventanaCarga.update({
          where: { rol: RolDepartamental.DAF },
          data: { activo: false },
        });
      }
    });
  });

  describe('administración de la flota', () => {
    it('la flota la administran la DAF y su administrador; un rol de operativos no', async () => {
      await request(servidor())
        .get(`${API}/administracion/conductores`)
        .set(como(OPERATIVOS_ROL))
        .expect(403);

      await request(servidor())
        .get(`${API}/administracion/conductores`)
        .set(como(DAF))
        .expect(200);

      await request(servidor())
        .get(`${API}/administracion/conductores`)
        .set(como(ADMINISTRADOR))
        .expect(200);
    });

    it('crea un conductor y lo asocia a su vehículo habitual', async () => {
      const creado = await request(servidor())
        .post(`${API}/administracion/conductores`)
        .set(como(ADMINISTRADOR))
        .send({
          cedula: '1710034065',
          nombreCompleto: `${PREFIJO} NUEVO`,
          telefono: '0999999999',
          licenciaTipo: 'E',
          vehiculoHabitualId: vehiculo,
        })
        .expect(201);

      expect((creado.body as { nombreCompleto: string }).nombreCompleto).toBe(
        `${PREFIJO} NUEVO`,
      );
    });

    it('una cédula que no tiene diez dígitos se rechaza', async () => {
      await request(servidor())
        .post(`${API}/administracion/conductores`)
        .set(como(ADMINISTRADOR))
        .send({ cedula: '171003406', nombreCompleto: `${PREFIJO} INVALIDO` })
        .expect(400);
    });

    it('la placa se normaliza (AAA-9999) y no admite duplicados escritos de otra forma', async () => {
      const creado = await request(servidor())
        .post(`${API}/administracion/vehiculos`)
        .set(como(ADMINISTRADOR))
        .send({ placa: ' qza 1799 ', descripcion: `${PREFIJO} moto` })
        .expect(201);

      expect((creado.body as { placa: string }).placa).toBe('QZA-1799');

      const repetida = await request(servidor())
        .post(`${API}/administracion/vehiculos`)
        .set(como(ADMINISTRADOR))
        .send({ placa: 'QZA1799' })
        .expect(400);
      expect((repetida.body as ErrorRespuesta).mensaje).toBe(
        'Ya existe un vehículo con esa placa.',
      );

      await request(servidor())
        .post(`${API}/administracion/vehiculos`)
        .set(como(ADMINISTRADOR))
        .send({ placa: 'Q1-ABC' })
        .expect(400);
    });

    it('un kilometraje sobre el tope se rechaza', async () => {
      const respuesta = await request(servidor())
        .post(`${API}/administracion/vehiculos`)
        .set(como(ADMINISTRADOR))
        .send({ placa: 'QZA-1798', kilometraje: 1000000 })
        .expect(400);

      expect((respuesta.body as ErrorRespuesta).mensaje).toBe(
        'Revise el kilometraje: parece demasiado alto.',
      );
    });

    it('el resumen de la flota responde con sus cuatro indicadores', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/administracion/flota/resumen`)
        .set(como(ADMINISTRADOR))
        .expect(200);

      const resumen = respuesta.body as {
        vehiculos: { activos: number; sinFechas: number };
        conductores: { activos: number; incompletos: number };
        garajes: { vigentes: number };
        diasAviso: number;
      };
      expect(resumen.vehiculos.activos).toBeGreaterThanOrEqual(4);
      // Los de la suite no tienen fechas de matrícula ni SOAT.
      expect(resumen.vehiculos.sinFechas).toBeGreaterThanOrEqual(4);
      expect(resumen.conductores.incompletos).toBeGreaterThan(0);
      expect(typeof resumen.diasAviso).toBe('number');
    });

    it('la baja de un vehículo con transporte asignado desde hoy responde 409', async () => {
      // `vehiculo` tiene el tramo de `operativoNormal` el 2026-12-02 (futuro).
      const respuesta = await request(servidor())
        .delete(`${API}/administracion/vehiculos/${vehiculo}`)
        .set(como(ADMINISTRADOR))
        .expect(409);

      expect((respuesta.body as ErrorRespuesta).codigo).toBe(
        'RECURSO_CON_ASIGNACION',
      );
      // D2 (2026-10-20): el aviso previo da el MISMO motivo que el 409.
      const impacto = await request(servidor())
        .get(`${API}/administracion/vehiculos/${vehiculo}/impacto-baja`)
        .set(como(ADMINISTRADOR))
        .expect(200);
      expect((impacto.body as { motivo: string | null }).motivo).toBe(
        (respuesta.body as ErrorRespuesta).mensaje,
      );
    });

    it('la disponibilidad de la flota en una fecha responde para el administrador general (D3)', async () => {
      const respuesta = await request(servidor())
        .get(
          `${API}/administracion/flota/vehiculos/disponibilidad?fecha=2026-12-02`,
        )
        .set(como(ADMINISTRADOR))
        .expect(200);

      const cuerpo = respuesta.body as {
        fecha: string;
        hasta: string;
        vehiculos: { vehiculoId: number; disponibilidad: string }[];
      };
      expect(cuerpo.hasta).toBe('2026-12-08');
      expect(
        cuerpo.vehiculos.find((v) => v.vehiculoId === vehiculo)?.disponibilidad,
      ).toBe('DISPONIBLE');

      await request(servidor())
        .get(
          `${API}/administracion/flota/vehiculos/disponibilidad?fecha=2026-02-30`,
        )
        .set(como(ADMINISTRADOR))
        .expect(400);
    });

    it('sin asignación, la baja es lógica, deja sin vehículo a su habitual y se reactiva', async () => {
      await desasignar(operativoNormal).expect(200);

      const respuesta = await request(servidor())
        .delete(`${API}/administracion/vehiculos/${vehiculo}`)
        .set(como(ADMINISTRADOR))
        .expect(200);

      const baja = respuesta.body as {
        registro: { activo: boolean; estado: string; bajaEn: string | null };
      };
      expect(baja.registro.activo).toBe(false);
      // D1 (2026-10-20): queda con fecha y autor, y el estado se deriva de `activo`.
      expect(baja.registro.estado).toBe('DE_BAJA');
      expect(baja.registro.bajaEn).not.toBeNull();
      const guardado = await prisma.vehiculo.findUniqueOrThrow({
        where: { id: vehiculo },
      });
      expect(guardado.bajaEn).not.toBeNull();
      expect(guardado.bajaPor).not.toBeNull();

      // D3: su conductor habitual queda «sin vehículo».
      const habitual = await prisma.conductor.findUniqueOrThrow({
        where: { id: conductor },
      });
      expect(habitual.vehiculoHabitualId).toBeNull();

      // Sigue existiendo y se puede reactivar.
      const reactivado = await request(servidor())
        .patch(`${API}/administracion/vehiculos/${vehiculo}/reactivar`)
        .set(como(ADMINISTRADOR))
        .expect(200);
      expect((reactivado.body as { activo: boolean }).activo).toBe(true);
      const reactivadoEnBase = await prisma.vehiculo.findUniqueOrThrow({
        where: { id: vehiculo },
      });
      expect(reactivadoEnBase.bajaEn).toBeNull();
      expect(reactivadoEnBase.bajaPor).toBeNull();
    });
  });
});
