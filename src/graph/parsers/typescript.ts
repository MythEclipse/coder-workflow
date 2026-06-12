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
  return dedupeById(astSymbols);
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
    ts.ScriptKind.TSX,
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
    ts.ScriptKind.TSX,
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
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          // Treat const/let/var as functions if they're arrow functions or function expressions
          if (decl.initializer) {
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


