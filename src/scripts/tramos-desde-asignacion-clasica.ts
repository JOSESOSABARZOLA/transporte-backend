/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · ocupación por tramos
 * Archivo: tramos-desde-asignacion-clasica.ts
 * Responsabilidad: Punto de entrada del paso a tramos de las asignaciones clásicas (reporte o aplicación).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-14
 *
 * Se compila con el resto de `src/` y corre en el contenedor sin `ts-node`:
 *
 *   node dist/scripts/tramos-desde-asignacion-clasica.js                          → solo reporta
 *   node dist/scripts/tramos-desde-asignacion-clasica.js --aplicar --usuario=<id> → escribe
 *
 * La lógica vive en `tramos-desde-asignacion-clasica.logica.ts`. Aquí solo se abre y cierra la
 * conexión.
 */

import { PrismaClient } from '@prisma/client';

import {
  ejecutarTramosClasicos,
  leerOpciones,
} from './tramos-desde-asignacion-clasica.logica';

async function principal(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await ejecutarTramosClasicos(
      prisma,
      leerOpciones(process.argv.slice(2)),
      (texto) => process.stdout.write(`${texto}\n`),
    );
  } finally {
    await prisma.$disconnect();
  }
}

principal().catch((error: unknown) => {
  process.stderr.write(
    `El paso a tramos no se aplicó: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
