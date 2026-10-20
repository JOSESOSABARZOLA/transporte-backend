/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Arranque
 * Archivo: main.ts
 * Responsabilidad: Arrancar la aplicación con su prefijo, CORS, validación y filtro de excepciones.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-04
 */

import 'dotenv/config';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { appConfig } from './config/app.config';
import { validarEntorno } from './config/validar-entorno';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { correlacionMiddleware } from './common/interceptors/correlacion.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { LoggerService } from './common/logger/logger.service';

async function bootstrap() {
  const logger = new Logger('Arranque');

  // ANTES DE CREAR LA APP: si falta la conexión a la base o la clave de sesión es vacía o
  // débil, arrancar es peor que caerse —el módulo firmaría sesiones con una clave inválida
  // y solo se notaría cuando alguien las falsifique—. Las variables de integración con Auth
  // central se avisan, no detienen, porque su etapa 1 sigue abierta. Ver validar-entorno.ts.
  const { errores, advertencias } = validarEntorno(appConfig);
  for (const advertencia of advertencias) {
    logger.warn(advertencia);
  }
  if (errores.length > 0) {
    for (const error of errores) {
      logger.error(error);
    }
    throw new Error(
      `Configuración de entorno inválida: ${errores.length} problema(s) crítico(s). El arranque se detiene.`,
    );
  }

  // bufferLogs retiene los mensajes de arranque anteriores a useLogger y los vuelca
  // por el registrador definitivo. Sin esto, las primeras líneas salen sin formato.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Detrás del Gateway y del nginx del frontend (TRUST_PROXY, 2026-10-16): `req.ip` pasa a ser
  // la IP del usuario y no la del último proxy, así el límite de peticiones cuenta a cada uno.
  // Sin la variable no se toca nada. Ver `saltosProxy` en app.config.ts.
  if (appConfig.saltosProxy !== null) {
    app.set('trust proxy', appConfig.saltosProxy);
  }

  // PRIMERO de todo: el identificador de correlación debe estar disponible para
  // cualquier petición, incluidas las que no emparejan con ninguna ruta.
  app.use(correlacionMiddleware);

  // La sesión con Auth central viaja en una cookie HttpOnly, así que hay que
  // interpretarla antes de que IdentidadGuard la lea. NO se firma la cookie: el
  // contenido ya es un JWT firmado, y una segunda firma no añadiría nada.
  // Ver docs/PLAN_INTEGRACION_AUTH.md §6.1.
  app.use(cookieParser());

  // Cabeceras de seguridad en TODA respuesta: nosniff, anti-clickjacking y, en producción,
  // HSTS. La API entrega JSON al mismo origen que el frontend, así que una CSP restrictiva
  // no rompe nada; `crossOriginResourcePolicy` se afloja a 'cross-origin' porque el
  // navegador descarga la matriz y las órdenes desde el frontend, otro origen. HSTS solo en
  // producción: emitirlo sobre el HTTP de desarrollo obligaría al navegador a HTTPS local.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: appConfig.produccion,
    }),
  );

  // Todas las rutas cuelgan de /api/v1. Ver docs/FASE4-arquitectura-tecnica.md §8.1.
  app.setGlobalPrefix(appConfig.server.prefijoApi);

  // Lista blanca de orígenes configurable por CORS_ORIGINS (separados por coma). Cuando el
  // cliente envía credenciales el navegador rechaza '*', por eso se usa el origen exacto con
  // credentials:true.
  //
  // ═══════════════════════════════════════════════════════════════════════════════
  // SIN CORS_ORIGINS YA NO SE REFLEJA CUALQUIER ORIGEN. Corregido (H-04).
  //
  // El respaldo era `origin: true`, que devuelve el origen de QUIEN pregunta con
  // `credentials: true`: cualquier sitio podía leer respuestas autenticadas del usuario que
  // tuviera la sesión abierta. En producción es obligatorio declarar CORS_ORIGINS —
  // `validar-entorno.ts` detiene el arranque si falta—; en desarrollo el respaldo es una
  // lista local explícita, nunca «cualquiera».
  // ═══════════════════════════════════════════════════════════════════════════════
  const origenes = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean);
  const listaBlanca =
    origenes.length > 0
      ? origenes
      : ['http://localhost:5180', 'http://localhost:5173'];
  app.enableCors({
    origin: listaBlanca,
    credentials: true,
    /**
     * `exposedHeaders` ES LO QUE FALTABA, y su ausencia rompía la traza de soporte.
     *
     * El middleware de correlación devuelve `x-correlation-id` en cada respuesta, y
     * `httpClient` del frontend lo lee para adjuntarlo al error que muestra al
     * funcionario. Cruzando origen, **el navegador oculta toda cabecera de respuesta que
     * no esté en esta lista**: la lectura devolvía `undefined` siempre, así que el
     * identificador que enlaza el clic del usuario con la consulta a la base no llegaba
     * nunca a quien iba a pedir soporte. Ver docs/FASE4-arquitectura-tecnica.md §12.3 y
     * la exigencia de `INTEGRACION_AUTH_CENTRALIZADO_BACKENDS.md`.
     */
    exposedHeaders: ['x-correlation-id', 'x-request-id'],
    /**
     * `allowedHeaders` explícito aunque hoy funcione sin él.
     *
     * El paquete de CORS refleja por omisión las cabeceras que pide el preflight, así que
     * la petición pasa. Pero eso depende de que el preflight llegue íntegro: un proxy
     * inverso que recorte `Access-Control-Request-Headers` dejaría de reflejarlas y las
     * peticiones con correlación empezarían a fallar sin motivo visible. Declararlas
     * cuesta una línea y quita esa dependencia.
     */
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'X-Correlation-Id',
      'X-Request-Id',
    ],
  });

  // whitelist + forbidNonWhitelisted son la garantía de que la DAF no pueda escribir campos
  // fuera de contrato. Ver docs/IMPLEMENTATION_GUIDE.md §16.2.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  /*
   * RETIRADO EL 2026-08-17 · el servidor de archivos estáticos de `/uploads`.
   *
   * Era un residuo del sistema de Instrucción y, mientras existió, fue un agujero real:
   *
   *   1. **No pasaba por ninguna guarda.** Se montaba con `app.use`, así que además
   *      quedaba FUERA del prefijo `/api/v1` y de toda la cadena de autorización.
   *      Cualquiera con la URL descargaba cualquier archivo del directorio.
   *   2. **Nadie escribía en él.** Comprobado en todo `src/`: la matriz y las órdenes se
   *      entregan con `StreamableFile`, en la respuesta, sin tocar el disco. El
   *      directorio estaba vacío.
   *   3. El frontend nunca lo consultó.
   *
   * En un sistema que existe porque el cuadro se filtraba por WhatsApp, un directorio
   * público de documentos sin autenticar no es una deuda menor aunque esté vacío.
   *
   * El volumen `./uploads:/app/uploads` sigue declarado en `docker-compose.yml` con el
   * comentario «persistencia de documentos emitidos». No se retira aquí porque decidir
   * si los documentos deben persistirse es del dueño del producto, no del arranque.
   */

  // Toda la aplicación emite el mismo formato estructurado, incluidos los mensajes
  // internos de NestJS: un registro donde la mitad de las líneas son JSON y la otra
  // mitad texto con color no es explotable.
  const registro = app.get(LoggerService);
  app.useLogger(registro);
  app.useGlobalInterceptors(new LoggingInterceptor(registro));
  app.useGlobalFilters(new AllExceptionsFilter(registro));

  // Sin esto, OnModuleDestroy nunca se ejecuta ante SIGTERM o SIGINT y la conexión de
  // Prisma queda abierta al detener el contenedor. Ver docs/IMPLEMENTATION_GUIDE.md §13.2.
  app.enableShutdownHooks();

  // El aviso por AUTH_SUBSYSTEM_ID y demás variables de integración se emite arriba, en
  // validarEntorno, antes de crear la app: un solo sitio decide qué falta y con qué raso.

  await app.listen(appConfig.server.port);
  logger.log(
    `Cuadro de Colores escuchando en http://localhost:${appConfig.server.port}/${appConfig.server.prefijoApi} · zona horaria ${appConfig.zonaHoraria}`,
  );
}

void bootstrap();
