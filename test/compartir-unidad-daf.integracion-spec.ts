/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · compartir unidad
 * Archivo: compartir-unidad-daf.integracion-spec.ts
 * Responsabilidad: Verificar de punta a punta que la DAF comparte una unidad y que quitar al
 *                  anfitrión libera a su invitado.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 *
 * Con la aplicación entera y la base de pruebas: dos operativos «solo dejar» del mismo punto y
 * hora; el primero se asigna por la API, el segundo comparte su unidad, la política deja de verlo
 * como un choque y quitar al primero suelta al segundo. Las ventanas de carga se apagan mientras
 * corre y se reponen enteras al terminar; los datos llevan prefijo y se borran.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccesoFormulario,
  AreaPersonal,
  PoliticaVehiculo,
  RolDepartamental,
  TipoContrato,
  TipoTransporte,
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

const DAF = '4';
const API = '/api/v1';
const PREFIJO = 'PRUEBA_CMPD';
const PLACA = 'PCD';
/** Un miércoles lejano: no choca con datos reales ni con «hoy». */
const DIA = '2031-04-16';

describe('Compartir unidad · la DAF · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ventanasIniciales: VentanaCarga[] = [];
  let formularioId = 0;
  let zonaId = 0;
  let puntoId = 0;
  let cuadroId = 0;
  let vehiculoId = 0;
  let conductorId = 0;
  let anfitrionId = 0;
  let invitadoId = 0;
  let secuencial = 0;

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

    zonaId = (await prisma.zonal.findFirstOrThrow({ where: { activo: true } }))
      .id;
    formularioId = (
      await prisma.formulario.create({
        data: {
          numero: 2,
          codigo: `${PREFIJO}_PMO`,
          nombre: 'FORMULARIO COMPARTIR DAF',
          colorFondo: '#EEEEEE',
          colorAcento: '#000000',
          colorNombre: 'gris',
          rolDueno: RolDepartamental.DMIP_OPERATIVOS,
          politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
          orden: 2,
          prefijos: { create: [{ prefijo: 'CMD', esPredeterminado: true }] },
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
      })
    ).id;
    await prisma.zonalFormulario.create({
      data: { formularioId, zonaId, nombre: 'Zonal de prueba', orden: 1 },
    });
    puntoId = (
      await prisma.puntoEncuentro.create({
        data: { formularioId, zonalId: zonaId, nombre: `${PREFIJO} Plaza` },
      })
    ).id;
    cuadroId = (
      await prisma.cuadroDiario.create({
        data: {
          fecha: new Date(`${DIA}T00:00:00.000Z`),
          ordenTrabajo: `${PREFIJO}-OT-001`,
          nroSemana: 16,
          anioSemana: 2031,
        },
      })
    ).id;
    vehiculoId = (
      await prisma.vehiculo.create({
        data: {
          placa: `${PLACA}-0001`,
          descripcion: `${PREFIJO} camioneta`,
          asientos: 8,
        },
      })
    ).id;
    conductorId = (
      await prisma.conductor.create({
        data: {
          cedula: '8888880801',
          nombreCompleto: `${PREFIJO} CONDUCTOR`,
          licenciaTipo: 'E',
          vehiculoHabitualId: vehiculoId,
        },
      })
    ).id;

    anfitrionId = await crearOperativo('8888880811');
    invitadoId = await crearOperativo('8888880812');
  });

  afterAll(async () => {
    await limpiar();
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
    await app.close();
  });

  /** Los tramos sujetan conductor y vehículo (Restrict): se borran antes que ellos. */
  const limpiar = async (): Promise<void> => {
    await prisma.tramoTransporte.deleteMany({
      where: { fecha: new Date(`${DIA}T00:00:00.000Z`) },
    });
    await prisma.cuadroDiario.deleteMany({
      where: { ordenTrabajo: { startsWith: PREFIJO } },
    });
    await prisma.conductor.deleteMany({
      where: { nombreCompleto: { startsWith: PREFIJO } },
    });
    await prisma.vehiculo.deleteMany({
      where: { descripcion: { startsWith: PREFIJO } },
    });
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
    await prisma.funcionario.deleteMany({
      where: { apellidos: { startsWith: PREFIJO } },
    });
  };

  /** Un operativo de 08:00 a 12:00 en el punto («solo dejar» por omisión), con una persona propia. */
  const crearOperativo = async (
    cedula: string,
    tipoTransporte: TipoTransporte = TipoTransporte.SOLO_INICIO,
  ): Promise<number> => {
    secuencial += 1;
    const funcionario = await prisma.funcionario.create({
      data: {
        cedula,
        apellidos: `${PREFIJO}_PERSONA`,
        nombres: String(secuencial),
        area: AreaPersonal.GENERAL,
        tipoContrato: TipoContrato.NOMBRAMIENTO,
        direccion: RolDepartamental.DMIP_OPERATIVOS,
      },
    });
    const operativo = await prisma.operativo.create({
      data: {
        cuadroId,
        formularioId,
        identificador: `${PREFIJO}-${String(secuencial).padStart(3, '0')}`,
        secuencial,
        horaInicio: '08:00',
        horaFin: '12:00',
        esNocturno: false,
        cruzaMedianoche: false,
        duracionHoras: 4,
        puntoEncuentroId: puntoId,
        tipoLibre: 'Tipo de prueba',
        tipoTransporte,
        creadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
        creadoPor: 1,
        modificadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
        modificadoPor: 1,
        zonales: { create: [{ zonalId: zonaId, orden: 1 }] },
        personal: {
          create: [
            {
              funcionarioId: funcionario.id,
              asignadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
              horaInicio: '08:00',
              horaFin: '12:00',
            },
          ],
        },
      },
    });
    return operativo.id;
  };

  const servidor = (): Server => app.getHttpServer() as Server;
  const tramosDe = (operativoId: number) =>
    prisma.tramoTransporte.findMany({ where: { operativoId } });

  it('el anfitrión se asigna y el invitado, por su cuenta, chocaría con él (SOLAPAMIENTO)', async () => {
    await request(servidor())
      .post(`${API}/transporte/tramos/asignar`)
      .set(como(DAF))
      .send({
        fecha: DIA,
        operativoIds: [anfitrionId],
        conductorId,
        vehiculoId,
      })
      .expect(200);

    const respuesta = await request(servidor())
      .post(`${API}/transporte/tramos/asignar`)
      .set(como(DAF))
      .send({ fecha: DIA, operativoIds: [invitadoId], conductorId, vehiculoId })
      .expect(409);
    expect((respuesta.body as { mensaje: string }).mensaje).toContain(
      'Se pisa',
    );
  });

  it('compartibles ofrece al anfitrión, compatible y con sus asientos libres', async () => {
    const respuesta = await request(servidor())
      .get(`${API}/transporte/tramos/${invitadoId}/compartibles`)
      .set(como(DAF))
      .expect(200);
    const cuerpo = respuesta.body as {
      anfitriones: {
        operativoId: number;
        compatible: boolean;
        asientosLibres: number;
      }[];
    };
    expect(cuerpo.anfitriones).toEqual([
      expect.objectContaining({
        operativoId: anfitrionId,
        compatible: true,
        asientosLibres: 7,
      }),
    ]);
  });

  it('compartir: el invitado viaja con el conductor y la placa del anfitrión', async () => {
    await request(servidor())
      .post(`${API}/transporte/tramos/compartir`)
      .set(como(DAF))
      .send({ operativoId: invitadoId, anfitrionOperativoId: anfitrionId })
      .expect(200);

    const [anfitrion] = await tramosDe(anfitrionId);
    const [invitado] = await tramosDe(invitadoId);
    expect(invitado).toMatchObject({
      conductorId,
      vehiculoId,
      compartidoConTramoId: anfitrion.id,
    });
    const operativo = await prisma.operativo.findUniqueOrThrow({
      where: { id: invitadoId },
    });
    expect(operativo.estadoTransporte).toBe('ASIGNADO');
  });

  it('quitar al anfitrión suelta al invitado y lo avisa', async () => {
    const [anfitrion] = await tramosDe(anfitrionId);

    const respuesta = await request(servidor())
      .delete(`${API}/transporte/tramos/${anfitrion.id}/asignacion`)
      .set(como(DAF))
      .expect(200);

    expect(
      (respuesta.body as { liberados: { operativoId: number }[] }).liberados,
    ).toEqual([expect.objectContaining({ operativoId: invitadoId })]);
    const [invitado] = await tramosDe(invitadoId);
    expect(invitado).toMatchObject({
      conductorId: null,
      vehiculoId: null,
      compartidoConTramoId: null,
    });
    const operativo = await prisma.operativo.findUniqueOrThrow({
      where: { id: invitadoId },
    });
    expect(operativo.estadoTransporte).toBe('PENDIENTE');
  });

  /*
    «COMPLETO» COMPARTE UNIDAD (2026-10-20). Un «completo» de 08:00 a 12:00 en el mismo punto: la unidad
    que lo acompaña todo el día deja al personal del anfitrión sin moverse. La DAF lo une a la unidad del
    anfitrión y los dos quedan con el mismo conductor y la misma placa, en un solo grupo.
  */
  it('un «completo» en el mismo punto va en la unidad del anfitrión (contención)', async () => {
    await request(servidor())
      .post(`${API}/transporte/tramos/asignar`)
      .set(como(DAF))
      .send({
        fecha: DIA,
        operativoIds: [anfitrionId],
        conductorId,
        vehiculoId,
      })
      .expect(200);
    const completoId = await crearOperativo(
      '8888880813',
      TipoTransporte.COMPLETO,
    );

    const compartibles = await request(servidor())
      .get(`${API}/transporte/tramos/${completoId}/compartibles`)
      .set(como(DAF))
      .expect(200);
    expect(
      (
        compartibles.body as {
          anfitriones: {
            operativoId: number;
            compatible: boolean;
            completo: string;
          }[];
        }
      ).anfitriones,
    ).toEqual([
      expect.objectContaining({
        operativoId: anfitrionId,
        compatible: true,
        completo: 'ABARCA',
      }),
    ]);

    await request(servidor())
      .post(`${API}/transporte/tramos/compartir`)
      .set(como(DAF))
      .send({ operativoId: completoId, anfitrionOperativoId: anfitrionId })
      .expect(200);

    // Desde el 2026-10-21 el «completo» es la RAÍZ de la unidad: el dejar del anfitrión pasa a su grupo.
    const [anfitrion] = await tramosDe(anfitrionId);
    const [completo] = await tramosDe(completoId);
    expect(completo).toMatchObject({
      tipo: 'COMPLETO',
      conductorId,
      vehiculoId,
      compartidoConTramoId: null,
    });
    expect(anfitrion).toMatchObject({
      conductorId,
      vehiculoId,
      compartidoConTramoId: completo.id,
    });
    completoTramoId = completo.id;
  });

  let completoTramoId = 0;

  /*
    LA ASIGNACIÓN AUTOMÁTICA TAMBIÉN (2026-10-21). Un «solo retirar» del mismo punto, al final de la
    jornada del «completo»: el optimizador lo propone en la unidad del «completo» y la confirmación lo
    deja en su grupo, con la traza. El invitado que quedó suelto (su «solo dejar» de las 08:00) también
    cae dentro del «completo»: va con él.
  */
  it('el optimizador lleva un «solo retirar» del mismo punto en la unidad del «completo» y lo confirma', async () => {
    const retiroId = await crearOperativo(
      '8888880814',
      TipoTransporte.SOLO_FIN,
    );
    const propuesta = await request(servidor())
      .post(`${API}/transporte/optimizar`)
      .set(como(DAF))
      .send({ fecha: DIA })
      .expect(200);
    const cuerpo = propuesta.body as {
      asignaciones: { tramoIds: number[]; conductorId: number }[];
      compartidos: { tramoId: number; compartidoConTramoId: number }[];
    };
    const [retiro] = await tramosDe(retiroId);
    const [dejar] = await tramosDe(invitadoId);
    expect(
      [...cuerpo.compartidos].sort((a, b) => a.tramoId - b.tramoId),
    ).toEqual([
      { tramoId: dejar.id, compartidoConTramoId: completoTramoId },
      { tramoId: retiro.id, compartidoConTramoId: completoTramoId },
    ]);

    const confirmacion = await request(servidor())
      .post(`${API}/transporte/optimizar/confirmar`)
      .set(como(DAF))
      .send({
        fecha: DIA,
        asignaciones: cuerpo.asignaciones,
        compartidos: cuerpo.compartidos,
      })
      .expect(200);
    expect((confirmacion.body as { compartidos: number }).compartidos).toBe(2);
    const [despues] = await tramosDe(retiroId);
    expect(despues).toMatchObject({
      conductorId,
      vehiculoId,
      compartidoConTramoId: completoTramoId,
    });
  });

  /*
    LOS ASIENTOS SE CUENTAN POR MOMENTO (2026-10-21). Con 3 asientos, la unidad lleva al dejar al
    «completo» y a los dos dejar (3), y al retirar al «completo» y al retiro (2): otro retiro cabe
    (3 de 3 a su hora) y otro dejar no (serían 4 a las 08:00).
  */
  it('con 3 asientos cabe otro retiro y no otro dejar: los asientos se cuentan por momento', async () => {
    await prisma.vehiculo.update({
      where: { id: vehiculoId },
      data: { asientos: 3 },
    });
    const otroRetiroId = await crearOperativo(
      '8888880815',
      TipoTransporte.SOLO_FIN,
    );
    const otroDejarId = await crearOperativo('8888880816');
    type Lista = {
      anfitriones: {
        operativoId: number;
        compatible: boolean;
        motivo: string | null;
        asientosPorMomento: { tipo: string; ocupados: number }[];
      }[];
    };

    const retiro = await request(servidor())
      .get(`${API}/transporte/tramos/${otroRetiroId}/compartibles`)
      .set(como(DAF))
      .expect(200);
    expect((retiro.body as Lista).anfitriones[0]).toMatchObject({
      compatible: true,
      asientosPorMomento: [{ tipo: 'RETIRAR', ocupados: 3 }],
    });

    const dejar = await request(servidor())
      .get(`${API}/transporte/tramos/${otroDejarId}/compartibles`)
      .set(como(DAF))
      .expect(200);
    expect((dejar.body as Lista).anfitriones[0]).toMatchObject({
      compatible: false,
      motivo:
        'No caben a las 08:00: la unidad llevaría 4 personas y el vehículo tiene 3 asientos.',
    });
  });
});
