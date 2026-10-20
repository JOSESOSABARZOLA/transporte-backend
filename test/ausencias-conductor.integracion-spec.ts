/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ausencias de conductores
 * Archivo: ausencias-conductor.integracion-spec.ts
 * Responsabilidad: Verificar de punta a punta el registro de ausencias de conductor.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-16
 *
 * Lo que protege: que el endpoint exija `flota:ausencias` (403 sin él), que la ausencia
 * registrada desde Flota EXCLUYA al conductor de lo que la DAF puede asignar ese día
 * (`GET /transporte/conductores`), y que INV-14 se cumpla con 409.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
const DAF = '4';
const ADMIN_DAF = '9';
const API = '/api/v1';
const PREFIJO = 'PRUEBA_AUSC';
/** Un día lejano: no choca con datos reales ni con «hoy». */
const DIA = '2031-03-10';

interface AusenciaRespuesta {
  id: number;
  conductorId: number;
  estado: string;
  desde: string;
  hasta: string;
  momento: string;
  tramosAfectados?: unknown[];
}

describe('Ausencias de conductores · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let conductorId = 0;
  let ausenciaId = 0;

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

    const conductor = await prisma.conductor.create({
      data: {
        cedula: '7777777001',
        nombreCompleto: `${PREFIJO} CONDUCTOR`,
        licenciaTipo: 'E',
      },
    });
    conductorId = conductor.id;
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  /** Las ausencias caen en cascada con el conductor (`fk_disponibilidad_conductor`). */
  const limpiar = async (): Promise<void> => {
    await prisma.conductor.deleteMany({
      where: { nombreCompleto: { startsWith: PREFIJO } },
    });
  };

  const servidor = (): Server => app.getHttpServer() as Server;
  const ruta = () =>
    `${API}/administracion/conductores/${conductorId}/ausencias`;

  it('403 sin el permiso flota:ausencias', async () => {
    await request(servidor()).get(ruta()).set(como(OPERATIVOS)).expect(403);
  });

  it('registra la ausencia y devuelve los tramos afectados', async () => {
    const respuesta = await request(servidor())
      .post(ruta())
      .set(como(ADMIN_DAF))
      .send({ estado: 'VACACIONES', desde: DIA, hasta: DIA, motivo: 'Viaje' })
      .expect(201);

    const creada = respuesta.body as AusenciaRespuesta;
    ausenciaId = creada.id;
    expect(creada).toMatchObject({
      conductorId,
      estado: 'VACACIONES',
      desde: DIA,
      hasta: DIA,
      momento: 'PROXIMA',
      tramosAfectados: [],
    });
  });

  it('INV-14 · una segunda que se cruza da 409 AUSENCIA_SOLAPADA', async () => {
    const respuesta = await request(servidor())
      .post(ruta())
      .set(como(ADMIN_DAF))
      .send({ estado: 'PERMISO', desde: DIA, hasta: DIA })
      .expect(409);

    expect((respuesta.body as { codigo: string }).codigo).toBe(
      'AUSENCIA_SOLAPADA',
    );
  });

  it('DISPONIBLE no es una ausencia de conductor (400)', async () => {
    await request(servidor())
      .post(ruta())
      .set(como(ADMIN_DAF))
      .send({ estado: 'DISPONIBLE', desde: DIA, hasta: DIA })
      .expect(400);
  });

  it('aparece en la lista de la flota, sin motivo', async () => {
    const respuesta = await request(servidor())
      .get(`${API}/administracion/conductores/ausencias?desde=${DIA}`)
      .set(como(ADMIN_DAF))
      .expect(200);

    const filas = respuesta.body as Record<string, unknown>[];
    const suya = filas.find((fila) => fila.conductorId === conductorId);
    expect(suya).toBeDefined();
    expect(suya).not.toHaveProperty('motivo');
  });

  it('la DAF ya no lo ve entre los conductores de ese día', async () => {
    const respuesta = await request(servidor())
      .get(`${API}/transporte/conductores?fecha=${DIA}`)
      .set(como(DAF))
      .expect(200);

    const ids = (respuesta.body as { id: number }[]).map((c) => c.id);
    expect(ids).not.toContain(conductorId);
  });

  it('se retira, y el conductor vuelve a ofrecerse', async () => {
    await request(servidor())
      .delete(`${ruta()}/${ausenciaId}`)
      .set(como(ADMIN_DAF))
      .expect(200);

    const respuesta = await request(servidor())
      .get(`${API}/transporte/conductores?fecha=${DIA}`)
      .set(como(DAF))
      .expect(200);

    const ids = (respuesta.body as { id: number }[]).map((c) => c.id);
    expect(ids).toContain(conductorId);
  });
});
