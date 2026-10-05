/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: elegibilidad.integracion-spec.ts
 * Responsabilidad: Verificar las políticas contra la base y los parámetros reales.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EXIGE LA BASE LEVANTADA. Se ejecuta con `npm run test:integracion`.
 *
 * Lo que aquí se comprueba y las pruebas unitarias no pueden: que los umbrales salgan
 * de `t_parametro_politica`, que los antecedentes se lean de verdad de las cuatro
 * tablas, y el **caso 10 del plan** —cambiar el parámetro por la API y ver que el
 * veredicto cambia sin reiniciar nada—.
 *
 * Todo lo que crea lleva el prefijo `PRUEBA_M12` y se borra al terminar. El parámetro
 * `JORNADA_MAXIMA_HORAS` se restituye a su valor sembrado.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AreaPersonal,
  PoliticaVehiculo,
  RolDepartamental,
  TipoContrato,
} from '@prisma/client';
import type { Server } from 'node:http';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { correlacionMiddleware } from '../src/common/interceptors/correlacion.middleware';
import { LoggerService } from '../src/common/logger/logger.service';
import { ParametroPoliticaService } from '../src/modules/configuracion/application/parametro-politica.service';
import { ElegibilidadService } from '../src/modules/talento-operativo/application/elegibilidad.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { como } from './identidad-de-prueba';

const PREFIJO = 'PRUEBA_M12';
const API = '/api/v1';
const ADMINISTRADOR = '6';
const INSPECCIONES = '2';

const CEDULAS = ['1710034065', '0926687856', '1104537897'];
const dia = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);

/** 2026-08-05 es miércoles; 2026-08-08, sábado. */
const MIERCOLES = dia('2026-08-05');
const SABADO = dia('2026-08-08');

interface ElegibleRespuesta {
  id: number;
  apellidos: string;
  /** Desde PV-37 la lista llega completa y cada persona trae su veredicto. */
  elegible: boolean;
  motivo: string | null;
}

describe('Políticas de descanso · integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let elegibilidad: ElegibilidadService;
  let parametros: ParametroPoliticaService;

  let formularioId = 0;
  let formularioPatrullaId = 0;
  let ocasional = 0;
  let nombramiento = 0;
  let conPatrullaAyer = 0;

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
    elegibilidad = app.get(ElegibilidadService);
    parametros = app.get(ParametroPoliticaService);

    await limpiar();

    const normal = await prisma.formulario.create({
      data: formulario(8, `${PREFIJO}_NORMAL`, false),
    });
    const patrulla = await prisma.formulario.create({
      data: formulario(9, `${PREFIJO}_PATRULLA`, true),
    });
    formularioId = normal.id;
    formularioPatrullaId = patrulla.id;

    ocasional = (
      await prisma.funcionario.create({
        data: persona(CEDULAS[0], `${PREFIJO}_OCASIONAL`, TipoContrato.OCASIONAL),
      })
    ).id;
    nombramiento = (
      await prisma.funcionario.create({
        data: persona(
          CEDULAS[1],
          `${PREFIJO}_NOMBRAMIENTO`,
          TipoContrato.NOMBRAMIENTO,
        ),
      })
    ).id;
    conPatrullaAyer = (
      await prisma.funcionario.create({
        data: persona(CEDULAS[2], `${PREFIJO}_PATRULLERO`, TipoContrato.OCASIONAL),
      })
    ).id;

    // Historial: salió en patrulla el martes 4.
    await prisma.historialJornada.create({
      data: {
        funcionarioId: conPatrullaAyer,
        fecha: dia('2026-08-04'),
        fuePatrulla: true,
        horasJornada: 8,
        operativos: 1,
      },
    });
  });

  afterAll(async () => {
    await limpiar();
    // El parámetro vuelve a su valor sembrado, pase lo que pase en las pruebas.
    await prisma.parametroPolitica.update({
      where: { clave: 'JORNADA_MAXIMA_HORAS' },
      data: { valor: '12' },
    });
    parametros.invalidarCache();
    await app.close();
  });

  const limpiar = async (): Promise<void> => {
    await prisma.cuadroDiario.deleteMany({
      where: { ordenTrabajo: { startsWith: PREFIJO } },
    });
    await prisma.funcionario.deleteMany({
      where: { apellidos: { startsWith: PREFIJO } },
    });
    await prisma.formulario.deleteMany({
      where: { codigo: { startsWith: PREFIJO } },
    });
  };

  const formulario = (numero: number, codigo: string, esPatrulla: boolean) => ({
    numero,
    codigo,
    nombre: `FORMULARIO ${numero}`,
    colorFondo: '#EEEEEE',
    colorAcento: '#000000',
    colorNombre: 'gris',
    rolDueno: RolDepartamental.DMIP_INSPECCIONES,
    politicaVehiculo: PoliticaVehiculo.CONDICIONAL,
    condicionanteNoct: false,
    esPatrulla,
    orden: numero,
    areas: { create: [{ area: AreaPersonal.GENERAL }] },
  });

  const persona = (
    cedula: string,
    apellidos: string,
    tipoContrato: TipoContrato,
  ) => ({
    cedula,
    apellidos,
    nombres: 'PERSONA',
    area: AreaPersonal.GENERAL,
    tipoContrato,
    direccion: RolDepartamental.DMIP_INSPECCIONES,
  });

  const diurno = {
    fecha: MIERCOLES,
    horaInicio: '08:00',
    horaFin: '16:00',
    esPatrulla: false,
  };

  const servidor = (): Server => app.getHttpServer() as Server;

  describe('las seis reglas contra datos reales', () => {
    it('sin antecedentes, la persona es elegible', async () => {
      const veredicto = await elegibilidad.verificar(ocasional, diurno);
      expect(veredicto.elegible).toBe(true);
    });

    it('1 · quien está de vacaciones no es elegible, con la fecha de retorno', async () => {
      await prisma.disponibilidad.create({
        data: {
          funcionarioId: ocasional,
          estado: 'VACACIONES',
          desde: dia('2026-08-01'),
          hasta: dia('2026-08-15'),
          motivo: 'Cirugía programada',
          registradoPor: 6,
        },
      });

      const veredicto = await elegibilidad.verificar(ocasional, diurno);

      expect(veredicto.codigo).toBe('PERSONA_NO_DISPONIBLE');
      expect(veredicto.motivo).toContain('2026-08-15');
      // El texto libre del motivo NO sale del submódulo.
      expect(veredicto.motivo).not.toContain('Cirugía');

      await prisma.disponibilidad.deleteMany({
        where: { funcionarioId: ocasional },
      });
    });

    it('2 · el nombramiento no puede en turno nocturno', async () => {
      const veredicto = await elegibilidad.verificar(nombramiento, {
        ...diurno,
        horaInicio: '21:00',
        horaFin: '23:00',
      });

      expect(veredicto.codigo).toBe('CONTRATO_NO_ADMITE_TURNO');
    });

    it('3 · el nombramiento no puede en sábado', async () => {
      const veredicto = await elegibilidad.verificar(nombramiento, {
        ...diurno,
        fecha: SABADO,
      });

      expect(veredicto.codigo).toBe('CONTRATO_NO_ADMITE_TURNO');
    });

    it('4 · el ocasional sí puede en turno nocturno', async () => {
      const veredicto = await elegibilidad.verificar(ocasional, {
        ...diurno,
        horaInicio: '21:00',
        horaFin: '23:00',
      });

      expect(veredicto.elegible).toBe(true);
    });

    it('5 · quien salió ayer en patrulla no repite, con su nombre', async () => {
      const veredicto = await elegibilidad.verificar(conPatrullaAyer, {
        ...diurno,
        esPatrulla: true,
      });

      expect(veredicto.codigo).toBe('PATRULLA_CONSECUTIVA');
      expect(veredicto.motivo).toContain(`${PREFIJO}_PATRULLERO`);
    });

    it('6 · la regla no distingue patrulla diurna de nocturna', async () => {
      const veredicto = await elegibilidad.verificar(conPatrullaAyer, {
        ...diurno,
        horaInicio: '21:00',
        horaFin: '23:00',
        esPatrulla: true,
      });

      expect(veredicto.codigo).toBe('PATRULLA_CONSECUTIVA');
    });

    it('el mismo patrullero SÍ puede en un operativo que no es patrulla', async () => {
      const veredicto = await elegibilidad.verificar(conPatrullaAyer, diurno);
      expect(veredicto.elegible).toBe(true);
    });

    it('7 · quien alcanzó el tope no puede en turno nocturno', async () => {
      for (const fecha of ['2026-08-01', '2026-08-02', '2026-08-03']) {
        await prisma.historialJornada.create({
          data: {
            funcionarioId: ocasional,
            fecha: dia(fecha),
            fueNocturna: true,
            horasJornada: 6,
            operativos: 1,
          },
        });
      }

      const veredicto = await elegibilidad.verificar(ocasional, {
        ...diurno,
        horaInicio: '21:00',
        horaFin: '23:00',
      });

      expect(veredicto.codigo).toBe('TOPE_SALIDAS_PESADAS');

      await prisma.historialJornada.deleteMany({
        where: { funcionarioId: ocasional },
      });
    });
  });

  describe('reglas que dependen del día en construcción', () => {
    beforeAll(async () => {
      // Un operativo de 22H00 a 02H00 con el ocasional asignado.
      const cuadro = await prisma.cuadroDiario.create({
        data: {
          fecha: MIERCOLES,
          ordenTrabajo: `${PREFIJO}-2026-08-05`,
          nroSemana: 32,
          anioSemana: 2026,
        },
      });

      await prisma.operativo.create({
        data: {
          cuadroId: cuadro.id,
          formularioId,
          identificador: `${PREFIJO}-001`,
          secuencial: 1,
          horaInicio: '22:00',
          horaFin: '02:00',
          esNocturno: true,
          cruzaMedianoche: true,
          duracionHoras: 4,
          puntoLibre: 'Punto de prueba',
          tipoLibre: 'Tipo de prueba',
          creadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
          creadoPor: 2,
          modificadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
          modificadoPor: 2,
          personal: {
            create: [
              {
                funcionarioId: ocasional,
                asignadoPorRol: RolDepartamental.DMIP_INSPECCIONES,
              },
            ],
          },
        },
      });
    });

    it('8 · el solapamiento con cruce de medianoche se detecta, con el operativo', async () => {
      const veredicto = await elegibilidad.verificar(ocasional, {
        ...diurno,
        horaInicio: '01:00',
        horaFin: '05:00',
      });

      expect(veredicto.codigo).toBe('SOLAPAMIENTO_HORARIO');
      expect(veredicto.motivo).toContain(`${PREFIJO}-001`);
    });

    it('un horario que no se cruza sí es elegible', async () => {
      const veredicto = await elegibilidad.verificar(ocasional, {
        ...diurno,
        horaInicio: '08:00',
        horaFin: '12:00',
      });

      expect(veredicto.elegible).toBe(true);
    });

    it('al editar, el operativo no se solapa consigo mismo', async () => {
      const propio = await prisma.operativo.findFirst({
        where: { identificador: `${PREFIJO}-001` },
      });

      const veredicto = await elegibilidad.verificar(ocasional, {
        ...diurno,
        horaInicio: '22:00',
        horaFin: '02:00',
        operativoId: propio?.id,
      });

      expect(veredicto.elegible).toBe(true);
    });

    /**
     * La regresión que estuvo suelta hasta el 2026-08-07.
     *
     * La baja del operativo es lógica y `t_asignacion_personal` no se borra ni tiene
     * estado propio, así que sin `activo: true` en la consulta un operativo retirado
     * seguía ocupando a su personal. La persona quedaba **atrapada**: la retenía un
     * operativo que ya no aparecía en ninguna pantalla.
     *
     * Se afirman las dos reglas que leen la misma consulta —solapamiento y jornada
     * máxima—, y se restituye el operativo para no alterar lo que sigue.
     */
    it('un operativo RETIRADO deja de ocupar a su personal', async () => {
      const retirado = await prisma.operativo.findFirstOrThrow({
        where: { identificador: `${PREFIJO}-001` },
      });
      await prisma.operativo.update({
        where: { id: retirado.id },
        data: { activo: false },
      });

      try {
        const solapado = await elegibilidad.verificar(ocasional, {
          ...diurno,
          horaInicio: '01:00',
          horaFin: '05:00',
        });
        expect(solapado.elegible).toBe(true);

        // Sus cuatro horas tampoco suman ya a la jornada del día.
        const jornada = await elegibilidad.verificar(ocasional, {
          ...diurno,
          horaInicio: '08:00',
          horaFin: '17:30',
        });
        expect(jornada.elegible).toBe(true);
      } finally {
        await prisma.operativo.update({
          where: { id: retirado.id },
          data: { activo: true },
        });
      }
    });

    it('9 · la suma que supera la jornada se rechaza', async () => {
      const veredicto = await elegibilidad.verificar(ocasional, {
        ...diurno,
        horaInicio: '08:00',
        horaFin: '17:30',
      });

      expect(veredicto.codigo).toBe('JORNADA_MAXIMA_SUPERADA');
    });

    it('caso 10 del plan · cambiar el parámetro por la API cambia el veredicto SIN REINICIAR', async () => {
      const contexto = {
        ...diurno,
        horaInicio: '08:00',
        horaFin: '15:00',
      };

      // Cuatro horas del operativo nocturno más siete son once: cabe en doce.
      expect((await elegibilidad.verificar(ocasional, contexto)).elegible).toBe(
        true,
      );

      await request(servidor())
        .put(`${API}/parametros/JORNADA_MAXIMA_HORAS`)
        .set(como(ADMINISTRADOR))
        .send({ valor: '8' })
        .expect(200);

      const despues = await elegibilidad.verificar(ocasional, contexto);
      expect(despues.codigo).toBe('JORNADA_MAXIMA_SUPERADA');
      expect(despues.motivo).toContain('8 horas');

      await request(servidor())
        .put(`${API}/parametros/JORNADA_MAXIMA_HORAS`)
        .set(como(ADMINISTRADOR))
        .send({ valor: '12' })
        .expect(200);

      expect((await elegibilidad.verificar(ocasional, contexto)).elegible).toBe(
        true,
      );
    });
  });

  describe('la consulta de elegibles aplica las políticas', () => {
    it('sin horario solo filtra por área y ausencia', async () => {
      const respuesta = await request(servidor())
        .get(
          `${API}/personal/elegible?formulario=${PREFIJO}_PATRULLA&inicio=2026-08-05`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      const nuestros = (respuesta.body as ElegibleRespuesta[]).filter((p) =>
        p.apellidos.startsWith(PREFIJO),
      );
      expect(nuestros.map((p) => p.id)).toContain(conPatrullaAyer);
    });

    /**
     * PV-37, resuelto el 11-AGO. **Antes esta prueba exigía que desapareciera.**
     *
     * Ahora aparece rechazado y con su motivo, y la diferencia no es cosmética: quien
     * arma el cuadro necesita saber que esa persona existe y por qué no puede salir. Si
     * desaparece, el motivo solo se veía al intentar asignarla —cosa imposible, porque
     * no estaba en la lista—.
     *
     * UNA REGLA DE DESCANSO SÍ EXPLICA SU RECHAZO ENTERO, al contrario que una ausencia:
     * es un hecho operativo del cuadro, no un dato personal.
     */
    it('con horario, quien salió ayer en patrulla aparece rechazado y con su motivo', async () => {
      const respuesta = await request(servidor())
        .get(
          `${API}/personal/elegible?formulario=${PREFIJO}_PATRULLA&inicio=2026-08-05&horaInicio=08:00&horaFin=16:00`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      const nuestros = (respuesta.body as ElegibleRespuesta[]).filter((p) =>
        p.apellidos.startsWith(PREFIJO),
      );

      const rechazado = nuestros.find((p) => p.id === conPatrullaAyer);
      expect(rechazado).toBeDefined();
      expect(rechazado?.elegible).toBe(false);
      expect(rechazado?.motivo).toContain('patrulla');
    });

    it('exige las dos horas o ninguna', async () => {
      await request(servidor())
        .get(
          `${API}/personal/elegible?formulario=${PREFIJO}_PATRULLA&inicio=2026-08-05&horaInicio=08:00`,
        )
        .set(como(INSPECCIONES))
        .expect(400);
    });

    it('la lista sigue sin llevar cédula ni teléfono', async () => {
      const respuesta = await request(servidor())
        .get(
          `${API}/personal/elegible?formulario=${PREFIJO}_PATRULLA&inicio=2026-08-05&horaInicio=08:00&horaFin=16:00`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      const cuerpo = JSON.stringify(respuesta.body);
      expect(cuerpo).not.toContain('cedula');
      expect(cuerpo).not.toContain('telefono');
    });
  });

  describe('caso 13 · la lógica de descanso no vive fuera del submódulo', () => {
    /**
     * VIAJA EL VEREDICTO, NO LOS DATOS CON LOS QUE SE TOMÓ. Es la frontera que sostiene
     * que las reglas de descanso vivan solo en `talento-operativo`: quien pregunta
     * recibe «puede o no puede, y por qué», nunca el tipo de contrato ni el historial
     * con el que se decidió.
     *
     * `elegible` y `motivo` FORMAN PARTE DEL CONTRATO desde PV-37, así que ya no se
     * prohíben —esta prueba los exigía ausentes y por eso fallaba—. Lo que sigue
     * prohibido es lo de debajo:
     *
     *   · `tipoContrato` · dato laboral de la persona, y el insumo de RN-26.
     *   · `codigo` · el identificador de la regla, escrito para el desarrollador. El
     *     funcionario lee el motivo redactado, no `PATRULLA_CONSECUTIVA`.
     *   · cédula y teléfono · datos personales que ninguna pantalla del cuadro necesita.
     *
     * Se consulta el formulario de patrulla y no el normal, a propósito: ahí hay un
     * rechazo real, así que el veredicto viaja lleno y la comprobación tiene sustancia.
     */
    it('el veredicto viaja, pero no los datos del funcionario con los que se tomó', async () => {
      const respuesta = await request(servidor())
        .get(
          `${API}/personal/elegible?formulario=${PREFIJO}_PATRULLA&inicio=2026-08-05&horaInicio=08:00&horaFin=16:00`,
        )
        .set(como(INSPECCIONES))
        .expect(200);

      const nuestros = (respuesta.body as ElegibleRespuesta[]).filter((p) =>
        p.apellidos.startsWith(PREFIJO),
      );
      expect(nuestros.some((p) => !p.elegible)).toBe(true);

      const cuerpo = JSON.stringify(respuesta.body);
      for (const campo of [
        'tipoContrato',
        'codigo',
        'PATRULLA_CONSECUTIVA',
        'cedula',
        'telefono',
      ]) {
        expect(cuerpo).not.toContain(campo);
      }
    });
  });
});
