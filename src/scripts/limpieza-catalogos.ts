/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: limpieza-catalogos.ts
 * Responsabilidad: Punto de entrada de la limpieza de catálogos del cuadro (reporte o aplicación).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-13
 *
 * Se compila con el resto de `src/` y corre en el contenedor sin `ts-node`:
 *
 *   node dist/scripts/limpieza-catalogos.js                                  → solo reporta
 *   node dist/scripts/limpieza-catalogos.js --aplicar --usuario=<id>         → tipos e instituciones
 *   node dist/scripts/limpieza-catalogos.js --aplicar --incluir-zonales --usuario=<id>
 *
 * La lógica vive en `limpieza-catalogos.logica.ts`. Aquí solo se abre y cierra la conexión.
 */

import { PrismaClient } from '@prisma/client';

import { ejecutarLimpieza, leerOpciones } from './limpieza-catalogos.logica';

async function principal(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await ejecutarLimpieza(
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
    `La limpieza no se aplicó: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
