/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: ventanas-carga.integracion-spec.ts
 * Responsabilidad: Verificar los endpoints de ventanas contra la base real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * A diferencia de M-07, aquí NO hacen falta datos de prueba: `t_ventana_carga` está
 * sembrada con las seis filas reales desde M-03. Lo que sí hace esta prueba es
 * MODIFICAR una ventana, así que guarda el estado inicial de las seis y lo restituye
 * al terminar. Una prueba que deja el horario de un departamento cambiado es peor que
 * no tener prueba.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RolDepartamental, type VentanaCarga } from '@prisma/client';
import type { Server } from 'node:http';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { correlacionMiddleware } from '../src/common/interceptors/correlacion.middleware';
import { LoggerService } from '../src/common/logger/logger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { como } from './identidad-de-prueba';

const ADMINISTRADOR = '6';
const DIRECTOR = '5';
const OPERATIVOS = '1';
const DAF = '4';

const API = '/api/v1';

interface EstadoRespuesta {
  rol: string;
  abierta: boolean;
  activo: boolean;
  zonaHoraria: string;
  horaCierre: string | null;
  mensaje: string;
}

interface VentanaRespuesta {
  rol: string;
  horaApertura: string | null;
  horaCierre: string | null;
  activo: boolean;
}

describe('Ventanas de carga · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let iniciales: VentanaCarga[] = [];

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
    iniciales = await prisma.ventanaCarga.findMany();

    if (iniciales.length === 0) {
      throw new Error(
        't_ventana_carga está vacía. Ejecute `npx prisma db seed` antes de estas pruebas.',
      );
    }
  });

  afterAll(async () => {
    // Restitución de las seis filas, campo a campo. La auditoría NO se limpia: es
    // evidencia de que el mecanismo funcionó.
    for (const original of iniciales) {
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
  const servidor = (): Server => app.getHttpServer() as Server;

  describe('GET /ventanas/estado', () => {
    it('devuelve el estado del rol que consulta, no el de otro', async () => {
      const departamental = await request(servidor())
        .get(`${API}/ventanas/estado`)
        .set(como(OPERATIVOS))
        .expect(200);
      const transportes = await request(servidor())
        .get(`${API}/ventanas/estado`)
        .set(como(DAF))
        .expect(200);

      expect((departamental.body as EstadoRespuesta).rol).toBe(
        RolDepartamental.DMIP_OPERATIVOS,
      );
      expect((transportes.body as EstadoRespuesta).rol).toBe(
        RolDepartamental.DAF,
      );
    });

    it('se evalúa siempre en America/Guayaquil', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/ventanas/estado`)
        .set(como(OPERATIVOS))
        .expect(200);

      expect((respuesta.body as EstadoRespuesta).zonaHoraria).toBe(
        'America/Guayaquil',
      );
    });

    it('caso 6 · el Director no tiene restricción horaria', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/ventanas/estado`)
        .set(como(DIRECTOR))
        .expect(200);

      const estado = respuesta.body as EstadoRespuesta;
      expect(estado.activo).toBe(false);
      expect(estado.abierta).toBe(true);
    });

    it('sin identidad responde 401', async () => {
      await request(servidor()).get(`${API}/ventanas/estado`).expect(401);
    });
  });

  describe('GET /administracion/ventanas', () => {
    it('devuelve las seis ventanas al ADMINISTRADOR', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/administracion/ventanas`)
        .set(como(ADMINISTRADOR))
        .expect(200);

      const ventanas = respuesta.body as VentanaRespuesta[];
      expect(ventanas).toHaveLength(6);
      expect(ventanas.map((v) => v.rol)).toContain(RolDepartamental.DAF);
    });

    it('un rol que no es ADMINISTRADOR recibe 403', async () => {
      await request(servidor())
        .get(`${API}/administracion/ventanas`)
        .set(como(DIRECTOR))
        .expect(403);
    });

    it('un rol inexistente en la ruta se rechaza con un mensaje que enumera los válidos', async () => {
      const respuesta = await request(servidor())
        .get(`${API}/administracion/ventanas/JEFATURA`)
        .set(como(ADMINISTRADOR))
        .expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'DMIP_OPERATIVOS',
      );
    });
  });

  describe('PUT /administracion/ventanas/:rol', () => {
    it('caso 5 · cambiar la hora de cierre cambia el estado sin desplegar código', async () => {
      // A esta hora la ventana departamental sembrada (cierre 15H00) puede estar
      // abierta o cerrada segun cuando se ejecute la prueba. Se fuerza un cierre que
      // ya pasó y se comprueba que el estado pasa a cerrado.
      await request(servidor())
        .put(`${API}/administracion/ventanas/DMIP_OPERATIVOS`)
        .set(como(ADMINISTRADOR))
        .send({ horaApertura: '00:00', horaCierre: '00:01' })
        .expect(200);

      const estado = await request(servidor())
        .get(`${API}/ventanas/estado`)
        .set(como(OPERATIVOS))
        .expect(200);

      expect((estado.body as EstadoRespuesta).abierta).toBe(false);

      // Y al revés: una ventana que cubre el día entero deja escribir siempre.
      await request(servidor())
        .put(`${API}/administracion/ventanas/DMIP_OPERATIVOS`)
        .set(como(ADMINISTRADOR))
        .send({ horaApertura: '00:00', horaCierre: '23:59' })
        .expect(200);

      const abierta = await request(servidor())
        .get(`${API}/ventanas/estado`)
        .set(como(OPERATIVOS))
        .expect(200);

      expect((abierta.body as EstadoRespuesta).abierta).toBe(true);
    });

    it('rechaza una hora mal escrita con un mensaje operativo', async () => {
      const respuesta = await request(servidor())
        .put(`${API}/administracion/ventanas/DMIP_INSPECCIONES`)
        .set(como(ADMINISTRADOR))
        .send({ horaCierre: '15h00' })
        .expect(400);

      expect((respuesta.body as { mensaje: string }).mensaje).toContain(
        'HH:MM',
      );
    });

    it('rechaza un campo fuera de contrato nombrándolo', async () => {
      const respuesta = await request(servidor())
        .put(`${API}/administracion/ventanas/DMIP_INSPECCIONES`)
        .set(como(ADMINISTRADOR))
        .send({ horaCierre: '15:00', zonaHoraria: 'Europe/Madrid' })
        .expect(400);

      const cuerpo = respuesta.body as { codigo: string; mensaje: string };
      expect(cuerpo.codigo).toBe('CAMPOS_NO_PERMITIDOS');
      expect(cuerpo.mensaje).toContain('zonaHoraria');
    });

    it('devuelve las advertencias sin impedir el cambio', async () => {
      const respuesta = await request(servidor())
        .put(`${API}/administracion/ventanas/DAF`)
        .set(como(ADMINISTRADOR))
        .send({ horaApertura: '14:00' })
        .expect(200);

      const cuerpo = respuesta.body as {
        ventana: VentanaRespuesta;
        advertencias: string[];
      };
      expect(cuerpo.ventana.horaApertura).toBe('14:00');
      expect(cuerpo.advertencias.join(' ')).toContain('RN-56');
    });

    it('un rol departamental no puede administrar ventanas', async () => {
      await request(servidor())
        .put(`${API}/administracion/ventanas/DMIP_OPERATIVOS`)
        .set(como(OPERATIVOS))
        .send({ horaCierre: '23:00' })
        .expect(403);
    });

    it('el cambio queda auditado con el usuario, el rol y la columna', async () => {
      const trazas = await prisma.auditoria.findMany({
        where: { entidad: 't_ventana_carga' },
        orderBy: { id: 'desc' },
        take: 1,
      });

      expect(trazas).toHaveLength(1);
      expect(trazas[0].usuario).toBe(6);
      expect(trazas[0].rol).toBe(RolDepartamental.ADMINISTRADOR_DMIP);
      expect(trazas[0].campo).toMatch(/^vcar_/);
      expect(trazas[0].correlacion).not.toBeNull();
    });
  });
});
