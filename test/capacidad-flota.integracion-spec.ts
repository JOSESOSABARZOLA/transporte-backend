/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Capacidad de flota
 * Archivo: capacidad-flota.integracion-spec.ts
 * Responsabilidad: Verificar los cinco casos del plan contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL CASO 1 SOLO SE VE AQUÍ. «Declarar 15 vehículos y demandar 18 → advertencia; **la
 * asignación sigue permitida**». La segunda mitad es la que importa y la que con dobles
 * no se comprueba: hay que declarar una capacidad insuficiente y **después asignar
 * transporte de verdad**, comprobando que el `200` llega igual.
 *
 * La demanda se construye registrando operativos reales, porque sale de contarlos.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AreaPersonal,
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

const PREFIJO = 'PRUEBA_M18';
const API = '/api/v1';

const OPERATIVOS_ROL = '1';
const DAF = '4';
const DIRECTOR = '5';
const ADMINISTRADOR = '6';

const FECHA = '2027-01-20';
const FECHA_SIN_CUADRO = '2027-01-21';

interface CapacidadRespuesta {
  fecha: string;
  declarada: {
    vehiculosHabiles: number;
    conductoresHabiles: number;
    observacion: string | null;
  } | null;
  demanda: { vehiculos: number; conductores: number };
  vehiculos: {
    declarados: number;
    requeridos: number;
    excedente: number;
  } | null;
  hayAdvertencia: boolean;
  advertencia: string | null;
}

describe('Capacidad de flota · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ventanasIniciales: VentanaCarga[] = [];

  let conductor = 0;
  let vehiculo = 0;
  let primerOperativo = 0;

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
        't_formulario ya tiene formularios institucionales. Esta prueba crea el suyo con el número 3 y chocaría con ellos: revise la estrategia de datos de prueba antes de continuar.',
      );
    }

    const formulario = await prisma.formulario.create({
      data: {
        numero: 3,
        codigo: `${PREFIJO}_PMO`,
        nombre: 'FORMULARIO DE PRUEBA M18',
        colorFondo: '#EEEEEE',
        colorAcento: '#000000',
        colorNombre: 'gris',
        rolDueno: RolDepartamental.DMIP_OPERATIVOS,
        politicaVehiculo: PoliticaVehiculo.REQUERIDO,
        orden: 3,
        // Autorización en t_formulario_rol (2026-08-25): el dueño registra (ESCRITURA).
        roles: {
          create: [
            {
              rol: RolDepartamental.DMIP_OPERATIVOS,
              acceso: AccesoFormulario.ESCRITURA,
            },
          ],
        },
        prefijos: { create: [{ prefijo: 'CAP', esPredeterminado: true }] },
        areas: { create: [{ area: AreaPersonal.GENERAL }] },
      },
    });

    vehiculo = (
      await prisma.vehiculo.create({
        data: { placa: 'M18A001', descripcion: `${PREFIJO} camioneta` },
      })
    ).id;
    conductor = (
      await prisma.conductor.create({
        data: {
          cedula: '7777770301',
          nombreCompleto: `${PREFIJO} CONDUCTOR`,
          licenciaTipo: 'E',
          vehiculoHabitualId: vehiculo,
        },
      })
    ).id;

    const cuadro = await prisma.cuadroDiario.create({
      data: {
        fecha: new Date(`${FECHA}T00:00:00.000Z`),
        ordenTrabajo: `${PREFIJO}-OT-001`,
        nroSemana: 3,
        anioSemana: 2027,
      },
    });

    // Tres operativos que requieren vehículo: la demanda del día será 3. Se crean en la
    // base (2026-10-15): `POST /operativos` ya no lleva el horario del operativo (RN-66) y
    // los puntos son de un formulario; aquí se prueba la capacidad, no el registro.
    const horarios = [
      ['08:00', '12:00'],
      ['13:00', '17:00'],
      ['18:00', '20:00'],
    ];

    for (const [indice, [horaInicio, horaFin]] of horarios.entries()) {
      const creado = await prisma.operativo.create({
        data: {
          cuadroId: cuadro.id,
          formularioId: formulario.id,
          identificador: `CAP-00${indice + 1}`,
          secuencial: indice + 1,
          horaInicio,
          horaFin,
          esNocturno: false,
          cruzaMedianoche: false,
          duracionHoras: 4,
          puntoLibre: 'Punto de prueba',
          tipoLibre: 'Tipo de prueba',
          creadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
          creadoPor: 1,
          modificadoPorRol: RolDepartamental.DMIP_OPERATIVOS,
          modificadoPor: 1,
        },
      });

      if (primerOperativo === 0) primerOperativo = creado.id;
    }
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
    // `t_capacidad_flota` cuelga del cuadro con ON DELETE CASCADE: se va con él.
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
    await prisma.conductor.deleteMany({
      where: { nombreCompleto: { startsWith: PREFIJO } },
    });
    await prisma.vehiculo.deleteMany({
      where: { placa: { startsWith: 'M18' } },
    });
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  const declarar = (usuario: string, cuerpo: Record<string, unknown>) =>
    request(servidor())
      .put(`${API}/transporte/capacidad/${FECHA}`)
      .set(como(usuario))
      .send(cuerpo);

  const consultar = (usuario: string, fecha = FECHA) =>
    request(servidor())
      .get(`${API}/transporte/capacidad/${fecha}`)
      .set(como(usuario));

  describe('consulta sin declaración', () => {
    it('devuelve la demanda y distingue «sin declarar» de «cero hábiles»', async () => {
      const respuesta = await consultar(DAF).expect(200);

      const capacidad = respuesta.body as CapacidadRespuesta;
      expect(capacidad.declarada).toBeNull();
      expect(capacidad.demanda.vehiculos).toBe(3);
      expect(capacidad.vehiculos).toBeNull();
      expect(capacidad.hayAdvertencia).toBe(false);
    });

    it('un día sin jornada abierta responde con demanda cero, no con error', async () => {
      const respuesta = await consultar(DAF, FECHA_SIN_CUADRO).expect(200);

      expect((respuesta.body as CapacidadRespuesta).demanda.vehiculos).toBe(0);
    });
  });

  describe('declaración', () => {
    it('caso 2 · declarar 15 con demanda 3 no produce advertencia', async () => {
      const respuesta = await declarar(DAF, {
        vehiculosHabiles: 15,
        conductoresHabiles: 15,
        observacion: 'Flota completa.',
      }).expect(200);

      const capacidad = respuesta.body as CapacidadRespuesta;
      expect(capacidad.declarada?.vehiculosHabiles).toBe(15);
      expect(capacidad.hayAdvertencia).toBe(false);
      expect(capacidad.vehiculos?.excedente).toBe(12);
    });

    it('caso 3 · una cantidad negativa responde 400', async () => {
      const respuesta = await declarar(DAF, {
        vehiculosHabiles: -1,
        conductoresHabiles: 5,
      }).expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'número negativo',
      );
    });

    it('una cantidad no entera también', async () => {
      await declarar(DAF, {
        vehiculosHabiles: 1.5,
        conductoresHabiles: 5,
      }).expect(400);
    });

    it('la fecha o el declarante en el cuerpo se rechazan', async () => {
      const respuesta = await declarar(DAF, {
        vehiculosHabiles: 5,
        conductoresHabiles: 5,
        declaradoPor: 1,
      }).expect(400);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CAMPOS_NO_PERMITIDOS');
      expect(cuerpo.mensaje).toContain('declaradoPor');
    });

    it('caso 4 · la segunda declaración actualiza, no duplica', async () => {
      await declarar(DAF, {
        vehiculosHabiles: 20,
        conductoresHabiles: 20,
        observacion: 'Corrección de prueba.',
      }).expect(200);

      const filas = await prisma.capacidadFlota.findMany({
        where: { fecha: new Date(`${FECHA}T00:00:00.000Z`) },
      });

      expect(filas).toHaveLength(1);
      expect(filas[0].vehiculosHabiles).toBe(20);
      // La observación anterior se reemplaza por la nueva: la declaración es del día, no acumulativa.
      expect(filas[0].observacion).toBe('Corrección de prueba.');
    });

    it('el cambio queda auditado campo a campo', async () => {
      const capacidad = await prisma.capacidadFlota.findFirstOrThrow({
        where: { fecha: new Date(`${FECHA}T00:00:00.000Z`) },
      });

      const trazas = await prisma.auditoria.findMany({
        where: { entidad: 't_capacidad_flota', entidadId: capacidad.id },
        orderBy: { id: 'asc' },
      });

      expect(trazas[0].accion).toBe('CREAR');
      expect(trazas.some((traza) => traza.accion === 'ACTUALIZAR')).toBe(true);
      expect(
        trazas.some((traza) => traza.campo === 'capa_vehiculos_habiles'),
      ).toBe(true);
    });

    it('no se puede declarar capacidad para un día sin jornada abierta', async () => {
      await request(servidor())
        .put(`${API}/transporte/capacidad/${FECHA_SIN_CUADRO}`)
        .set(como(DAF))
        .send({ vehiculosHabiles: 5, conductoresHabiles: 5 })
        .expect(404);
    });

    it('una fecha mal escrita responde 400', async () => {
      await request(servidor())
        .put(`${API}/transporte/capacidad/20-01-2027`)
        .set(como(DAF))
        .send({ vehiculosHabiles: 5, conductoresHabiles: 5 })
        .expect(400);
    });
  });

  describe('caso 1 · advierte SIN bloquear', () => {
    it('declarada una capacidad insuficiente, aparece la advertencia', async () => {
      const respuesta = await declarar(DAF, {
        vehiculosHabiles: 1,
        conductoresHabiles: 1,
        observacion: 'Corrección de prueba.',
      }).expect(200);

      const capacidad = respuesta.body as CapacidadRespuesta;
      expect(capacidad.hayAdvertencia).toBe(true);
      expect(capacidad.vehiculos?.excedente).toBe(-2);
      expect(capacidad.advertencia).toContain('2 vehículos');
      expect(capacidad.advertencia).toContain('sigue permitida');
    });

    it('**y la asignación de transporte se completa igual**', async () => {
      // Es la mitad del caso 1 que ninguna prueba con dobles puede demostrar: con la
      // capacidad excedida, la DAF asigna y el sistema responde 200.
      const respuesta = await request(servidor())
        .patch(`${API}/transporte/operativos/${primerOperativo}`)
        .set(como(DAF))
        .send({ conductorId: conductor, vehiculoId: vehiculo })
        .expect(200);

      expect(
        (respuesta.body as { estadoTransporte: string }).estadoTransporte,
      ).toBe('ASIGNADO');
    });

    it('la demanda no baja al asignar: sigue siendo la del día', async () => {
      const respuesta = await consultar(DAF).expect(200);

      expect((respuesta.body as CapacidadRespuesta).demanda.vehiculos).toBe(3);
    });

    it('declarar propios medios sí reduce la demanda', async () => {
      const otro = await prisma.operativo.findFirstOrThrow({
        where: {
          identificador: { startsWith: 'CAP-' },
          id: { not: primerOperativo },
        },
      });

      await request(servidor())
        .patch(`${API}/transporte/operativos/${otro.id}/propios-medios`)
        .set(como(DAF))
        .expect(200);

      const respuesta = await consultar(DAF).expect(200);
      expect((respuesta.body as CapacidadRespuesta).demanda.vehiculos).toBe(2);
    });
  });

  describe('permisos', () => {
    it('caso 5 · un rol departamental no consulta la capacidad', async () => {
      const respuesta = await consultar(OPERATIVOS_ROL).expect(403);

      expect((respuesta.body as { codigo: string }).codigo).toBe(
        'PERMISO_INSUFICIENTE',
      );
    });

    it('ni la declara', async () => {
      await declarar(OPERATIVOS_ROL, {
        vehiculosHabiles: 5,
        conductoresHabiles: 5,
      }).expect(403);
    });

    it('la Dirección consulta pero no declara', async () => {
      await consultar(DIRECTOR).expect(200);
      await declarar(DIRECTOR, {
        vehiculosHabiles: 5,
        conductoresHabiles: 5,
      }).expect(403);
    });

    it('el ADMINISTRADOR declara pero no consulta el indicador', async () => {
      await declarar(ADMINISTRADOR, {
        vehiculosHabiles: 9,
        conductoresHabiles: 9,
        observacion: 'Corrección de prueba.',
      }).expect(200);
      await consultar(ADMINISTRADOR).expect(403);
    });

    it('sin identidad responde 401', async () => {
      await request(servidor())
        .get(`${API}/transporte/capacidad/${FECHA}`)
        .expect(401);
    });
  });
});
