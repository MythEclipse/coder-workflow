import * as ts from "typescript";
import type { CodeGraphNode } from "../../types.js";
import { dedupeById, nodeId } from "../ids.js";
import { controlFlowKeywords, sanitizeBraceLanguage } from "./utils.js";

/**
 * Extract TypeScript/JavaScript symbols using TypeScript Compiler API.
 * Parses AST to find classes, functions, methods, and other declarations.
 * Ignores symbols in comments and strings.
 * Uses regex fallback on sanitized source to catch arrow functions and other patterns.
 */
export function extractSymbolsFromAST(source: string, path: string): CodeGraphNode[] {
  const astSymbols = extractFromAST(source, path);
  const regexSymbols = extractFromRegex(sanitizeBraceLanguage(source), path);

  // Merge both approaches, deduping by ID
  const allSymbols = [...astSymbols, ...regexSymbols];
  return dedupeById(allSymbols);
}

/**
 * Extract import module specifiers from TypeScript/JavaScript using AST.
 * Handles multiline and destructured imports via ImportDeclaration nodes.
 */
export function extractImportsFromAST(source: string): string[] {
  const imports: string[] = [];
  const sourceFile = ts.createSourceFile(
    "temp.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, (child) => visit(child));
  }

  visit(sourceFile);
  return [...new Set(imports)];
}

function extractFromAST(source: string, path: string): CodeGraphNode[] {
  const symbols: CodeGraphNode[] = [];
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  function visit(node: ts.Node): void {
    // Extract class declarations
    if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      symbols.push({
        id: nodeId("symbol", `${path}:${name}`),
        type: "class",
        name,
        path,
      });

      // Extract methods from class
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName =
            ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
              ? member.name.text
              : undefined;
          if (methodName) {
            const startLine = sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1;
            const endLine = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
            symbols.push({
              id: nodeId("symbol", `${path}:${name}.${methodName}`),
              type: "method",
              name: methodName,
              path,
              startLine,
              endLine,
            });
          }
        }
      }
    }

    // Extract interface declarations
    if (ts.isInterfaceDeclaration(node) && node.name) {
      const name = node.name.text;
      symbols.push({
        id: nodeId("symbol", `${path}:${name}`),
        type: "class",
        name,
        path,
      });
    }

    // Extract function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      symbols.push({
        id: nodeId("symbol", `${path}:${name}`),
        type: "function",
        name,
        path,
        startLine,
        endLine,
      });
    }

    // Extract variable declarations (const/let/var)
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          // Treat exported const/let/var as functions if they're arrow functions or function expressions
          if (isExported && decl.initializer) {
            if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
              symbols.push({
                id: nodeId("symbol", `${path}:${name}`),
                type: "function",
                name,
                path,
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child));
  }

  visit(sourceFile);
  return symbols;
}

function extractFromRegex(sanitized: string, path: string): CodeGraphNode[] {
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g,
    /(?:export\s+)?const\s+([A-Z][A-Za-z_$\d]*)\s*=/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
  ];
  const nodes: CodeGraphNode[] = [];
  for (const pattern of patterns) {
    for (const match of sanitized.matchAll(pattern)) {
      const name = match[1];
      if (controlFlowKeywords.has(name)) continue;
      const matchOffset = match[0].indexOf(name);
      const actualIndex = (match.index ?? 0) + (matchOffset >= 0 ? matchOffset : 0);
      const line = sanitized.slice(0, actualIndex).split("\n").length;
      nodes.push({
        id: nodeId("symbol", `${path}:${name}`),
        type: match[0].includes("class") || match[0].includes("interface") ? "class" : "function",
        name,
        path,
        language: "typescript",
        line,
      });
    }
  }
  return nodes;
}
