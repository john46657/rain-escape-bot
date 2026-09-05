#!/usr/bin/env node
/**
 * Offline-Pruefung des Prisma-Schemas.
 *
 * Warum zusaetzlich zu `prisma validate`?
 *   `prisma validate` benoetigt die Prisma-Engine-Binaries und damit einen
 *   Netzwerkzugriff. In abgeschotteten Umgebungen (CI ohne Internet, Rechner
 *   hinter strengen Proxies) laesst sich das Schema sonst gar nicht pruefen.
 *   Dieser Pruefer arbeitet rein lexikalisch und findet die Fehlerklassen,
 *   die erfahrungsgemaess auftreten:
 *
 *     - doppelte Modell- oder Feldnamen
 *     - Relationen auf nicht existierende Modelle
 *     - `@relation(fields: […])` auf nicht deklarierte Skalarfelder
 *     - `references: […]` auf nicht existierende Zielfelder
 *     - fehlende Gegenseite einer Relation (Prisma verlangt beide Seiten)
 *     - `@@index` / `@@unique` / `@@id` auf unbekannte Felder
 *     - Verstoesse gegen die Portabilitaetsregeln des Projekts
 *       (native Enums, Scalar-Arrays, `@db.*`, `env()` im Provider)
 *
 * Aufruf: node scripts/check-schema.mjs [pfad/zur/schema.prisma]
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';

const SCHEMA_PATH = process.argv[2] ?? 'packages/database/prisma/schema.prisma';

const SCALARS = new Set([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes', 'Unsupported',
]);

const problems = [];
const warnings = [];

const fail = (line, message) => problems.push({ line, message });
const warn = (line, message) => warnings.push({ line, message });

const source = readFileSync(SCHEMA_PATH, 'utf8');
const lines = source.split('\n');

// ---------------------------------------------------------------- Parsen
/** @type {Map<string, { line: number, fields: Map<string, { type: string, line: number, attributes: string, isList: boolean, optional: boolean }>, blockAttributes: Array<{ text: string, line: number }> }>} */
const models = new Map();
const enums = new Set();

let current = null;
let blockKind = null;

lines.forEach((rawLine, index) => {
  const lineNumber = index + 1;
  const line = rawLine.replace(/\/\/.*$/, '').trim();
  if (line.length === 0) return;

  const blockStart = line.match(/^(model|enum|datasource|generator|type|view)\s+(\w+)\s*\{/);
  if (blockStart) {
    blockKind = blockStart[1];
    if (blockKind === 'model' || blockKind === 'view') {
      if (models.has(blockStart[2])) {
        fail(lineNumber, `Doppeltes Modell "${blockStart[2]}"`);
      }
      current = { line: lineNumber, fields: new Map(), blockAttributes: [] };
      models.set(blockStart[2], current);
    } else {
      if (blockKind === 'enum') {
        enums.add(blockStart[2]);
        fail(lineNumber, `Native Enums sind laut Portabilitaetsregel nicht erlaubt: "${blockStart[2]}"`);
      }
      current = null;
    }
    return;
  }

  if (line === '}') {
    current = null;
    blockKind = null;
    return;
  }

  if (blockKind === 'datasource' && /provider\s*=\s*env\(/.test(line)) {
    fail(lineNumber, 'Prisma erlaubt kein env() im datasource-provider (Fehler P1012)');
  }

  if (!current) return;

  if (line.startsWith('@@')) {
    current.blockAttributes.push({ text: line, line: lineNumber });
    return;
  }

  const field = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
  if (!field) return;

  const [, name, type, list, optional, attributes] = field;
  if (current.fields.has(name)) {
    fail(lineNumber, `Doppeltes Feld "${name}"`);
  }
  current.fields.set(name, {
    type,
    line: lineNumber,
    attributes: attributes ?? '',
    isList: Boolean(list),
    optional: Boolean(optional),
  });

  // Portabilitaetsregeln
  if (list && SCALARS.has(type)) {
    fail(lineNumber, `Scalar-Array "${name} ${type}[]" ist laut Portabilitaetsregel nicht erlaubt`);
  }
  if (type === 'Json') {
    fail(lineNumber, `Json-Spalte "${name}" ist laut Portabilitaetsregel nicht erlaubt (String + parseJson verwenden)`);
  }
  if (/@db\./.test(attributes ?? '')) {
    fail(lineNumber, `Providerspezifisches Attribut @db.* in Feld "${name}"`);
  }
});

// ------------------------------------------------------------- Pruefungen
const fieldList = (raw) =>
  raw
    .split(',')
    .map((entry) => entry.trim().replace(/\(.*$/, ''))
    .filter(Boolean);

for (const [modelName, model] of models) {
  for (const [fieldName, field] of model.fields) {
    const isRelationType = models.has(field.type);

    if (!SCALARS.has(field.type) && !isRelationType && !enums.has(field.type)) {
      fail(field.line, `${modelName}.${fieldName}: unbekannter Typ "${field.type}"`);
      continue;
    }

    const relation = field.attributes.match(/@relation\(([^)]*)\)/);
    if (relation) {
      const body = relation[1];

      const fields = body.match(/fields:\s*\[([^\]]*)\]/);
      if (fields) {
        for (const reference of fieldList(fields[1])) {
          if (!model.fields.has(reference)) {
            fail(field.line, `${modelName}.${fieldName}: @relation(fields:) verweist auf unbekanntes Feld "${reference}"`);
          }
        }
      }

      const references = body.match(/references:\s*\[([^\]]*)\]/);
      if (references && isRelationType) {
        const target = models.get(field.type);
        for (const reference of fieldList(references[1])) {
          if (!target.fields.has(reference)) {
            fail(field.line, `${modelName}.${fieldName}: references verweist auf unbekanntes Feld "${field.type}.${reference}"`);
          }
        }
      }
    }

    // Gegenseite: Prisma verlangt auf beiden Seiten ein Relationsfeld.
    if (isRelationType) {
      const target = models.get(field.type);
      const hasBackReference = [...target.fields.values()].some((candidate) => candidate.type === modelName);
      if (!hasBackReference && field.type !== modelName) {
        fail(field.line, `${modelName}.${fieldName}: Modell "${field.type}" hat keine Gegenseite zurueck auf "${modelName}"`);
      }
    }
  }

  for (const attribute of model.blockAttributes) {
    const match = attribute.text.match(/@@(index|unique|id)\(\[?([^)\]]*)\]?/);
    if (!match) continue;
    for (const reference of fieldList(match[2])) {
      if (reference.startsWith('name:') || reference.startsWith('map:')) continue;
      if (!model.fields.has(reference)) {
        fail(attribute.line, `${modelName}: @@${match[1]} verweist auf unbekanntes Feld "${reference}"`);
      }
    }
  }

  // Ein Modell ohne Primaerschluessel ist in Prisma ungueltig.
  const hasId =
    [...model.fields.values()].some((field) => /@id\b/.test(field.attributes)) ||
    model.blockAttributes.some((attribute) => attribute.text.startsWith('@@id'));
  if (!hasId) {
    fail(model.line, `${modelName}: kein Primaerschluessel (@id oder @@id)`);
  }

  // Fremdschluessel ohne Index werden bei jeder Filterabfrage zum Vollscan.
  for (const [fieldName, field] of model.fields) {
    if (!/@relation\(/.test(field.attributes)) continue;
    const fields = field.attributes.match(/fields:\s*\[([^\]]*)\]/);
    if (!fields) continue;
    const foreignKeys = fieldList(fields[1]);
    const indexed = model.blockAttributes.some((attribute) =>
      foreignKeys.some((key) => attribute.text.includes(key)),
    );
    const uniqueOnField = foreignKeys.some((key) => /@unique/.test(model.fields.get(key)?.attributes ?? ''));
    const isPrimaryKey = foreignKeys.some((key) => /@id\b/.test(model.fields.get(key)?.attributes ?? ''));
    if (!indexed && !uniqueOnField && !isPrimaryKey) {
      warn(field.line, `${modelName}.${fieldName}: Fremdschluessel ${foreignKeys.join(', ')} ohne Index`);
    }
  }
}

// --------------------------------------------------------------- Ausgabe
console.log(`Schema: ${SCHEMA_PATH}`);
console.log(`Modelle: ${models.size}`);

for (const warning of warnings) {
  console.log(`  WARN  ${SCHEMA_PATH}:${warning.line}  ${warning.message}`);
}
for (const problem of problems) {
  console.log(`  FEHLER ${SCHEMA_PATH}:${problem.line}  ${problem.message}`);
}

if (problems.length > 0) {
  console.log(`\n${problems.length} Fehler gefunden.`);
  process.exit(1);
}
console.log(warnings.length > 0 ? `\nOK (${warnings.length} Hinweise).` : '\nOK.');
