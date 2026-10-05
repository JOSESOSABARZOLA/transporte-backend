/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Solicitud de apoyo interdirección
 * Archivo: solicitud-apoyo.integracion-spec.ts
 * Responsabilidad: Verificar los cinco casos del plan contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL CASO 4 SOLO SE VE AQUÍ. «La dirección requerida consulta y ve la solicitud» exige
 * comprobar dos cosas a la vez: que la bandeja se la muestra **y** que el operativo, que
 * es de otro formulario, le sigue estando vedado por PER-02. Con dobles se vería la
 * primera mitad y no la segunda, que es la que hace necesaria la bandeja.
 *
 * Las ventanas de carga se desactivan mientras corre, como en M-13, M-14 y M-15.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AreaPersonal,
  EstadoSolicitud,
  PoliticaVehiculo,
  AccesoFormulario,
  RolDepartamental,
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

const PREFIJO = 'PRUEBA_M16';
const API = '/api/v1';

const OPERATIVOS = '1';
const INSPECCIONES = '2';
const INSTRUCTOR = '3';
const DAF = '4';
const DIRECTOR = '5';

const FECHA = '2026-11-11';

interface SolicitudRespuesta {
  id: number;
  estado: EstadoSolicitud;
  rolSolicitante: string;
  rolRequerido: string;
  areaRequerida: string | null;
  cantidad: number;
  observacion: string | null;
  operativo: {
    id: number;
    identificador: string;
    cuadroFecha: string;
    horario: string;
    formularioNombre: string;
  };
}

describe('Solicitud de apoyo interdirección · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ventanasIniciales: VentanaCarga[] = [];

  let operativoDeInspecciones = 0;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication({ bufferLogs: true });
    app.use(correlacionMiddleware);
    // La identidad viaja en la cookie de sesion: sin esto `request.cookies` es indefinido
    // y toda peticion recibe 401. Lo registra tambien `main.ts`.
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

    const institucionales = await prisma.formulario.count({
      where: { codigo: { not: { startsWith: PREFIJO } } },
    });
    if (institucionales > 0) {
      throw new Error(
        't_formulario ya tiene formularios institucionales. Esta prueba crea el suyo con el número 2 y chocaría con ellos: revise la estrategia de datos de prueba antes de continuar.',
      );
    }

    const formulario = await prisma.formulario.create({
      data: {
        numero: 2,
        codigo: `${PREFIJO}_INSP`,
        nombre: 'FORMULARIO DE PRUEBA M16',
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno: RolDepartamental.DMIP_INSPECCIONES,
        politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
        orden: 2,
        // Autorización en t_formulario_rol (2026-08-25): el dueño registra (ESCRITURA).
        roles: {
          create: [
            {
              rol: RolDepartamental.DMIP_INSPECCIONES,
              acceso: AccesoFormulario.ESCRITURA,
            },
          ],
        },
        prefijos: { create: [{ prefijo: 'APO', esPredeterminado: true }] },
        areas: { create: [{ area: AreaPersonal.GENERAL }] },
      },
    });

    const zonal = await prisma.zonal.findFirst({ orderBy: { orden: 'asc' } });
    const punto = await prisma.puntoEncuentro.create({
      data: {
        nombre: `${PREFIJO} PUNTO`,
        zonalId: zonal?.id as number,
        formularios: { create: [{ formularioId: formulario.id }] },
      },
    });
    const tipo = await prisma.tipoControl.create({
      data: {
        nombre: `${PREFIJO} CONTROL`,
        formularioId: formulario.id,
      },
    });
    const entidad = await prisma.institucion.create({
      data: {
        sigla: `${PREFIJO}AMT`,
        nombre: 'Agencia de prueba M16',
        formularios: { create: [{ formularioId: formulario.id }] },
      },
    });

    await prisma.cuadroDiario.create({
      data: {
        fecha: new Date(`${FECHA}T00:00:00.000Z`),
        ordenTrabajo: `${PREFIJO}-OT-001`,
        nroSemana: 46,
        anioSemana: 2026,
      },
    });

    const creado = await request(servidor())
      .post(`${API}/operativos`)
      .set(como(INSPECCIONES))
      .send({
        cuadroFecha: FECHA,
        formularioCodigo: `${PREFIJO}_INSP`,
        horaInicio: '08:00',
        horaFin: '12:00',
        zonalesIds: [zonal?.id],
        puntoEncuentroId: punto.id,
        tipoControlId: tipo.id,
        institucionesIds: [entidad.id],
      })
      .expect(201);

    operativoDeInspecciones = (creado.body as { id: number }).id;
  });

  afterAll(async () => {
    await limpiar();

    for (const original of ventanasIniciales) {
      await prisma.ventanaCarga.update({
        where: { rol: original.rol },
        data: { activo: original.activo },
      });
    }
    await app.close();
  });

  const limpiar = async (): Promise<void> => {
    await prisma.cuadroDiario.deleteMany({
      where: { ordenTrabajo: { startsWith: PREFIJO } },
    });
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
    await prisma.puntoEncuentro.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.tipoControl.deleteMany({
      where: { nombre: { startsWith: PREFIJO } },
    });
    await prisma.institucion.deleteMany({
      where: { sigla: { startsWith: PREFIJO } },
    });
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  const solicitar = (usuario: string, cuerpo: Record<string, unknown>) =>
    request(servidor())
      .post(`${API}/operativos/${operativoDeInspecciones}/apoyo`)
      .set(como(usuario))
      .send(cuerpo);

  describe('registro', () => {
    it('caso 1 · solicita apoyo a otra dirección y queda en SOLICITADA', async () => {
      const respuesta = await solicitar(INSPECCIONES, {
        rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
        areaRequerida: AreaPersonal.INSTRUCCION,
        cantidad: 2,
        observacion: 'Operativo conjunto en el sector norte.',
      }).expect(201);

      const solicitud = respuesta.body as SolicitudRespuesta;

      expect(solicitud.estado).toBe(EstadoSolicitud.SOLICITADA);
      expect(solicitud.rolSolicitante).toBe(RolDepartamental.DMIP_INSPECCIONES);
      expect(solicitud.rolRequerido).toBe(RolDepartamental.DMIT_INSTRUCTOR);
      expect(solicitud.cantidad).toBe(2);
      expect(solicitud.operativo.identificador).toBe('APO-001-11-NOV-2026');
    });

    it('caso 2 · cantidad cero responde 400', async () => {
      const respuesta = await solicitar(INSPECCIONES, {
        rolRequerido: RolDepartamental.DMIP_OPERATIVOS,
        cantidad: 0,
      }).expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'al menos una persona',
      );
    });

    it('una cantidad negativa o no entera también', async () => {
      await solicitar(INSPECCIONES, {
        rolRequerido: RolDepartamental.DMIP_OPERATIVOS,
        cantidad: -3,
      }).expect(400);

      await solicitar(INSPECCIONES, {
        rolRequerido: RolDepartamental.DMIP_OPERATIVOS,
        cantidad: 1.5,
      }).expect(400);
    });

    it('caso 3 · solicitar apoyo a la propia dirección responde 400', async () => {
      const respuesta = await solicitar(INSPECCIONES, {
        rolRequerido: RolDepartamental.DMIP_INSPECCIONES,
        cantidad: 1,
      }).expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'otra dirección',
      );
    });

    it('una dirección sin personal operativo responde 400', async () => {
      const respuesta = await solicitar(INSPECCIONES, {
        rolRequerido: RolDepartamental.DAF,
        cantidad: 1,
      }).expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'no aporta personal',
      );
    });

    it('el estado o el solicitante en el cuerpo se rechazan', async () => {
      const respuesta = await solicitar(INSPECCIONES, {
        rolRequerido: RolDepartamental.DMIP_OPERATIVOS,
        cantidad: 1,
        estado: EstadoSolicitud.ATENDIDA,
      }).expect(400);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CAMPOS_NO_PERMITIDOS');
      expect(cuerpo.mensaje).toContain('estado');

      await solicitar(INSPECCIONES, {
        rolRequerido: RolDepartamental.DMIP_OPERATIVOS,
        cantidad: 1,
        rolSolicitante: RolDepartamental.DIRECTOR,
      }).expect(400);
    });

    it('una solicitud idéntica ya abierta se rechaza', async () => {
      const respuesta = await solicitar(INSPECCIONES, {
        rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
        areaRequerida: AreaPersonal.INSTRUCCION,
        cantidad: 5,
      }).expect(400);

      const mensaje = (respuesta.body as { mensaje: string }).mensaje;
      expect(mensaje).toContain('Ya hay una solicitud de apoyo abierta');
      expect(mensaje).toContain('APO-001-11-NOV-2026');
    });

    it('a la misma dirección pero de otra área, sí', async () => {
      const respuesta = await solicitar(INSPECCIONES, {
        rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
        areaRequerida: AreaPersonal.TECNICO,
        cantidad: 1,
      }).expect(201);

      expect((respuesta.body as SolicitudRespuesta).areaRequerida).toBe(
        AreaPersonal.TECNICO,
      );
    });

    it('el operativo tiene que ser del departamento que solicita', async () => {
      const respuesta = await solicitar(OPERATIVOS, {
        rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
        cantidad: 1,
      }).expect(403);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'FORMULARIO_NO_AUTORIZADO',
      );
    });
  });

  describe('autorización', () => {
    it('caso 5 · un rol no departamental no puede solicitar', async () => {
      const respuesta = await solicitar(DIRECTOR, {
        rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
        cantidad: 1,
      }).expect(403);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'PERMISO_INSUFICIENTE',
      );
    });

    it('la DAF tampoco', async () => {
      await solicitar(DAF, {
        rolRequerido: RolDepartamental.DMIT_INSTRUCTOR,
        cantidad: 1,
      }).expect(403);
    });

    it('sin identidad responde 401', async () => {
      await request(servidor())
        .post(`${API}/operativos/${operativoDeInspecciones}/apoyo`)
        .send({ rolRequerido: RolDepartamental.DMIT_INSTRUCTOR, cantidad: 1 })
        .expect(401);
    });
  });

  describe('caso 4 · la dirección requerida consulta', () => {
    it('ve la solicitud en su bandeja, con el contexto del operativo', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/solicitudes-apoyo?fecha=${FECHA}`)
        .set(como(INSTRUCTOR))
        .expect(200);

      const solicitudes = respuesta.body as SolicitudRespuesta[];

      expect(solicitudes.length).toBeGreaterThan(0);
      expect(
        solicitudes.every(
          (solicitud) =>
            solicitud.rolRequerido === RolDepartamental.DMIT_INSTRUCTOR,
        ),
      ).toBe(true);

      // Lo que necesita para decidir a quién manda.
      const primera = solicitudes[0];
      expect(primera.operativo.identificador).toBe('APO-001-11-NOV-2026');
      expect(primera.operativo.horario).toBe('08H00 A 12H00');
      expect(primera.operativo.formularioNombre).toBe(
        'FORMULARIO DE PRUEBA M16',
      );
      expect(primera.operativo.cuadroFecha).toBe(FECHA);
    });

    it('y NO puede abrir el operativo ajeno: por eso hace falta la bandeja', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/operativos/${operativoDeInspecciones}`)
        .set(como(INSTRUCTOR))
        .expect(403);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'FORMULARIO_NO_AUTORIZADO',
      );
    });

    it('quien solicitó también las ve en su bandeja', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/solicitudes-apoyo?fecha=${FECHA}`)
        .set(como(INSPECCIONES))
        .expect(200);

      const solicitudes = respuesta.body as SolicitudRespuesta[];
      expect(
        solicitudes.every(
          (solicitud) =>
            solicitud.rolSolicitante === RolDepartamental.DMIP_INSPECCIONES,
        ),
      ).toBe(true);
    });

    it('una dirección que no interviene no ve nada', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/solicitudes-apoyo?fecha=${FECHA}`)
        .set(como(OPERATIVOS))
        .expect(200);

      expect(respuesta.body).toHaveLength(0);
    });

    it('la Dirección las ve todas', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/solicitudes-apoyo?fecha=${FECHA}`)
        .set(como(DIRECTOR))
        .expect(200);

      expect((respuesta.body as SolicitudRespuesta[]).length).toBe(2);
    });

    it('el filtro por estado funciona', async () => {
      const abiertas = await request(servidor())
        .get(`${API}/solicitudes-apoyo?estado=SOLICITADA`)
        .set(como(DIRECTOR))
        .expect(200);

      const atendidas = await request(servidor())
        .get(`${API}/solicitudes-apoyo?estado=ATENDIDA`)
        .set(como(DIRECTOR))
        .expect(200);

      expect((abiertas.body as SolicitudRespuesta[]).length).toBe(2);
      expect(atendidas.body).toHaveLength(0);
    });

    it('un estado inexistente responde 400', async () => {
      await request(servidor())
        .get(`${API}/solicitudes-apoyo?estado=INVENTADO`)
        .set(como(DIRECTOR))
        .expect(400);
    });
  });

  describe('consulta por operativo', () => {
    it('el dueño ve lo que pidió para su operativo', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/operativos/${operativoDeInspecciones}/apoyo`)
        .set(como(INSPECCIONES))
        .expect(200);

      expect((respuesta.body as SolicitudRespuesta[]).length).toBe(2);
    });

    it('un departamento ajeno no', async () => {
      await request(servidor())
        .get(`${API}/operativos/${operativoDeInspecciones}/apoyo`)
        .set(como(OPERATIVOS))
        .expect(403);
    });
  });

  describe('la traza', () => {
    it('cada solicitud queda auditada con su rol y su operativo', async () => {
      // Se filtra por el operativo de ESTA ejecución: `fk_auditoria_operativo` es
      // ON DELETE SET NULL, así que las trazas de corridas anteriores siguen en la
      // tabla —sin operativo— y contarlas todas haría que la prueba fallara la segunda
      // vez que se ejecuta.
      const trazas = await prisma.auditoria.findMany({
        where: {
          entidad: 't_solicitud_apoyo',
          operativoId: operativoDeInspecciones,
        },
        orderBy: { id: 'asc' },
      });

      expect(trazas.length).toBe(2);
      expect(trazas[0].accion).toBe('CREAR');
      expect(trazas[0].rol).toBe(RolDepartamental.DMIP_INSPECCIONES);
      expect(trazas[0].operativoId).toBe(operativoDeInspecciones);
    });
  });
});
