import * as fs from 'fs';
import * as path from 'path';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface EntityField {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  default?: any;
  relation?: {
    entity: string;
    type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  };
}

export interface Entity {
  name: string;
  table: string;
  fields: EntityField[];
  relations: string[];
  primaryKey: string[];
  indexes: string[];
}

export interface SchemaReport {
  entities: Entity[];
  totalEntities: number;
  totalRelations: number;
  generatedAt: string;
  error?: string;
}

export interface SchemaDiff {
  added: Entity[];
  removed: Entity[];
  changed: Array<{
    entity: string;
    fieldChanges: Array<{
      field: string;
      change: string;
      before?: string;
      after?: string;
    }>;
  }>;
}

type Dialect = 'postgres' | 'mysql' | 'sqlite';

// ── Prisma Schema Parser ────────────────────────────────────────────────────

/**
 * Line-by-line parser for Prisma schema (.prisma) files.
 */
export function parsePrismaSchema(schemaPath: string): SchemaReport {
  if (!fs.existsSync(schemaPath)) {
    return {
      entities: [],
      totalEntities: 0,
      totalRelations: 0,
      generatedAt: new Date().toISOString(),
      error: `File not found: ${schemaPath}`,
    };
  }

  const content = fs.readFileSync(schemaPath, 'utf-8');
  const lines = content.split('\n');

  const entities: Entity[] = [];
  let currentEntity: Partial<Entity> | null = null;
  let currentFields: EntityField[] = [];
  let currentRelations: string[] = [];
  let currentPrimaryKey: string[] = [];
  let currentIndexes: string[] = [];
  let inBlock = false;

  // Map Prisma scalar types to generic type strings
  const scalarMap: Record<string, string> = {
    String: 'string',
    Int: 'integer',
    Float: 'float',
    Boolean: 'boolean',
    DateTime: 'datetime',
    Json: 'json',
    BigInt: 'bigint',
    Decimal: 'decimal',
    Bytes: 'bytes',
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Skip empty lines and comments
    if (line === '' || line.startsWith('//') || line.startsWith('#')) continue;

    // Detect model start
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentEntity = { name: modelMatch[1], table: modelMatch[1] };
      currentFields = [];
      currentRelations = [];
      currentPrimaryKey = [];
      currentIndexes = [];
      inBlock = true;
      continue;
    }

    // Detect enum blocks (skip)
    const enumMatch = line.match(/^enum\s+\w+\s*\{/);
    if (enumMatch) {
      inBlock = true;
      continue;
    }

    // Closing brace
    if (line === '}') {
      if (currentEntity && currentEntity.name) {
        entities.push({
          name: currentEntity.name,
          table: currentEntity.table ?? '',
          fields: currentFields,
          relations: currentRelations,
          primaryKey: currentPrimaryKey,
          indexes: currentIndexes,
        });
      }
      currentEntity = null;
      inBlock = false;
      continue;
    }

    if (!inBlock || !currentEntity) continue;

    // @@id([...]) composite primary key
    const compositeIdMatch = line.match(/@@id\s*\(\s*\[([^\]]+)\]\s*\)/);
    if (compositeIdMatch) {
      currentPrimaryKey = compositeIdMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
      continue;
    }

    // @@index([...])
    const indexMatch = line.match(/@@index\s*\(\s*\[([^\]]+)\]\s*(?:,\s*(.+))?\)/);
    if (indexMatch) {
      const cols = indexMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
      const rest = (indexMatch[2] || '').trim();
      currentIndexes.push(cols.join(', ') + (rest ? ` (${rest})` : ''));
      continue;
    }

    // @@unique([...])
    const uniqueConstraintMatch = line.match(/@@unique\s*\(\s*\[([^\]]+)\]\s*\)/);
    if (uniqueConstraintMatch) {
      continue; // handled per-field
    }

    // Relation fields: ModelName? or ModelName[]
    const relationFieldMatch = line.match(/^(\w+)\s+(\w+)(\?)?\s*$/);
    if (relationFieldMatch) {
      const fieldName = relationFieldMatch[1];
      const typeName = relationFieldMatch[2];
      const optional = !!relationFieldMatch[3];

      // Check if the type is another model (starts with uppercase and is not a scalar)
      if (/^[A-Z]/.test(typeName) && !scalarMap[typeName]) {
        currentRelations.push(typeName);

        // Determine relation type: [] indicates one-to-many or many-to-many
        let relType: EntityField['relation'] = {
          entity: typeName,
          type: 'one-to-one',
        };

        // Detect relation type from following attribute lines
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();
          if (nextLine === '') {
            j++;
            continue;
          }
          if (!nextLine.startsWith('@')) break;

          if (nextLine.startsWith('@relation')) {
            // Could be many-to-many if both sides have arrays
            // For one-to-many, the field type often includes []
            if (line.includes('[]')) {
              relType = { entity: typeName, type: 'one-to-many' };
            }
            // Check for many-to-many via @@relation on the field
            if (nextLine.includes('references:') && line.includes('[]')) {
              relType = { entity: typeName, type: 'many-to-many' };
            }
          }
          j++;
        }

        currentFields.push({
          name: fieldName,
          type: typeName,
          required: !optional,
          unique: false,
          relation: relType,
        });
        continue;
      }
    }

    // Regular field line: fieldName FieldType? @attributes
    const fieldLineMatch = line.match(
      /^(\w+)\s+(\w+)(\?)?\s*(@[\s\S]*)?$/
    );
    if (fieldLineMatch) {
      const fieldName = fieldLineMatch[1];
      const rawType = fieldLineMatch[2];
      const optional = !!fieldLineMatch[3];
      const attrs = fieldLineMatch[4] || '';

      const resolvedType = scalarMap[rawType] || rawType;
      const isId = /@id\b/.test(attrs);
      const hasDefault = /@default\b/.test(attrs);
      const isUnique = /@unique\b/.test(attrs);

      // Extract default value
      let defaultVal: any = undefined;
      const defaultMatch = attrs.match(/@default\s*\(\s*([^)]+)\s*\)/);
      if (defaultMatch) {
        defaultVal = defaultMatch[1];
      }

      // Extract relation info from @relation
      let relation: EntityField['relation'] | undefined;
      const relationMatch = attrs.match(
        /@relation\s*\(\s*(?:([^()]+)|(?:fields:\s*\[?([^\]]+)\]?))\s*\)/
      );
      if (relationMatch) {
        // The entity is determined by the field type which references another model
        if (/^[A-Z]/.test(rawType)) {
          relation = { entity: rawType, type: 'one-to-one' };
          currentRelations.push(rawType);
        }
      }

      if (isId) {
        currentPrimaryKey.push(fieldName);
      }

      currentFields.push({
        name: fieldName,
        type: resolvedType,
        required: !optional && !isUnique,
        unique: isUnique,
        default: defaultVal,
        relation,
      });

      if (isUnique) {
        currentPrimaryKey.push(fieldName);
      }

      continue;
    }

    // Block-level attributes on model
    const blockAttrMatch = line.match(/^@@(\w+)\(/);
    if (blockAttrMatch) {
      // Already handled above for id/index/unique
      continue;
    }
  }

  const totalRelations = entities.reduce(
    (sum, e) => sum + e.relations.length,
    0
  );

  return {
    entities,
    totalEntities: entities.length,
    totalRelations,
    generatedAt: new Date().toISOString(),
  };
}

// ── TypeORM Entity Parser ───────────────────────────────────────────────────

/**
 * Parse TypeORM entity files from a directory. Scans all `.entity.ts` files,
 * extracting schema info from decorators using regex patterns.
 */
export function parseTypeOrmEntities(entityDir: string): SchemaReport {
  if (!fs.existsSync(entityDir)) {
    return {
      entities: [],
      totalEntities: 0,
      totalRelations: 0,
      generatedAt: new Date().toISOString(),
      error: `Directory not found: ${entityDir}`,
    };
  }

  const entities: Entity[] = [];
  const entries = fs.readdirSync(entityDir, { withFileTypes: true });

  const entityFiles = entries.filter(
    (e) => e.isFile() && e.name.endsWith('.entity.ts')
  );

  for (const file of entityFiles) {
    const content = fs.readFileSync(path.join(entityDir, file.name), 'utf-8');
    const entity = parseTypeOrmEntityContent(content, file.name);
    if (entity) entities.push(entity);
  }

  const totalRelations = entities.reduce(
    (sum, e) => sum + e.relations.length,
    0
  );

  return {
    entities,
    totalEntities: entities.length,
    totalRelations,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Parse a single TypeORM entity file content.
 */
function parseTypeOrmEntityContent(
  content: string,
  filename: string
): Entity | null {
  // Detect @Entity() decorator and extract table name
  const entityMatch = content.match(
    /@Entity\s*\(\s*(?:'([^']*)'|"([^"]*)")\s*\)/
  );
  if (!entityMatch) return null;

  const tableName = entityMatch[1] || entityMatch[2] || '';
  // Extract class name
  const classMatch = content.match(
    /export\s+(?:abstract\s+)?class\s+(\w+)/
  );
  const entityName = classMatch ? classMatch[1] : path.basename(filename, '.entity.ts');

  const fields: EntityField[] = [];
  const relations: string[] = [];
  const primaryKey: string[] = [];
  const indexes: string[] = [];

  // Split into lines for line-by-line processing
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('//') || line.startsWith('import '))
      continue;

    // @PrimaryGeneratedColumn() or @PrimaryColumn()
    const primaryGenMatch = line.match(/@PrimaryGeneratedColumn\s*\(\s*\)/);
    const primaryColMatch = line.match(
      /@PrimaryColumn\s*\(\s*(?:'([^']*)'|"([^"]*)"|(\{[^}]+\}))?\s*\)/
    );

    if (primaryGenMatch || primaryColMatch) {
      // Read the next line for the field declaration
      const nextLine = (lines[i + 1] || '').trim();
      const fieldDecl = nextLine.match(
        /(\w+)\s*[?:!]?\s*(\w+(?:<\w+>)?)\s*[;=]/
      );
      if (fieldDecl) {
        const fieldName = fieldDecl[1];
        const fieldType = fieldDecl[2];
        primaryKey.push(fieldName);
        fields.push({
          name: fieldName,
          type: fieldType,
          required: true,
          unique: true,
          default: undefined,
        });
      }
      continue;
    }

    // @Column() decorator
    const colMatch = line.match(/@Column\s*\(\s*(\{[^}]*\})?\s*\)/);
    if (colMatch) {
      const args = colMatch[1] || '';
      const nextLine = (lines[i + 1] || '').trim();
      const fieldDecl = nextLine.match(
        /(\w+)\s*[?:!]?\s*(\w+(?:<\w+>)?)\s*[;=]/
      );
      if (fieldDecl) {
        const fieldName = fieldDecl[1];
        const fieldType = fieldDecl[2];

        const nullable = /nullable\s*:\s*true/.test(args);
        const unique = /unique\s*:\s*true/.test(args);
        const typeMatch = args.match(/type\s*:\s*'([^']*)'/);
        const colType = typeMatch ? typeMatch[1] : fieldType;
        const defaultMatch = args.match(/default\s*:\s*(['"`]?)([^'"`,}]+)\1/);
        const defaultVal = defaultMatch ? defaultMatch[2] : undefined;

        const enumMatch = content.match(
          /export\s+enum\s+(\w+)\s*\{/
        );
        // If fieldType matches an enum defined in the file, use 'enum' as type
        const resolvedType =
          enumMatch && enumMatch[1] === fieldType ? `enum(${fieldType})` : colType;

        fields.push({
          name: fieldName,
          type: resolvedType,
          required: !nullable,
          unique,
          default: defaultVal,
        });
      }
      continue;
    }

    // @ManyToOne() / @OneToMany() / @OneToOne() / @ManyToMany() decorators
    const relationDecMatch = line.match(
      /@(ManyToOne|OneToMany|OneToOne|ManyToMany)\s*\(\s*(?:\(?\s*\)?\s*)?[^)]*\)/
    );
    if (relationDecMatch) {
      const relType = relationDecMatch[1] as NonNullable<EntityField['relation']>['type'];
      const nextLine = (lines[i + 1] || '').trim();

      // Extract the related entity from the decorator argument
      const typeFuncMatch = line.match(
        /=>\s*(\w+)\s*\)/
      );
      const relatedEntity = typeFuncMatch
        ? typeFuncMatch[1]
        : 'unknown';

      if (relatedEntity !== 'unknown') {
        relations.push(relatedEntity);
      }

      // Read field declaration from current or next line
      const fieldDecl = nextLine.match(
        /(\w+)\s*[?:!]?\s*(\w+(?:<\w+>)?)\s*[;=]/
      );
      if (fieldDecl) {
        const fieldName = fieldDecl[1];
        // The declared type might be the related entity or Promise<Entity>
        const rawFieldType = fieldDecl[2].replace(/^Promise</, '').replace(/>$/, '');

        let mappedRelType: NonNullable<EntityField['relation']>['type'];
        switch (relType.toLowerCase()) {
          case 'onetomany':
            mappedRelType = 'one-to-many';
            break;
          case 'manytoone':
            mappedRelType = 'one-to-many';
            break;
          case 'onetoone':
            mappedRelType = 'one-to-one';
            break;
          case 'manytomany':
            mappedRelType = 'many-to-many';
            break;
          default:
            mappedRelType = 'one-to-one';
        }

        fields.push({
          name: fieldName,
          type: rawFieldType,
          required: false,
          unique: false,
          relation: {
            entity: relatedEntity,
            type: mappedRelType,
          },
        });
      }
      continue;
    }

    // @Index() decorator
    const indexMatch = line.match(/@Index\s*\(\s*(?:'([^']*)'|"([^"]*)")\s*\)/);
    if (indexMatch) {
      const indexName = indexMatch[1] || indexMatch[2] || '';
      // Assume the next line's field is indexed
      const nextLine = (lines[i + 1] || '').trim();
      const fieldDecl = nextLine.match(/(\w+)\s*[?:!]?\s*\w+/);
      if (fieldDecl) {
        indexes.push(indexName || fieldDecl[1]);
      }
      continue;
    }

    // Composite unique constraint via @Unique(["col1", "col2"])
    const uniqueDecMatch = line.match(
      /@Unique\s*\(\s*\[([^\]]+)\]\s*\)/
    );
    if (uniqueDecMatch) {
      const cols = uniqueDecMatch[1]
        .split(',')
        .map((c) => c.trim().replace(/['"]/g, ''));
      indexes.push(`unique(${cols.join(', ')})`);
      continue;
    }
  }

  return {
    name: entityName,
    table: tableName || entityName,
    fields,
    relations,
    primaryKey,
    indexes,
  };
}

// ── Schema Comparison ───────────────────────────────────────────────────────

/**
 * Compare two SchemaReports and produce a SchemaDiff describing what changed.
 */
export function compareSchemas(
  before: SchemaReport,
  after: SchemaReport
): SchemaDiff {
  const beforeMap = new Map<string, Entity>();
  for (const e of before.entities) beforeMap.set(e.name, e);

  const afterMap = new Map<string, Entity>();
  for (const e of after.entities) afterMap.set(e.name, e);

  const added: Entity[] = [];
  const removed: Entity[] = [];
  const changed: SchemaDiff['changed'] = [];

  // Detect added entities
  for (const entity of after.entities) {
    if (!beforeMap.has(entity.name)) {
      added.push(entity);
    }
  }

  // Detect removed entities
  for (const entity of before.entities) {
    if (!afterMap.has(entity.name)) {
      removed.push(entity);
    }
  }

  // Detect changed entities
  for (const afterEntity of after.entities) {
    const beforeEntity = beforeMap.get(afterEntity.name);
    if (!beforeEntity) continue;

    const beforeFields = new Map<string, EntityField>();
    for (const f of beforeEntity.fields) beforeFields.set(f.name, f);

    const fieldChanges: SchemaDiff['changed'][0]['fieldChanges'] = [];

    for (const afterField of afterEntity.fields) {
      const beforeField = beforeFields.get(afterField.name);

      if (!beforeField) {
        fieldChanges.push({
          field: afterField.name,
          change: 'added',
          after: `${afterField.type}${afterField.required ? '' : '?'}`,
        });
        continue;
      }

      // Type change
      if (beforeField.type !== afterField.type) {
        fieldChanges.push({
          field: afterField.name,
          change: 'type changed',
          before: beforeField.type,
          after: afterField.type,
        });
      }

      // Nullability change
      if (beforeField.required !== afterField.required) {
        fieldChanges.push({
          field: afterField.name,
          change: afterField.required
            ? 'changed to required'
            : 'changed to optional',
          before: beforeField.required ? 'required' : 'optional',
          after: afterField.required ? 'required' : 'optional',
        });
      }

      // Uniqueness change
      if (beforeField.unique !== afterField.unique) {
        fieldChanges.push({
          field: afterField.name,
          change: afterField.unique
            ? 'unique constraint added'
            : 'unique constraint removed',
          before: beforeField.unique ? 'unique' : 'not unique',
          after: afterField.unique ? 'unique' : 'not unique',
        });
      }

      // Default value change
      if (beforeField.default !== afterField.default) {
        fieldChanges.push({
          field: afterField.name,
          change: 'default changed',
          before: beforeField.default ?? '(none)',
          after: afterField.default ?? '(none)',
        });
      }

      // Relation change
      const beforeRel = beforeField.relation;
      const afterRel = afterField.relation;
      if (
        (beforeRel && !afterRel) ||
        (!beforeRel && afterRel) ||
        (beforeRel &&
          afterRel &&
          (beforeRel.entity !== afterRel.entity ||
            beforeRel.type !== afterRel.type))
      ) {
        fieldChanges.push({
          field: afterField.name,
          change: 'relation changed',
          before: beforeRel
            ? `${beforeRel.type} -> ${beforeRel.entity}`
            : '(none)',
          after: afterRel
            ? `${afterRel.type} -> ${afterRel.entity}`
            : '(none)',
        });
      }
    }

    // Detect removed fields
    const afterFieldNames = new Set(
      afterEntity.fields.map((f) => f.name)
    );
    for (const beforeField of beforeEntity.fields) {
      if (!afterFieldNames.has(beforeField.name)) {
        fieldChanges.push({
          field: beforeField.name,
          change: 'removed',
          before: `${beforeField.type}${beforeField.required ? '' : '?'}`,
        });
      }
    }

    if (fieldChanges.length > 0) {
      changed.push({ entity: afterEntity.name, fieldChanges });
    }
  }

  return { added, removed, changed };
}

// ── Migration SQL Generator ─────────────────────────────────────────────────

/**
 * Generates basic ALTER TABLE statements to migrate from an old schema to a new
 * schema based on the provided diff.
 */
export function generateMigrationSql(
  diff: SchemaDiff,
  dialect: Dialect
): string {
  const statements: string[] = [];

  const quote = (name: string): string => {
    switch (dialect) {
      case 'postgres':
        return `"${name}"`;
      case 'mysql':
        return `\`${name}\``;
      case 'sqlite':
        return `"${name}"`;
    }
  };

  const typeMap: Record<string, string> = {
    string: 'VARCHAR(255)',
    integer: 'INTEGER',
    float: 'FLOAT',
    boolean: 'BOOLEAN',
    datetime: 'TIMESTAMP',
    json: dialect === 'postgres' ? 'JSONB' : dialect === 'mysql' ? 'JSON' : 'TEXT',
    bigint: 'BIGINT',
    decimal: 'DECIMAL(10,2)',
    bytes: 'BYTEA',
  };

  function mapType(t: string): string {
    // Remove generic parameters for type mapping
    const base = t.replace(/<.*>$/, '');
    if (typeMap[base.toLowerCase()]) return typeMap[base.toLowerCase()];
    // If it starts with uppercase, treat as relation reference => INTEGER FK
    if (/^[A-Z]/.test(base)) return 'INTEGER';
    return t.toUpperCase();
  }

  function nullableClause(field: EntityField): string {
    return field.required ? 'NOT NULL' : 'NULL';
  }

  function defaultClause(field: EntityField): string {
    if (field.default === undefined) return '';
    const val =
      typeof field.default === 'string'
        ? field.default.startsWith('now()') ||
          field.default.startsWith('gen_random_uuid()') ||
          field.default === 'autoincrement()'
          ? field.default
          : `'${field.default}'`
        : String(field.default);
    return `DEFAULT ${val}`;
  }

  // Removed entities => DROP TABLE
  for (const entity of diff.removed) {
    statements.push(
      `DROP TABLE IF EXISTS ${quote(entity.table)};`
    );
  }

  // Added entities => CREATE TABLE
  for (const entity of diff.added) {
    const cols: string[] = [];
    for (const field of entity.fields) {
      if (field.relation) {
        // FK column naming: fieldName + Id
        const fkCol = `${field.name}Id`;
        const colDef = [
          quote(fkCol),
          'INTEGER',
          nullableClause(field),
          defaultClause(field),
        ]
          .filter(Boolean)
          .join(' ');
        cols.push(`  ${colDef}`);
      } else {
        const colDef = [
          quote(field.name),
          mapType(field.type),
          field.unique ? 'UNIQUE' : '',
          nullableClause(field),
          defaultClause(field),
        ]
          .filter(Boolean)
          .join(' ');
        cols.push(`  ${colDef}`);
      }
    }

    // Primary key
    if (entity.primaryKey.length > 0) {
      const pkCols = entity.primaryKey.map((k) => quote(k)).join(', ');
      cols.push(`  PRIMARY KEY (${pkCols})`);
    }

    // Indexes
    for (const idx of entity.indexes) {
      const idxMatch = idx.match(/^(\w[\w\s,]+)/);
      if (idxMatch) {
        const idxCols = idxMatch[1]
          .split(',')
          .map((s) => quote(s.trim()))
          .join(', ');
        cols.push(`  INDEX (${idxCols})`);
      }
    }

    // Relations => FK constraints
    for (const field of entity.fields) {
      if (field.relation) {
        const fkCol = `${field.name}Id`;
        cols.push(
          `  FOREIGN KEY (${quote(fkCol)}) REFERENCES ${quote(field.relation.entity)}(id)`
        );
      }
    }

    statements.push(
      `CREATE TABLE ${quote(entity.table)} (\n${cols.join(',\n')}\n);`
    );
  }

  // Changed entities => ALTER TABLE
  for (const change of diff.changed) {
    // Try to find the entity in added or removed sets to determine table name
    const entityInAfter = diff.added.find((e) => e.name === change.entity);
    const tableName = entityInAfter?.table ?? change.entity;

    for (const fc of change.fieldChanges) {
      switch (fc.change) {
        case 'added':
          statements.push(
            `ALTER TABLE ${quote(tableName)} ADD COLUMN ${quote(fc.field)} ${mapType(fc.after || 'VARCHAR(255)')};`
          );
          break;
        case 'removed':
          if (dialect === 'sqlite') {
            statements.push(
              `-- SQLite does not support DROP COLUMN directly; recreate table to remove ${fc.field}`
            );
          } else {
            statements.push(
              `ALTER TABLE ${quote(tableName)} DROP COLUMN ${quote(fc.field)};`
            );
          }
          break;
        case 'type changed':
          if (dialect === 'postgres') {
            statements.push(
              `ALTER TABLE ${quote(tableName)} ALTER COLUMN ${quote(fc.field)} TYPE ${mapType(fc.after || 'VARCHAR(255)')};`
            );
          } else if (dialect === 'mysql') {
            statements.push(
              `ALTER TABLE ${quote(tableName)} MODIFY COLUMN ${quote(fc.field)} ${mapType(fc.after || 'VARCHAR(255)')};`
            );
          } else {
            statements.push(
              `-- SQLite: ALTER TABLE ${quote(tableName)} requires full table rebuild for type change on ${fc.field}`
            );
          }
          break;
        case 'changed to required':
          if (dialect === 'sqlite') {
            statements.push(
              `-- SQLite: ALTER TABLE ${quote(tableName)} requires full table rebuild to set ${fc.field} NOT NULL`
            );
          } else {
            statements.push(
              `ALTER TABLE ${quote(tableName)} ALTER COLUMN ${quote(fc.field)} SET NOT NULL;`
            );
          }
          break;
        case 'changed to optional':
          if (dialect === 'sqlite') {
            statements.push(
              `-- SQLite: ALTER TABLE ${quote(tableName)} requires full table rebuild to drop NOT NULL on ${fc.field}`
            );
          } else {
            statements.push(
              `ALTER TABLE ${quote(tableName)} ALTER COLUMN ${quote(fc.field)} DROP NOT NULL;`
            );
          }
          break;
        case 'unique constraint added':
          statements.push(
            `CREATE UNIQUE INDEX ${quote(`uq_${tableName}_${fc.field}`)} ON ${quote(tableName)} (${quote(fc.field)});`
          );
          break;
        case 'unique constraint removed':
          statements.push(
            `DROP INDEX IF EXISTS ${quote(`uq_${tableName}_${fc.field}`)};`
          );
          break;
        default:
          statements.push(
            `-- ${fc.change}: ${fc.field} ${fc.before || ''} => ${fc.after || ''}`
          );
      }
    }
  }

  return statements.join('\n');
}

// ── Formatters ──────────────────────────────────────────────────────────────

/**
 * Format a SchemaReport as a readable entity diagram string.
 */
export function formatSchemaReport(report: SchemaReport): string {
  if (report.error) {
    return `[Schema Report Error]\n${report.error}\n`;
  }

  const parts: string[] = [];
  parts.push(`Schema Report — ${report.totalEntities} entities, ${report.totalRelations} relations`);
  parts.push(`Generated: ${report.generatedAt}`);
  parts.push('');

  for (const entity of report.entities) {
    parts.push(`┌─ ${entity.name}`);
    parts.push(`│  table: ${entity.table}`);

    // Fields
    for (const field of entity.fields) {
      const pk = entity.primaryKey.includes(field.name) ? ' 🔑' : '';
      const uq = field.unique ? ' 🔒' : '';
      const req = field.required ? '' : '?';
      const def = field.default !== undefined ? ` = ${field.default}` : '';
      const rel = field.relation
        ? ` ──${field.relation.type}──> ${field.relation.entity}`
        : '';
      parts.push(
        `│  ├─ ${field.name}${req}: ${field.type}${pk}${uq}${def}${rel}`
      );
    }

    // Relations
    if (entity.relations.length > 0) {
      for (const rel of entity.relations) {
        parts.push(`│  └─ relates to: ${rel}`);
      }
    }

    // Indexes
    if (entity.indexes.length > 0) {
      parts.push(`│  indexes: ${entity.indexes.join(', ')}`);
    }

    parts.push('└──');
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Format a SchemaDiff as a readable migration summary string.
 */
export function formatSchemaDiff(diff: SchemaDiff): string {
  const parts: string[] = [];
  parts.push('Schema Migration Summary');
  parts.push('');

  if (diff.added.length > 0) {
    parts.push(`[Added Entities] (${diff.added.length})`);
    for (const entity of diff.added) {
      const fields = entity.fields.map((f) => `  ${f.name}: ${f.type}`).join('\n');
      parts.push(`  + ${entity.name} (${entity.fields.length} fields)`);
      parts.push(fields);
    }
    parts.push('');
  }

  if (diff.removed.length > 0) {
    parts.push(`[Removed Entities] (${diff.removed.length})`);
    for (const entity of diff.removed) {
      parts.push(`  - ${entity.name}`);
    }
    parts.push('');
  }

  if (diff.changed.length > 0) {
    parts.push(`[Changed Entities] (${diff.changed.length})`);
    for (const change of diff.changed) {
      parts.push(`  ~ ${change.entity}`);
      for (const fc of change.fieldChanges) {
        const detail =
          fc.before && fc.after
            ? ` (${fc.before} → ${fc.after})`
            : fc.after
              ? ` (→ ${fc.after})`
              : '';
        parts.push(`      ${fc.field}: ${fc.change}${detail}`);
      }
    }
    parts.push('');
  }

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    parts.push('  No schema changes detected.');
  }

  return parts.join('\n');
}
