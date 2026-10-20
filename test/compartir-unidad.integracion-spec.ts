/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Registro del operativo · compartir unidad
 * Archivo: compartir-unidad.integracion-spec.ts
 * Responsabilidad: Verificar de punta a punta las coincidencias para compartir unidad.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 *
 * Lo que protege, con la aplicación entera (incluido `transporte`, que responde por el puerto):
 *
 *   · que la coincidencia sea mismo día, punto, zonal y horario que se cruza, con transporte DAF;
 *   · que la compatibilidad de tramos la decida la regla del optimizador («solo dejar» con
 *     «solo retirar» no va junto);
 *   · RN-48: otro departamento no ve las coincidencias de este formulario.
 *
 * Solo lecturas: los operativos se siembran en la base, así que la ventana de carga no interviene.
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

const OPERATIVOS = '1';
const INSPECCIONES = '2';
const API = '/api/v1';
const PREFIJO = 'PRUEBA_COMP';
/** Un día lejano: no choca con datos reales ni con «hoy». */
const DIA = '2031-04-14';

interface Coincidencia {
  operativoId: number;
  identificador: string;
  personal: string[];
  compatible: boolean;
  motivo?: string;
}

describe('Compartir unidad · coincidencias del registro · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let formularioId = 0;
  let zonaId = 0;
  let puntoId = 0;
  let cuadroId = 0;
  let funcionarioId = 0;
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

    zonaId = (await prisma.zonal.findFirstOrThrow({ where: { activo: true } }))
      .id;
    formularioId = (
      await prisma.formulario.create({
        data: {
          numero: 2,
          codigo: `${PREFIJO}_PMO`,
          nombre: 'FORMULARIO COMPARTIR',
          colorFondo: '#EEEEEE',
          colorAcento: '#000000',
          colorNombre: 'gris',
          rolDueno: RolDepartamental.DMIP_OPERATIVOS,
          politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
          orden: 2,
          prefijos: { create: [{ prefijo: 'CMP', esPredeterminado: true }] },
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
    funcionarioId = (
      await prisma.funcionario.create({
        data: {
          cedula: '8888880701',
          apellidos: `${PREFIJO}_PERSONA`,
          nombres: 'UNO',
          area: AreaPersonal.GENERAL,
          tipoContrato: TipoContrato.NOMBRAMIENTO,
          direccion: RolDepartamental.DMIP_OPERATIVOS,
        },
      })
    ).id;

    await crearOperativo('08:00', '12:00', TipoTransporte.SOLO_INICIO);
    await crearOperativo('08:00', '12:00', TipoTransporte.SOLO_FIN);
    await crearOperativo('14:00', '18:00', TipoTransporte.SOLO_INICIO);
    await crearOperativo('08:00', '12:00', TipoTransporte.PROPIOS_MEDIOS);
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  /** El cuadro arrastra sus operativos; el formulario, su zonal y su punto. */
  const limpiar = async (): Promise<void> => {
    await prisma.cuadroDiario.deleteMany({
      where: { ordenTrabajo: { startsWith: PREFIJO } },
    });
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
    await prisma.funcionario.deleteMany({
      where: { apellidos: { startsWith: PREFIJO } },
    });
  };

  const crearOperativo = async (
    horaInicio: string,
    horaFin: string,
    tipoTransporte: TipoTransporte,
  ): Promise<void> => {
    secuencial += 1;
    await prisma.operativo.create({
      data: {
        cuadroId,
        formularioId,
        identificador: `${PREFIJO}-${String(secuencial).padStart(3, '0')}`,
        secuencial,
        horaInicio,
        horaFin,
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
              funcionarioId,
              asignadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
              horaInicio,
              horaFin,
            },
          ],
        },
      },
    });
  };

  const servidor = (): Server => app.getHttpServer() as Server;
  const consultar = (identidad: string) =>
    request(servidor())
      .get(`${API}/operativos/coincidencias-transporte`)
      .query({
        fecha: DIA,
        puntoEncuentroId: puntoId,
        zonalId: zonaId,
        horaInicio: '08:00',
        horaFin: '12:00',
        tipoTransporte: 'SOLO_INICIO',
      })
      .set(como(identidad));

  it('lista los del mismo punto y horario con transporte DAF, y dice cuáles van juntos', async () => {
    const respuesta = await consultar(OPERATIVOS).expect(200);
    const lista = respuesta.body as Coincidencia[];

    // El de las 14:00 no se cruza; el de propios medios no pide unidad.
    expect(lista.map((c) => c.identificador).sort()).toEqual([
      `${PREFIJO}-001`,
      `${PREFIJO}-002`,
    ]);
    const soloDeja = lista.find((c) => c.identificador === `${PREFIJO}-001`);
    const soloRetira = lista.find((c) => c.identificador === `${PREFIJO}-002`);
    expect(soloDeja).toMatchObject({
      compatible: true,
      personal: [`${PREFIJO}_PERSONA UNO`],
    });
    // CAMBIÓ el 2026-10-19 («retirar es otro estado»): el retiro de las 11:30 no se cruza con el
    // dejar de las 08:00, así que la misma unidad lo hace después.
    expect(soloRetira).toMatchObject({
      compatible: true,
      comparte: [],
      propios: ['dejar'],
    });
  });

  it('RN-48 · otro departamento no ve las coincidencias de este formulario', async () => {
    const respuesta = await consultar(INSPECCIONES).expect(200);

    expect(respuesta.body).toEqual([]);
  });

  it('valida la entrada: un tipo sin transporte DAF no se consulta (400)', async () => {
    await request(servidor())
      .get(`${API}/operativos/coincidencias-transporte`)
      .query({
        fecha: DIA,
        puntoEncuentroId: puntoId,
        zonalId: zonaId,
        horaInicio: '08:00',
        horaFin: '12:00',
        tipoTransporte: 'PROPIOS_MEDIOS',
      })
      .set(como(OPERATIVOS))
      .expect(400);
  });

  /*
    NOTAS DE LA TABLA (2026-10-19, plan «acciones-icono-notas»): el listado trae `notas`, con la
    bitácora como NOTA y la solicitud de compartir como COMPARTIDA, sin tocar `observaciones`.
  */
  it('el listado trae las notas: la de la bitácora y la compartida, con autor y la más reciente primero', async () => {
    const [anfitrion, invitado] = await prisma.operativo.findMany({
      where: { cuadroId },
      orderBy: { secuencial: 'asc' },
      take: 2,
    });
    await prisma.operativo.update({
      where: { id: invitado.id },
      data: {
        compartirConId: anfitrion.id,
        compartirSolicitadoPor: 1,
        compartirSolicitadoEn: new Date('2031-04-01T15:00:00.000Z'),
        observaciones: {
          create: [
            {
              texto: 'Pruebas técnicas 3',
              creadoPor: 1,
              creadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
              creadoEn: new Date('2031-04-01T14:00:00.000Z'),
            },
          ],
        },
      },
    });

    const respuesta = await request(servidor())
      .get(`${API}/operativos`)
      .query({ fecha: DIA, formulario: `${PREFIJO}_PMO`, tamanio: 50 })
      .set(como(OPERATIVOS))
      .expect(200);

    const fila = (
      respuesta.body as {
        datos: {
          id: number;
          observaciones: unknown[];
          notas: { tipo: string; texto: string; autor: string; operativoRelacionadoId: number | null }[];
        }[];
      }
    ).datos.find((operativo) => operativo.id === invitado.id);

    expect(fila?.observaciones).toHaveLength(1);
    expect(fila?.notas.map((nota) => nota.tipo)).toEqual(['COMPARTIDA', 'NOTA']);
    expect(fila?.notas[0]).toMatchObject({
      texto: `Comparte con ${anfitrion.identificador}`,
      operativoRelacionadoId: anfitrion.id,
    });
    expect(fila?.notas.every((nota) => nota.autor.length > 0)).toBe(true);
  });
});
